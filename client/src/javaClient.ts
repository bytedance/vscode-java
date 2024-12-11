// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import * as lc from 'vscode-languageclient/browser';
import * as path from 'path-browserify';

import {
  CodeActionContext,
  commands,
  CompletionItem,
  ConfigurationTarget,
  Diagnostic,
  env,
  EventEmitter,
  ExtensionContext,
  extensions,
  IndentAction,
  InputBoxOptions,
  languages,
  MarkdownString,
  QuickPickItemKind,
  RelativePattern,
  TextDocument,
  TextEditorRevealType,
  UIKind,
  Uri,
  ViewColumn,
  window,
  workspace,
  WorkspaceConfiguration,
  Disposable,
  CodeActionKind,
  QuickPickItem,
  CancellationToken,
  ProgressLocation,
  Location,
} from 'vscode';
import { Converter } from 'vscode-languageclient/lib/common/protocolConverter';

import { createClient } from './client';
import { disposeAll, getAllJavaProjects, logger, ProgressPart, UriParse } from './utils';
import * as Commands from './command';
import { WorkDoneProgressCreateParams, WorkDoneProgressCreateRequest } from 'vscode-languageclient/browser';
import { registerClientProviders } from './providerDispatcher';
import { ShortcutQuickPickItem } from './serverStatusBarProvider';
import { ServerStatusKind } from './serverStatus';
import { buildFilePatterns, getShortcuts, IJavaShortcut } from './plugin';
import { JavaClassEditorProvider } from './javaClassEditor';
import {
  BuildProjectParams,
  BuildProjectRequest,
  CompileWorkspaceRequest,
  CompileWorkspaceStatus,
  ExecuteClientCommandRequest,
  ServerNotification,
  LinkLocation,
  FindLinks,
  ProjectConfigurationUpdateRequest,
  SourceAttachmentRequest,
  SourceAttachmentResult,
  SourceAttachmentAttribute,
} from './protocol';
import { markdownPreviewProvider } from './markdownPreviewProvider';
import { javaRefactorKinds, RefactorDocumentProvider } from './codeActionProvider';
import * as refactorAction from './refactorAction';
import * as buildPath from './buildpath';
import { typeHierarchyTree } from './typeHierarchy/typeHierarchyTree';
import { TypeHierarchyDirection, TypeHierarchyItem } from './typeHierarchy/protocol';

const jdtEventEmitter = new EventEmitter<Uri>();

export class JavaClient implements Disposable {
  private _client: lc.LanguageClient | undefined;
  private _dispose: Disposable[] = [];
  private p2c: Converter;

  constructor(private context: ExtensionContext) {
    this._client = createClient(context);
    this.p2c = this._client.protocol2CodeConverter;

    this.initOnceBeforeClientStart(this._client);
    this.initBeforeClientStart(this._client);

    this._client.start().then(() => {
      this.initOnceAfterClientStart();
      this.initAfterClientStart(this._client!);
    });

    context.subscriptions.push(
      new Disposable(async () => {
        await this._client?.stop();
        await this._client?.dispose();
      })
    );
  }

  dispose() {
    logger.info('dispose jdt client');
    return disposeAll(this._dispose);
  }

  private initOnceBeforeClientStart(client: lc.LanguageClient) {
    buildPath.registerCommands(this.context);
    refactorAction.registerCommands(client, this.context);
  }

  private initBeforeClientStart(client: lc.LanguageClient) {
    this.registerCustomCommands(client);
    this.registerCustomProvider();

    this._dispose.push(
      commands.registerCommand(Commands.EXECUTE_WORKSPACE_COMMAND, (command, ...rest) => {
        let token: lc.CancellationToken;
        let commandArgs: any[] = rest;
        if (rest && rest.length && lc.CancellationToken.is(rest[rest.length - 1])) {
          token = rest[rest.length - 1];
          commandArgs = rest.slice(0, rest.length - 1);
        }
        const params: lc.ExecuteCommandParams = {
          command,
          arguments: commandArgs,
        };
        if (token) {
          return client.sendRequest(lc.ExecuteCommandRequest.type, params, token);
        } else {
          return client.sendRequest(lc.ExecuteCommandRequest.type, params);
        }
      }),
      commands.registerCommand(Commands.OPEN_OUTPUT, () => client.outputChannel.show(ViewColumn.Three))
    );
  }

  private registerCustomCommands(client: lc.LanguageClient) {
    this._dispose.push(
      commands.registerCommand(Commands.OPEN_STATUS_SHORTCUT, async (status: string) => {
        const items: ShortcutQuickPickItem[] = [];
        if (status === ServerStatusKind.error || status === ServerStatusKind.warning) {
          commands.executeCommand('workbench.panel.markers.view.focus');
        } else {
          commands.executeCommand(Commands.SHOW_SERVER_TASK_STATUS, true);
        }

        items.push(
          ...getShortcuts().map((shortcut: IJavaShortcut) => ({
            label: shortcut.title,
            command: shortcut.command,
            args: shortcut.arguments,
          }))
        );

        const choice = await window.showQuickPick(items);
        if (!choice) {
          return;
        }

        if (choice.command) {
          commands.executeCommand(choice.command, ...(choice.args || []));
        }
      }),
      commands.registerCommand(Commands.OPEN_SERVER_LOG, (column: ViewColumn) => openServerLogFile(column)),
      commands.registerCommand(Commands.OPEN_FILE, async (uri: string) => {
        const parsedUri = Uri.parse(uri);
        const editor = await window.showTextDocument(parsedUri);
        // Reveal the document at the specified line, if possible (e.g. jumping to a specific javadoc method).
        if (editor && parsedUri.scheme === 'jdt' && parsedUri.fragment) {
          const line = parseInt(parsedUri.fragment);
          if (isNaN(line) || line < 1 || line > editor.document.lineCount) {
            return;
          }
          const { range } = editor.document.lineAt(line - 1);
          editor.revealRange(range, TextEditorRevealType.AtTop);
        }
      }),
      commands.registerCommand(Commands.REFRESH_BUNDLES_COMMAND, () => []),
      commands.registerCommand(Commands.TEMPLATE_VARIABLES, () => {
        markdownPreviewProvider.show(
          this.context.asAbsolutePath(path.join('document', `${Commands.TEMPLATE_VARIABLES}.md`)),
          'Predefined Variables',
          '',
          this.context
        );
      }),
      commands.registerCommand(Commands.NOT_COVERED_EXECUTION, () => {
        markdownPreviewProvider.show(
          this.context.asAbsolutePath(path.join('document', '_java.notCoveredExecution.md')),
          'Not Covered Maven Plugin Execution',
          '',
          this.context
        );
      }),
      commands.registerCommand(Commands.METADATA_FILES_GENERATION, () => {
        markdownPreviewProvider.show(
          this.context.asAbsolutePath(path.join('document', '_java.metadataFilesGeneration.md')),
          'Metadata Files Generation',
          '',
          this.context
        );
      }),
      commands.registerCommand(Commands.LEARN_MORE_ABOUT_CLEAN_UPS, () => {
        markdownPreviewProvider.show(
          this.context.asAbsolutePath(path.join('document', `${Commands.LEARN_MORE_ABOUT_CLEAN_UPS}.md`)),
          'Java Clean Ups',
          'java-clean-ups',
          this.context
        );
      }),
      commands.registerCommand(Commands.CREATE_MODULE_INFO_COMMAND, async () => {
        const uri = await askForProjects(
          window.activeTextEditor?.document.uri,
          'Please select the project to create module-info.java',
          false
        );
        if (!uri?.length) {
          return;
        }

        const moduleInfoUri: string = await commands.executeCommand(
          Commands.EXECUTE_WORKSPACE_COMMAND,
          Commands.CREATE_MODULE_INFO,
          uri[0].toString()
        );

        if (moduleInfoUri) {
          await window.showTextDocument(UriParse.parseUri(moduleInfoUri));
        }
      })
    );
  }

  private registerCustomProvider() {
    registerClientProviders(this._client, this.context, { contentProviderEvent: jdtEventEmitter.event });

    const classEditorProviderRegistration = window.registerCustomEditorProvider(
      JavaClassEditorProvider.viewType,
      new JavaClassEditorProvider(this.context)
    );
    this._dispose.push(classEditorProviderRegistration);

    this._dispose.push(markdownPreviewProvider);

    this._dispose.push(
      languages.registerCodeActionsProvider(
        { scheme: 'file', language: 'java' },
        new RefactorDocumentProvider(),
        RefactorDocumentProvider.metadata
      ),
      commands.registerCommand(Commands.LEARN_MORE_ABOUT_REFACTORING, (kind: CodeActionKind) => {
        const sectionId: string = javaRefactorKinds.get(kind) || '';
        markdownPreviewProvider.show(
          this.context.asAbsolutePath(path.join('document', `${Commands.LEARN_MORE_ABOUT_REFACTORING}.md`)),
          'Java Refactoring',
          sectionId,
          this.context
        );
      })
    );
  }

  private initOnceAfterClientStart() {}

  private initAfterClientStart(client: lc.LanguageClient) {
    // 处理 $/progress notification
    const createHandler = (params: WorkDoneProgressCreateParams) => {
      logger.debug('createHandler', params);
      new ProgressPart(client, params.token);
    };
    client.onRequest(WorkDoneProgressCreateRequest.type, createHandler);
    // 启用命令注册
    commands.executeCommand('setContext', 'javaLSReady', true);
    // 暂时屏蔽掉通知
    client.onNotification('window/showMessage', () => {});
    client.onNotification(lc.ShowMessageRequest.method, (params: lc.ShowMessageParams) => {
      logger.info(params.message);
    });
    // 处理服务主动发送的退出消息
    client.onNotification('$/exit', params => {
      // 强制客户端不重连
      if (!params?.force) {
        this.restartServer();
      }
    });
    // 注册 jdt 自定义行为
    this.registerCustomActions(client);
  }

  private registerCustomActions(client: lc.LanguageClient) {
    client.onRequest(ExecuteClientCommandRequest.type, params =>
      commands.executeCommand(params.command, ...params.arguments)
    );

    client.onNotification(ServerNotification.type, params => {
      commands.executeCommand(params.command, ...params.arguments);
    });

    typeHierarchyTree.initialize(client);

    this._dispose.push(
      commands.registerCommand(Commands.CONFIGURATION_UPDATE, async uri => {
        await projectConfigurationUpdate(client, uri);
      }),
      commands.registerCommand(
        Commands.NAVIGATE_TO_SUPER_IMPLEMENTATION_COMMAND,
        async (location: LinkLocation | Uri) => {
          let superImplLocation: Location | undefined;

          if (!location) {
            // comes from command palette
            if (window.activeTextEditor?.document.languageId !== 'java') {
              return;
            }
            location = window.activeTextEditor.document.uri;
          }

          if (location instanceof Uri) {
            // comes from context menu
            const params: lc.TextDocumentPositionParams = {
              textDocument: {
                uri: location.toString(),
              },
              position: client.code2ProtocolConverter.asPosition(window.activeTextEditor.selection.active),
            };
            const response = await client.sendRequest(FindLinks.type, {
              type: 'superImplementation',
              position: params,
            });

            if (response && response.length > 0) {
              const superImpl = response[0];
              superImplLocation = new Location(Uri.parse(superImpl.uri), this.p2c.asRange(superImpl.range));
            }
          } else {
            // comes from hover information
            superImplLocation = new Location(Uri.parse(decodeBase64(location.uri)), this.p2c.asRange(location.range));
          }

          if (superImplLocation) {
            return window.showTextDocument(superImplLocation.uri, {
              preserveFocus: true,
              selection: superImplLocation.range,
            });
          } else {
            return showNoLocationFound('No super implementation found');
          }
        }
      ),

      commands.registerCommand(Commands.SHOW_TYPE_HIERARCHY, (location: any) => {
        if (location instanceof Uri) {
          typeHierarchyTree.setTypeHierarchy(
            new Location(location, window.activeTextEditor.selection.active),
            TypeHierarchyDirection.both
          );
        } else {
          if (window.activeTextEditor?.document?.languageId !== 'java') {
            return;
          }
          typeHierarchyTree.setTypeHierarchy(
            new Location(window.activeTextEditor.document.uri, window.activeTextEditor.selection.active),
            TypeHierarchyDirection.both
          );
        }
      }),

      commands.registerCommand(Commands.SHOW_CLASS_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.both);
      }),

      commands.registerCommand(Commands.SHOW_SUPERTYPE_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.parents);
      }),

      commands.registerCommand(Commands.SHOW_SUBTYPE_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.children);
      }),

      commands.registerCommand(Commands.CHANGE_BASE_TYPE, (item: TypeHierarchyItem) => {
        typeHierarchyTree.changeBaseItem(item);
      }),

      commands.registerCommand(
        Commands.BUILD_PROJECT,
        async (uris: Uri[] | Uri, isFullBuild: boolean, token: CancellationToken) => {
          let resources: Uri[] = [];
          if (uris instanceof Uri) {
            resources.push(uris);
          } else if (Array.isArray(uris)) {
            for (const uri of uris) {
              if (uri instanceof Uri) {
                resources.push(uri);
              }
            }
          }

          if (!resources.length) {
            resources = await askForProjects(
              window.activeTextEditor?.document.uri,
              'Please select the project(s) to rebuild.'
            );
            if (!resources?.length) {
              return;
            }
          }

          const params: BuildProjectParams = {
            identifiers: resources.map(u => ({ uri: u.toString() })),
            // we can consider expose 'isFullBuild' according to users' feedback,
            // currently set it to true by default.
            isFullBuild: isFullBuild === undefined ? true : isFullBuild,
          };

          return window.withProgress({ location: ProgressLocation.Window }, async p => {
            p.report({ message: 'Rebuilding projects...' });
            // eslint-disable-next-line no-async-promise-executor
            return new Promise(async (resolve, reject) => {
              const start = new Date().getTime();

              let res: CompileWorkspaceStatus;
              try {
                res = token
                  ? await client.sendRequest(BuildProjectRequest.type, params, token)
                  : await client.sendRequest(BuildProjectRequest.type, params);
              } catch (error) {
                if (error && error.code === -32800) {
                  // Check if the request is cancelled.
                  res = CompileWorkspaceStatus.cancelled;
                }
                reject(error);
              }

              const elapsed = new Date().getTime() - start;
              const humanVisibleDelay = elapsed < 1000 ? 1000 : 0;
              setTimeout(() => {
                // set a timeout so user would still see the message when build time is short
                resolve(res);
              }, humanVisibleDelay);
            });
          });
        }
      ),
      commands.registerCommand(Commands.COMPILE_WORKSPACE, (isFullCompile: boolean, token?: CancellationToken) =>
        window.withProgress({ location: ProgressLocation.Window }, async p => {
          if (typeof isFullCompile !== 'boolean') {
            const selection = await window.showQuickPick(['Incremental', 'Full'], {
              placeHolder: 'please choose compile type:',
            });
            isFullCompile = selection !== 'Incremental';
          }
          p.report({ message: 'Compiling workspace...' });
          const start = new Date().getTime();
          let res: CompileWorkspaceStatus;
          try {
            res = token
              ? await client.sendRequest(CompileWorkspaceRequest.type, isFullCompile, token)
              : await client.sendRequest(CompileWorkspaceRequest.type, isFullCompile);
          } catch (error) {
            if (error && error.code === -32800) {
              // Check if the request is cancelled.
              res = CompileWorkspaceStatus.cancelled;
            } else {
              throw error;
            }
          }

          const elapsed = new Date().getTime() - start;
          const humanVisibleDelay = elapsed < 1000 ? 1000 : 0;
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              // set a timeout so user would still see the message when build time is short
              if (res === CompileWorkspaceStatus.succeed) {
                resolve(res);
              } else {
                reject(res);
              }
            }, humanVisibleDelay);
          });
        })
      ),
      commands.registerCommand(
        Commands.UPDATE_SOURCE_ATTACHMENT_CMD,
        async (classFileUri: Uri): Promise<boolean | undefined> => {
          const resolveRequest: SourceAttachmentRequest = {
            classFileUri: classFileUri.toString(),
          };
          const resolveResult: SourceAttachmentResult = await (commands.executeCommand(
            Commands.EXECUTE_WORKSPACE_COMMAND,
            Commands.RESOLVE_SOURCE_ATTACHMENT,
            JSON.stringify(resolveRequest)
          ) as SourceAttachmentResult);
          if (resolveResult.errorMessage) {
            window.showErrorMessage(resolveResult.errorMessage);
            return false;
          }

          const attributes: SourceAttachmentAttribute = resolveResult.attributes || {};
          const defaultPath = attributes.sourceAttachmentPath || attributes.jarPath;
          const sourceFileUris: Uri[] | undefined = await window.showOpenDialog({
            defaultUri: defaultPath ? Uri.file(defaultPath) : undefined,
            openLabel: 'Select Source File',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
              'Source files': ['jar', 'zip'],
            },
          });

          if (sourceFileUris?.length) {
            const updateRequest: SourceAttachmentRequest = {
              classFileUri: classFileUri.toString(),
              attributes: {
                ...attributes,
                sourceAttachmentPath: sourceFileUris[0].fsPath,
              },
            };
            const updateResult: SourceAttachmentResult = await (commands.executeCommand(
              Commands.EXECUTE_WORKSPACE_COMMAND,
              Commands.UPDATE_SOURCE_ATTACHMENT,
              JSON.stringify(updateRequest)
            ) as SourceAttachmentResult);
            if (updateResult.errorMessage) {
              window.showErrorMessage(updateResult.errorMessage);
              return false;
            }

            // Notify jdt content provider to rerender the classfile contents.
            jdtEventEmitter.fire(classFileUri);
            return true;
          }
        }
      )
    );
  }

  async start(): Promise<void> {
    if (this._client) {
      logger.info('client is running, ignore start command');
      return;
    }

    this._client = createClient(this.context);
    this.initBeforeClientStart(this._client);
    await this._client.start();
    this.initAfterClientStart(this._client);
    logger.info(`client is running now, state: ${this._client.state}`);
  }

  async stop() {
    if (!this._client) {
      logger.info('client is not running, ignore stop command');
      return;
    }

    logger.info('client is stopping');

    await this._client.stop();
    await this._client.dispose();

    this.dispose();
    this._client = undefined;
  }

  public async restartServer() {
    await this.stop();
    await this.start();
  }

  public get client() {
    return this._client;
  }

  public get subscriptions(): Disposable[] {
    return this.context.subscriptions;
  }
}

function openLogFile(
  logFile: Uri,
  openingFailureWarning: string,
  column: ViewColumn = ViewColumn.Active
): Thenable<boolean> {
  return workspace
    .openTextDocument(logFile)
    .then(
      doc => {
        if (!doc) {
          return false;
        }
        return window.showTextDocument(doc, { viewColumn: column, preview: false }).then(editor => !!editor);
      },
      () => false
    )
    .then(didOpen => {
      if (!didOpen) {
        window.showWarningMessage(openingFailureWarning);
      }
      return didOpen;
    });
}

function openServerLogFile(column: ViewColumn = ViewColumn.Active): Thenable<boolean> {
  const wss = workspace.workspaceFolders;
  const workspace_root = wss?.length ? path.basename(wss[0].uri.toString()) : undefined;
  if (!workspace_root) {
    return Promise.resolve(false);
  }
  const serverLogFile = path.join('.jdt_data', workspace_root, '.metadata', '.log');
  return openLogFile(UriParse.parseUri(serverLogFile), 'Could not open Java Language Server log file', column);
}

/**
 * Ask user to select projects and return the selected projects' uris.
 * @param activeFileUri the uri of the active file.
 * @param placeHolder message to be shown in quick pick.
 * @param canPickMany
 */
export async function askForProjects(
  activeFileUri: Uri | undefined,
  placeHolder: string,
  canPickMany = true
): Promise<Uri[]> {
  const projectPicks = await generateProjectPicks(activeFileUri);
  if (!projectPicks?.length) {
    return [];
  } else if (projectPicks.length === 1 && projectPicks[0].detail) {
    return [UriParse.parseUri(projectPicks[0].detail)];
  }

  const choices: QuickPickItem[] | QuickPickItem | undefined = await window.showQuickPick(projectPicks, {
    matchOnDetail: true,
    placeHolder,
    ignoreFocusOut: true,
    canPickMany,
  });

  if (!choices) {
    return [];
  }

  if (Array.isArray(choices)) {
    return choices.map(c => UriParse.parseUri(c.detail));
  }

  return [UriParse.parseUri(choices.detail!)];
}

/**
 * Generate the quick picks for projects selection. An `undefined` value will be return if
 * it's failed to generate picks.
 * @param activeFileUri the uri of the active document.
 */
async function generateProjectPicks(activeFileUri: Uri | undefined): Promise<QuickPickItem[] | undefined> {
  let projectUriStrings: string[];
  try {
    projectUriStrings = await getAllJavaProjects();
  } catch (e) {
    return undefined;
  }

  const projectPicks: QuickPickItem[] = projectUriStrings
    .map(uriString => {
      const projectPath = Uri.parse(uriString).fsPath;
      return {
        label: path.basename(projectPath),
        detail: projectPath,
      };
    })
    .filter(Boolean);

  // pre-select an active project based on the uri candidate.
  if (activeFileUri?.scheme === 'file') {
    const candidatePath = activeFileUri.fsPath;
    let belongingIndex = -1;
    for (let i = 0; i < projectPicks.length; i++) {
      if (candidatePath.startsWith(projectPicks[i].detail!)) {
        if (belongingIndex < 0 || projectPicks[i].detail!.length > projectPicks[belongingIndex].detail!.length) {
          belongingIndex = i;
        }
      }
    }
    if (belongingIndex >= 0) {
      projectPicks[belongingIndex].picked = true;
    }
  }

  return projectPicks;
}

export function showNoLocationFound(message: string): void {
  commands.executeCommand(
    Commands.GOTO_LOCATION,
    window.activeTextEditor.document.uri,
    window.activeTextEditor.selection.active,
    [],
    'goto',
    message
  );
}

function decodeBase64(text: string): string {
  return Buffer.from(text, 'base64').toString('ascii');
}

export async function projectConfigurationUpdate(
  languageClient: lc.LanguageClient,
  uris?: lc.TextDocumentIdentifier | Uri | Uri[]
) {
  let resources = [];
  if (!uris) {
    const activeFileUri: Uri | undefined = window.activeTextEditor?.document.uri;

    if (activeFileUri && isJavaConfigFile(activeFileUri.fsPath)) {
      resources = [activeFileUri];
    } else {
      resources = await askForProjects(activeFileUri, 'Please select the project(s) to update.');
    }
  } else if (uris instanceof Uri) {
    resources.push(uris);
  } else if (Array.isArray(uris)) {
    for (const uri of uris) {
      if (uri instanceof Uri) {
        resources.push(uri);
      }
    }
  } else if ('uri' in uris) {
    resources.push(Uri.parse(uris.uri));
  }

  if (resources.length === 1) {
    await languageClient.sendNotification(ProjectConfigurationUpdateRequest.type, {
      uri: resources[0].toString(),
    });
  } else if (resources.length > 1) {
    await languageClient.sendNotification(ProjectConfigurationUpdateRequest.typeV2, {
      identifiers: resources.map(r => ({ uri: r.toString() })),
    });
  }
}

function isJavaConfigFile(filePath: string) {
  const fileName = path.basename(filePath);
  const regEx = new RegExp(buildFilePatterns.map(r => `(${r})`).join('|'), 'i');
  return regEx.test(fileName);
}
