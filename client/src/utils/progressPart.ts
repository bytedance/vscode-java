// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import {
  window as Window,
  Progress,
  ProgressLocation,
  CancellationToken,
  Disposable,
} from 'vscode';

import * as Is from './is';
import {
  LanguageClient,
  ProgressToken,
  WorkDoneProgress,
  WorkDoneProgressBegin,
  WorkDoneProgressCancelNotification,
  WorkDoneProgressReport,
} from 'vscode-languageclient/browser';

export class ProgressPart {
  private _infinite!: boolean;
  private _reported: number;
  private _progress!: Progress<{ message?: string; increment?: number }>;
  private _cancellationToken!: CancellationToken;
  private _disposable: Disposable | undefined;

  private _resolve: (() => void) | undefined;
  private _reject: ((reason?: any) => void) | undefined;

  public constructor(
    private _client: LanguageClient,
    private _token: ProgressToken
  ) {
    this._reported = 0;
    this._disposable = this._client.onProgress(
      WorkDoneProgress.type,
      this._token,
      (value) => {
        switch (value.kind) {
          case 'begin':
            this.begin(value);
            break;
          case 'report':
            this.report(value);
            break;
          case 'end':
            this.done();
            break;
        }
      }
    );
  }

  private begin(params: WorkDoneProgressBegin): void {
    // Since we don't use commands this will be a silent window progress with a hidden notification.
    Window.withProgress<void>(
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
          this._client.sendNotification(
            WorkDoneProgressCancelNotification.type,
            { token: this._token }
          );
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
      let percentage = Math.max(0, Math.min(params.percentage, 100));
      let delta = Math.max(0, percentage - this._reported);
      this._progress.report({ message: params.message, increment: delta });
      this._reported += delta;
    }
  }

  public cancel(): void {
    if (this._disposable) {
      this._disposable.dispose();
      this._disposable = undefined;
    }
    if (this._reject) {
      this._reject();
      this._resolve = undefined;
      this._reject = undefined;
    }
  }

  public done(): void {
    if (this._disposable) {
      this._disposable.dispose();
      this._disposable = undefined;
    }
    if (this._resolve) {
      this._resolve();
      this._resolve = undefined;
      this._reject = undefined;
    }
  }
}
