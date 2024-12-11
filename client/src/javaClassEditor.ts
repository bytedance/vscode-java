// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import * as path from 'path-browserify';
import * as vscode from 'vscode';
import { Uri, window, ExtensionContext } from 'vscode';
import { getNonce } from './webviewUtils';

class JavaClassDocument implements vscode.CustomDocument {
  constructor(uri: Uri) {
    this.uri = uri;
  }

  uri: Uri;

  dispose(): void {}
}

export class JavaClassEditorProvider implements vscode.CustomReadonlyEditorProvider {
  private context: ExtensionContext;

  openCustomDocument(
    uri: Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken
  ): JavaClassDocument {
    return new JavaClassDocument(uri);
  }

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  public static readonly viewType = 'decompiled.javaClass';

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const nonce: string = getNonce();
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [Uri.joinPath(Uri.parse(this.context.extensionPath), 'webview-resources')]
		};
		const classUri = Uri.parse((document.uri.toString()).replace(/^file/, "class"));
		const styleUri = Uri.file(
			path.join(this.context.extensionPath, 'webview-resources', 'button.css')
		);
		const style: string = `<link rel="stylesheet" type="text/css" href="${webviewPanel.webview.asWebviewUri(styleUri).toString()}">`;
    webviewPanel.webview.html = `
		<html lang="en">
		<head>
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webviewPanel.webview.cspSource};">
			${style}
		</head>
		<body>
			<div class="center">
				<p>This file is not displayed in the text editor because it is a Java class file. Click here to decompile and open.</p>
				<button id="btn"><center>Decompile Class File</center></button>
			<div>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				document.getElementById("btn").addEventListener("click", decompiled);
				function decompiled() {
					vscode.postMessage({ command: 'decompiled' });
				}
			</script>
		</body>
		</html>
		`;
    webviewPanel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'decompiled':
            webviewPanel.dispose();
            window.showTextDocument(classUri, { preview: false });
            return;
          default:
            return;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }
}
