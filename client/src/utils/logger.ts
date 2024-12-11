// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { window } from 'vscode';
import type { OutputChannel } from 'vscode';

const channelName = 'JDT';

export const channel = window.createOutputChannel(channelName);
export const serverChannel = window.createOutputChannel(`${channelName} (Server)`);

export class Logger {
    private static instance: Logger | null = null;
    private enabled = false;
    private readonly output: OutputChannel;
  
    private constructor(channel: OutputChannel) {
      this.output = channel;
    }
  
    public static initialize(channel: OutputChannel): void {
      if (!Logger.instance) {
        Logger.instance = new Logger(channel);
      }
    }
  
    public static getInstance(): Logger {
      if (!Logger.instance) {
        throw new Error('Logger is not initialized. Call Logger.initialize(channel) first.');
      }
      return Logger.instance;
    }
  
    public setEnabled(enabled: boolean) {
      if (Logger.instance) {
        Logger.instance.enabled = enabled;
      }
    }
  
    public enable() {
      if (Logger.instance) {
        Logger.instance.enabled = true;
      }
    }
  
    public disable() {
      if (Logger.instance) {
        Logger.instance.enabled = false;
      }
    }
  
    public debug(...msg: [unknown, ...unknown[]]): void {
      if (!this.enabled) {
        return;
      }
      this.write('DEBUG', ...msg);
    }
  
    public info(...msg: [unknown, ...unknown[]]): void {
      this.write('INFO', ...msg);
    }
  
    public warn(...msg: [unknown, ...unknown[]]): void {
      this.write('WARN', ...msg);
    }
  
    public error(...msg: [unknown, ...unknown[]]): void {
      this.write('ERROR', ...msg);
      this.output.show(true);
    }
  
    private write(label: string, ...messageParts: unknown[]): void {
      const message = messageParts.map(this.stringify).join(' ');
      const dateTime = new Date().toLocaleString();
      this.output.appendLine(`${label} [${dateTime}]: ${message}`);
    }
  
    private stringify(val: unknown): string {
      if (typeof val === 'string') {
        return val;
      }
      return JSON.stringify(val, undefined, 2);
    }
  
    public getChannel(): OutputChannel {
      return this.output;
    }
  }

Logger.initialize(channel);
export const logger = Logger.getInstance();
