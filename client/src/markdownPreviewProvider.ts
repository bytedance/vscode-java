// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { Disposable, WebviewPanel, window, ViewColumn, commands, Uri, Webview, ExtensionContext, env } from 'vscode';
import * as path from 'path-browserify';
import * as Commands from './command';
import { getNonce } from './webviewUtils';
import { logger } from './utils';
import { fetchFileContent } from './utils/fetchFileContent';

class MarkdownPreviewProvider implements Disposable {
  private panel: WebviewPanel | undefined;
  // a cache maps document path to rendered html
  private documentCache: Map<string, string> = new Map<string, string>();
  private disposables: Disposable[] = [];

  public async show(
    markdownFilePath: string,
    title: string,
    section: string,
    context: ExtensionContext
  ): Promise<void> {
    // should get the origin from the webview
    const origin: string = '';
    if (!this.panel) {
      this.panel = window.createWebviewPanel('java.markdownPreview', title, ViewColumn.Active, {
        localResourceRoots: [
          Uri.file(path.join(context.extensionPath, 'webview-resources')),
          Uri.file(path.dirname(markdownFilePath)),
        ],
        retainContextWhenHidden: true,
        enableFindWidget: true,
        enableScripts: true,
      });
    }

    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      })
    );

    this.panel.iconPath = Uri.parse(`${origin}${path.join(context.extensionPath, 'icons', 'icon128.png')}`);
    this.panel.webview.html = await this.getHtmlContent(this.panel.webview, origin, markdownFilePath, section, context);
    this.panel.title = title;
    this.panel.reveal(this.panel.viewColumn);
  }

  public dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  protected async getHtmlContent(
    webview: Webview,
    origin: string,
    markdownFilePath: string,
    section: string,
    context: ExtensionContext
  ): Promise<string> {
    const nonce: string = getNonce();
    const styles: string = this.getStyles(origin, webview, context);
    let body: string | undefined = this.documentCache.get(markdownFilePath);
    if (!body) {
      logger.debug('markdownFilePath', markdownFilePath);
      let markdownString = await fetchFileContent(`${origin}${markdownFilePath}`);
      // let markdownString: string = await fse.readFile(markdownFilePath, 'utf8');
      // let markdownString = '**abc**';
      markdownString = markdownString?.replace(/__VSCODE_ENV_APPNAME_PLACEHOLDER__/, env.appName);
      body = await commands.executeCommand(Commands.MARKDOWN_API_RENDER, markdownString);
      this.documentCache.set(markdownFilePath, body ?? (markdownString || ''));
    }
    return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src 'self' ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';"/>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${styles}
                <base href="${webview.asWebviewUri(Uri.file(markdownFilePath))}">
            </head>
            <body class="vscode-body scrollBeyondLastLine wordWrap showEditorSelection">
                ${body}
                <button class="btn floating-bottom-right" id="back-to-top-btn">
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M8 6.04042L3.02022 11.0202L2.31311 10.3131L7.64644 4.97976L8.35355 4.97976L13.6869 10.3131L12.9798 11.0202L8 6.04042Z"/>
                    </svg>
                </button>
                <script nonce="${nonce}">
                    (function() {
                        var element = document.querySelector('[id^="${section}"]');
                        if (element) {
                            element.scrollIntoView(true);
                        }
                        var backToTopBtn = document.getElementById('back-to-top-btn');
                        if (backToTopBtn) {
                            backToTopBtn.onclick = () => document.documentElement.scrollTop = 0;
                        }
                    })();
                </script>
            </body>
            </html>
        `;
  }

  protected getStyles(origin: string, webview: Webview, context: ExtensionContext): string {
    const styles: Uri[] = [
      Uri.parse(`${origin}${path.join(context.extensionPath, 'webview-resources', 'highlight.css')}`),
      Uri.parse(`${origin}${path.join(context.extensionPath, 'webview-resources', 'markdown.css')}`),
      Uri.parse(`${origin}${path.join(context.extensionPath, 'webview-resources', 'document.css')}`),
    ];
    return styles
      .map(
        (styleUri: Uri) => `<link rel="stylesheet" type="text/css" href="${webview.asWebviewUri(styleUri).toString()}">`
      )
      .join('\n');
  }
}

export const markdownPreviewProvider: MarkdownPreviewProvider = new MarkdownPreviewProvider();
