// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { window as Window, Progress, ProgressLocation, CancellationToken, Disposable } from 'vscode';

import * as Is from './is';
import {
  LanguageClient,
  ProgressToken,
  WorkDoneProgressBegin,
  WorkDoneProgressCancelNotification,
  WorkDoneProgressReport,
} from 'vscode-languageclient/browser';

/**
 * 基于 $/progress 处理 LSP 状态，不依赖服务端 window/workDoneProgress/create
 */
export class IProgress implements Disposable {
  private _infinite!: boolean;
  private _reported: number;
  private _progress!: Progress<{ message?: string; increment?: number }>;
  private _cancellationToken!: CancellationToken;
  private _disposable: Disposable | undefined;

  private _resolve: (() => void) | undefined;
  private _reject: ((reason?: any) => void) | undefined;
  private _token: ProgressToken | undefined;

  public constructor(private _client: LanguageClient) {
    this._reported = 0;
    this._disposable = this._client.onNotification('$/progress', ({ value, token }) => {
      switch (value.kind) {
        case 'begin':
          this._token = token;
          this.begin(value);
          break;
        case 'report':
          this.report(value);
          break;
        case 'end':
          this.done();
          break;
        default:
          return;
      }
    });
  }

  private begin(params: WorkDoneProgressBegin): void {
    this.cancel();

    Window.withProgress(
      {
        location: ProgressLocation.Window,
        cancellable: params.cancellable,
        title: params.title,
      },
      async (progress, cancellationToken) => {
        this._progress = progress;
        this._infinite = params.percentage === undefined;
        this._cancellationToken = cancellationToken;
        this._cancellationToken.onCancellationRequested(() => {
          this._client.sendNotification(WorkDoneProgressCancelNotification.type, { token: this._token });
        });
        this.report(params);
        return new Promise<void>((resolve, reject) => {
          this._resolve = resolve;
          this._reject = reject;
        });
      }
    );
  }

  private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    if (this._infinite && Is.string(params.message)) {
      this._progress.report({ message: params.message });
    } else if (Is.number(params.percentage)) {
      const percentage = Math.max(0, Math.min(params.percentage, 100));
      const delta = Math.max(0, percentage - this._reported);
      this._progress.report({ message: params.message, increment: delta });
      this._reported += delta;
    }
  }

  public cancel(): void {
    if (this._reject) {
      this._reject();
      this._resolve = undefined;
      this._reject = undefined;
    }
  }

  public done(): void {
    if (this._resolve) {
      this._resolve();
      this._resolve = undefined;
      this._reject = undefined;
    }
  }

  dispose(): any {
    if (this._disposable) {
      this._disposable.dispose();
      this._disposable = undefined;
    }
  }
}
