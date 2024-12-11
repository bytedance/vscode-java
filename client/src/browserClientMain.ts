// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { ExtensionContext, workspace } from 'vscode';
import { UriParse } from './utils';

import { JavaClient } from './javaClient';
import { channel, logger, serverChannel } from './utils';

export async function activate(context: ExtensionContext) {
  const enableTrace = workspace.getConfiguration('java').get<boolean>('trace.lsp', false);
  logger.setEnabled(enableTrace);

  logger.info('try to activate java language server...');

  const clientId: string = 'vscode-java-ls-client';
  // java language server ws endpoint
  const endpoint = 'ws://localhost:8080/java-ls/ws';
  UriParse.init(endpoint, clientId);

  const wss = workspace.workspaceFolders;
  if (!wss?.length) {
    throw new Error('No workspace opened');
  }

  context.subscriptions.push(channel);
  context.subscriptions.push(serverChannel);

  return new JavaClient(context);
}

export async function deactivate() {}
