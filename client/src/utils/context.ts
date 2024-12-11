// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import * as vscode from 'vscode';

export function setContext(key: string, value: any): Thenable<void> {
  return vscode.commands.executeCommand('setContext', key, value);
}
