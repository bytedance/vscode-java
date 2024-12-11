// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************


import * as lc from 'vscode-languageclient/browser';
import * as vscode from 'vscode';
import * as Commands from './command';
import { UriParse } from './utils';

import { channel, serverChannel, logger, getJavaConfig, getJavaConfiguration } from './utils';

const languageServerId = 'vscode-java-jdt';
const languageServerName = 'vscode java jdt';

export function createClient(context: vscode.ExtensionContext) {
  // Options to control the language client
  const clientOptions: lc.LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'java' },
      { scheme: 'jdt', language: 'java' },
      { scheme: 'untitled', language: 'java' },
      { scheme: 'vscode-remote', language: 'java' },
    ],
    synchronize: {
      // Synchronize the setting section to the server.
      configurationSection: ['java', 'editor.insertSpaces', 'editor.tabSize'],
    },
    initializationOptions: {
      // workspaceFolders: vscode.workspace.workspaceFolders
      //   ? vscode.workspace.workspaceFolders.map(f => f.uri.toString())
      //   : null,
      settings: { java: getJavaConfig() },
      extendedClientCapabilities: {
        classFileContentsSupport: true,
        overrideMethodsPromptSupport: true,
        hashCodeEqualsPromptSupport: true,
        advancedOrganizeImportsSupport: true,
        generateToStringPromptSupport: true,
        advancedGenerateAccessorsSupport: true,
        generateConstructorsPromptSupport: true,
        generateDelegateMethodsPromptSupport: true,
        advancedExtractRefactoringSupport: true,
        inferSelectionSupport: ['extractMethod', 'extractVariable', 'extractField'],
        moveRefactoringSupport: true,
        clientHoverProvider: true,
        clientDocumentSymbolProvider: true,
        gradleChecksumWrapperPromptSupport: true,
        advancedIntroduceParameterRefactoringSupport: true,
        actionableRuntimeNotificationSupport: true,
        onCompletionItemSelectedCommand: 'editor.action.triggerParameterHints',
        extractInterfaceSupport: true,
        advancedUpgradeGradleSupport: true,
        executeClientCommandSupport: true,
      },
    },
    errorHandler: {
      error(error, message, _count) {
        // 暂时屏蔽掉错误日志
        logger.error('errorHandler', error.toString());
        logger.error('errorHandler', message?.jsonrpc);
        return {
          action: lc.ErrorAction.Continue,
          close: true,
        };
      },
      closed() {
        // 暂时屏蔽掉错误日志
        logger.error('Error handler closed');
        return {
          action: lc.CloseAction.Restart,
          close: true,
        };
      },
    },
    initializationFailedHandler: e => {
      logger.error('initializationFailedHandler', e.toString);
      return false;
    },
    outputChannel: serverChannel,
    traceOutputChannel: channel,
    revealOutputChannelOn: lc.RevealOutputChannelOn.Never,
    uriConverters: {
      code2Protocol: uri => uri.toString(),
      protocol2Code: path => {
        logger.debug('Before P2C', path);
        // use jdtls handle jdt scheme
        if (path.startsWith('jdt')) {
          return vscode.Uri.parse(path);
        }

        const uri = UriParse.parseUri(path);
        logger.debug('After P2C', uri);

        return uri;
      },
    },
    middleware: {
      workspace: {
        didChangeConfiguration: async () => {
          await client.sendNotification(lc.DidChangeConfigurationNotification.type, {
            settings: {
              java: await getJavaConfig(),
            },
          });
        },
      },
      resolveCompletionItem: async (item, token, next): Promise<vscode.CompletionItem | undefined | null> => {
        const completionItem = await next(item, token);
        channel.appendLine(`completionItem: ${completionItem}`);
        if (completionItem?.documentation instanceof vscode.MarkdownString) {
          completionItem.documentation = fixJdtLinksInDocumentation(completionItem.documentation);
        }
        return completionItem;
      },
      // https://github.com/redhat-developer/vscode-java/issues/2130
      // include all diagnostics for the current line in the CodeActionContext params for the performance reason
      provideCodeActions: async (document, range, context, token, next) => {
        // const client: LanguageClient = standardClient.getClient();
        const params: lc.CodeActionParams = {
          textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document),
          range: client.code2ProtocolConverter.asRange(range),
          context: await client.code2ProtocolConverter.asCodeActionContext(context),
        };
        const showAt = getJavaConfiguration().get<string>('quickfix.showAt');
        if (showAt === 'line' && range.start.line === range.end.line && range.start.character === range.end.character) {
          const textLine = document.lineAt(params.range.start.line);
          if (textLine !== null) {
            const diagnostics = client.diagnostics?.get(document.uri) || [];
            const allDiagnostics: vscode.Diagnostic[] = [];
            for (const diagnostic of diagnostics) {
              if (textLine.range.intersection(diagnostic.range)) {
                const newLen = allDiagnostics.push(diagnostic);
                if (newLen > 1000) {
                  break;
                }
              }
            }
            const codeActionContext: vscode.CodeActionContext = {
              diagnostics: allDiagnostics,
              only: context.only,
              triggerKind: context.triggerKind,
            };
            params.context = await client.code2ProtocolConverter.asCodeActionContext(codeActionContext);
          }
        }
        return client.sendRequest(lc.CodeActionRequest.type, params, token).then(
          async values => {
            if (values === null) {
              return undefined;
            }
            const result = [];
            for (const item of values) {
              if (lc.Command.is(item)) {
                result.push(client.protocol2CodeConverter.asCommand(item));
              } else {
                result.push(await client.protocol2CodeConverter.asCodeAction(item));
              }
            }
            return result;
          },
          error => client.handleFailedRequest(lc.CodeActionRequest.type, token, error, [])
        );
      },
    },
    markdown: {
      supportHtml: true,
    },
  };

  const client = createWorkerLanguageClient(context, clientOptions);
  return client;
}

function createWorkerLanguageClient(context: vscode.ExtensionContext, clientOptions: lc.LanguageClientOptions) {
  // Create a worker. The worker main file implements the language server.
  const serverMain = vscode.Uri.joinPath(context.extensionUri, 'server/dist/browserServerMain.js');
  const worker = new Worker(serverMain.toString(true));
  const trace = vscode.workspace.getConfiguration('jdt').get<boolean>('trace.lsp', false);

  const params = {
    endpoint: UriParse.getEndpoint(),
    trace,
  };

  worker.postMessage(params);

  // create the language server client to communicate with the server running in the worker
  return new lc.LanguageClient(languageServerId, languageServerName, clientOptions, worker);
}

const REPLACE_JDT_LINKS_PATTERN = /(\[(?:[^\]])+\]\()(jdt:\/\/(?:(?:(?:\\\))|([^)]))+))\)/g;
/**
 * Replace `jdt://` links in the documentation with links that execute the VS Code command required to open the referenced file.
 *
 * Extracted from {@link fixJdtSchemeHoverLinks} for use in completion item documentation.
 *
 * @param oldDocumentation the documentation to fix the links in
 * @returns the documentation with fixed links
 */
export function fixJdtLinksInDocumentation(oldDocumentation: vscode.MarkdownString): vscode.MarkdownString {
  const newContent: string = oldDocumentation.value.replace(REPLACE_JDT_LINKS_PATTERN, (_substring, group1, group2) => {
    const uri = `command:${Commands.OPEN_FILE}?${encodeURI(JSON.stringify([encodeURIComponent(group2)]))}`;
    return `${group1}${uri})`;
  });
  const mdString = new vscode.MarkdownString(newContent);
  mdString.isTrusted = true;
  return mdString;
}
