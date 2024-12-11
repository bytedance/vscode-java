// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import {
  CancellationToken,
  commands,
  DocumentSymbol,
  DocumentSymbolProvider,
  Event,
  ExtensionContext,
  Hover,
  HoverProvider,
  languages,
  MarkdownString,
  MarkedString,
  Position,
  Range,
  SymbolInformation,
  SymbolKind,
  TextDocument,
  TextDocumentContentProvider,
  Uri,
  workspace,
  WorkspaceSymbolProvider,
} from 'vscode';
import {
  DocumentSymbol as clientDocumentSymbol,
  DocumentSymbolRequest,
  HoverRequest,
  SymbolInformation as clientSymbolInformation,
  WorkspaceSymbolRequest,
} from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/browser';
import * as Commands from './command';
import { fixJdtLinksInDocumentation } from './client';
// import { createClientHoverProvider } from './hoverAction';
import { ClassFileContentsRequest } from './protocol';

export interface ProviderOptions {
  contentProviderEvent: Event<Uri>;
}

export interface ProviderHandle {
  handles: any[];
}

export function registerClientProviders(
  client: LanguageClient | undefined,
  context: ExtensionContext,
  options: ProviderOptions
): ProviderHandle {
  const hoverProvider = new ClientHoverProvider(client);
  context.subscriptions.push(languages.registerHoverProvider('java', hoverProvider));

  const symbolProvider = createDocumentSymbolProvider(client);
  context.subscriptions.push(languages.registerDocumentSymbolProvider('java', symbolProvider));

  const jdtProvider = createJDTContentProvider(client, options);
  context.subscriptions.push(workspace.registerTextDocumentContentProvider('jdt', jdtProvider));

  const classProvider = createClassContentProvider(client, options);
  context.subscriptions.push(workspace.registerTextDocumentContentProvider('class', classProvider));

  // overwriteWorkspaceSymbolProvider(context);

  return {
    handles: [hoverProvider, symbolProvider, jdtProvider, classProvider],
  };
}

export class ClientHoverProvider implements HoverProvider {
  // private delegateProvider;
  constructor(private readonly languageClient: LanguageClient | undefined) {}

  async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
    if (!this.languageClient) {
      return undefined;
    }

    const params = {
      textDocument: this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
      position: this.languageClient.code2ProtocolConverter.asPosition(position),
    };
    const hoverResponse = await this.languageClient.sendRequest(HoverRequest.type, params, token);
    const hover = this.languageClient.protocol2CodeConverter.asHover(hoverResponse);
    if (!hover) {
      return hover;
    }
    return fixJdtSchemeHoverLinks(hover);
  }

  // }
}

function createJDTContentProvider(
  languageClient: LanguageClient | undefined,
  options: ProviderOptions
): TextDocumentContentProvider {
  return {
    onDidChange: options.contentProviderEvent,
    provideTextDocumentContent: async (uri: Uri, token: CancellationToken): Promise<string> => {
      if (!languageClient) {
        return '';
      }

      return languageClient
        .sendRequest(ClassFileContentsRequest.type, { uri: uri.toString() }, token)
        .then((v: string): string => v || '');
    },
  } satisfies TextDocumentContentProvider;
}

function createClassContentProvider(
  languageClient: LanguageClient | undefined,
  options: ProviderOptions
): TextDocumentContentProvider {
  return {
    onDidChange: options.contentProviderEvent,
    provideTextDocumentContent: async (uri: Uri, token: CancellationToken): Promise<string> => {
      if (!languageClient) {
        return '';
      }
      const originalUri = uri
        .with({
          scheme: 'vscode-remote',
        })
        .toString();
      const decompiledContent: string = await commands.executeCommand(
        Commands.EXECUTE_WORKSPACE_COMMAND,
        Commands.GET_DECOMPILED_SOURCE,
        originalUri
      );
      if (!decompiledContent) {
        console.log(`Error while getting decompiled source : ${originalUri}`);
        return 'Error while getting decompiled source.';
      } else {
        return decompiledContent;
      }
    },
  } satisfies TextDocumentContentProvider;
}

function createDocumentSymbolProvider(languageClient: LanguageClient | undefined): DocumentSymbolProvider {
  return {
    provideDocumentSymbols: async (
      document: TextDocument,
      token: CancellationToken
    ): Promise<SymbolInformation[] | DocumentSymbol[]> => {
      // const languageClient: LanguageClient | undefined = await getActiveLanguageClient();

      if (!languageClient) {
        return [];
      }

      const params = {
        textDocument: languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
      };
      const symbolResponse = await languageClient.sendRequest(DocumentSymbolRequest.type, params, token);
      if (!symbolResponse || !symbolResponse.length) {
        return [];
      }

      if ((symbolResponse[0] as any).containerName) {
        return languageClient.protocol2CodeConverter.asSymbolInformations(symbolResponse as clientSymbolInformation[]);
      }

      return languageClient.protocol2CodeConverter.asDocumentSymbols(symbolResponse as clientDocumentSymbol[]);
    },
  } satisfies DocumentSymbolProvider;
}

// const START_OF_DOCUMENT = new Range(new Position(0, 0), new Position(0, 0));

// function createWorkspaceSymbolProvider(
//   existingWorkspaceSymbolProvider: WorkspaceSymbolProvider
// ): WorkspaceSymbolProvider {
//   return {
//     provideWorkspaceSymbols: async (query: string, token: CancellationToken) => {
//       // This is a workaround until vscode add support for qualified symbol search which is tracked by
//       // https://github.com/microsoft/vscode/issues/98125
//       const result = existingWorkspaceSymbolProvider.provideWorkspaceSymbols(query, token);
//       if (query.indexOf('.') > -1) {
//         // seems like a qualified name
//         return new Promise<SymbolInformation[]>(resolve => {
//           (result as Promise<SymbolInformation[]>).then(symbols => {
//             if (symbols === null) {
//               // @ts-expect-error vscode-java source code
//               resolve(null);
//             } else {
//               resolve(
//                 symbols?.map(s => {
//                   s.name = `${s.containerName}.${s.name}`;
//                   return s;
//                 })
//               );
//             }
//           });
//         });
//       }
//       return result;
//     },
//     resolveWorkspaceSymbol: async (symbol: SymbolInformation, token: CancellationToken): Promise<SymbolInformation> => {
//       const range = symbol.location.range;
//       if (range && !range.isEqual(START_OF_DOCUMENT)) {
//         return symbol;
//       }
//
//       const languageClient = await getActiveLanguageClient();
//       const serializableSymbol = {
//         name: symbol.name,
//         // Cannot serialize SymbolKind as number, because GSON + lsp4j.SymbolKind expect a name.
//         kind: SymbolKind[symbol.kind],
//         location: {
//           uri: languageClient.code2ProtocolConverter.asUri(symbol.location.uri),
//           range: languageClient.code2ProtocolConverter.asRange(symbol.location.range),
//         },
//         containerName: symbol.containerName,
//       };
//
//       const response = await commands.executeCommand(
//         Commands.EXECUTE_WORKSPACE_COMMAND,
//         Commands.RESOLVE_WORKSPACE_SYMBOL,
//         JSON.stringify(serializableSymbol),
//       );
//       if (token.isCancellationRequested) {
//         return undefined;
//       }
//       return languageClient.protocol2CodeConverter.asSymbolInformation(response as clientSymbolInformation);
//     },
//   };
// }

// function overwriteWorkspaceSymbolProvider(context: ExtensionContext): void {
//   const disposable = apiManager.getApiInstance().onDidServerModeChange(async (mode) => {
//     if (mode === ServerMode.standard) {
//       const feature = (await getActiveLanguageClient()).getFeature(WorkspaceSymbolRequest.method);
//       const providers = feature.getProviders();
//       if (providers && providers.length > 0) {
//         feature.clear();
//         const workspaceSymbolProvider = createWorkspaceSymbolProvider(providers[0]);
//         context.subscriptions.push(languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider));
//         disposable.dispose();
//       }
//     }
//   });
// }

/**
 * Returns the hover with all jdt:// links replaced with a command:// link that opens the jdt URI.
 *
 * VS Code doesn't render links with the `jdt` scheme in hover popups.
 * To get around this, you can create a command:// link that invokes a command that opens the corresponding URI.
 * VS Code will render command:// links in hover pop ups if they are marked as trusted.
 *
 * @param hover The hover to fix the jdt:// links for
 * @returns the hover with all jdt:// links replaced with a command:// link that opens the jdt URI
 */
export function fixJdtSchemeHoverLinks(hover: Hover): Hover {
  const newContents: (MarkedString | MarkdownString)[] = [];
  for (const content of hover.contents) {
    if (content instanceof MarkdownString) {
      newContents.push(fixJdtLinksInDocumentation(content));
    } else {
      newContents.push(content);
    }
  }
  hover.contents = newContents;
  return hover;
}
