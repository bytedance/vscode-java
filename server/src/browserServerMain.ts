// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import * as ls from 'vscode-languageserver/browser';
import { LSPLogger } from './utils';

const logger = new LSPLogger('vscode-java', {
  styles: {
    trace: 'gold',
  },
  level: 'trace',
});

interface WorkerInitParams {
  endpoint: string;
  trace: boolean;
}

self.onmessage = function (event: MessageEvent<WorkerInitParams>) {
  const { endpoint, trace } = event.data;

  logger.setEnabled(trace);
  logger.trace('onmessage', 'WORKER INIT', event.data);

  if (!endpoint) {
    return;
  }
  bootstrap(endpoint);
  registerConnectionListener();
};

const pingMethod = '$/ping';
const pongMethod = '$/pong';

function sendPing() {
  if (workerSocket?.readyState === WebSocket.OPEN) {
    const pingMsg = JSON.stringify({
      method: pingMethod,
      jsonrpc: '2.0',
      params: {},
    });
    workerSocket.send(pingMsg);
  }
}

let initializeParams: any;

function setInitializeParams(params: any) {
  initializeParams = params;
}

let serverExit = false;
let ID = 0;
let initialized = false;
const pendingRequests = new Map(); // 存储挂起的请求（promise和它的解决函数
const pendingMessages: any[] = [];

let workerSocket: WebSocket | null;

let connection: ls.Connection | null = null;

function bootstrap(endpoint: string, shouldInitialize = false) {
  if (!connection) {
    const reader = new ls.BrowserMessageReader(self);
    const writer = new ls.BrowserMessageWriter(self);
    connection = ls.createConnection(reader, writer);
  }

  const wsUrl = new URL(endpoint);
  const wsProtocol = decodeURIComponent(wsUrl.password);
  wsUrl.username = wsUrl.password = '';
  const socket = new WebSocket(wsUrl, wsProtocol.split(',').filter(Boolean));
  workerSocket = socket;

  socket.onopen = () => {
    pendingMessages.forEach(message => {
      socket.send(message);
    });

    pendingMessages.length = 0;

    initialized = true;
    serverExit = false;
  };

  socket.onclose = ev => {
    console.log('[socket]: onclose', ev);
    initialized = false;
    // 非 exit 情况下断连，重启server
    if (!serverExit) {
      serverExit = true;
      connection?.sendNotification('$/exit', {});
    }
  };

  socket.onerror = ev => {
    console.log(`[${new Date().toLocaleString}][socket]: onerror`, ev);
    initialized = false;
    // 非 exit 情况下断连，重启server
    if (!serverExit) {
      serverExit = true;
      connection?.sendNotification('$/exit', {});
    }
  };

  socket.onmessage = function (event) {
    const response = JSON.parse(event.data);
    // 检查挂起请求中是否有匹配 ID，如果有则调用 resolve
    if (response.id && pendingRequests.has(response.id)) {
      const result = pendingRequests.get(response.id);
      if (result) {
        const { resolve, message } = result;
        logger.trace(`onRequest: ${response.id}`, message.method, response);
        resolve(response.result);
        pendingRequests.delete(response.id);
      } else {
        logger.trace(`onRequest: ${response.id}`, 'UNKNOWN METHOD', response);
      }
    } else {
      if (!connection) {
        return;
      }
      if (response.method === pongMethod) {
        return;
      }
      if (response.method === 'textDocument/publishDiagnostics') {
        logger.trace('publishDiagnostics', `${response.method}`, response);
        connection.sendDiagnostics(response.params);
      } else if (response.method === '$/exit') {
        // exit 情况下 socket 断连，通知 client 重启
        logger.trace('onNotification', '$/exit', response);
        serverExit = true;
        connection.sendNotification('$/exit', response.params);
        socket.close();
      } else if (response.method && response.params && response.id) {
        logger.trace('get request', `${response.method}: ${response.id}`, response);
        connection.sendRequest(response.method, response.params).then(res => {
          sendResponse({ result: res }, response.method, response.id);
        });
      } else if (response.method && response.params) {
        logger.trace('onNotification', `${response.method}`, response);
        connection.sendNotification(response.method, response.params);
      } else {
        logger.trace('unhandled onmessage', `${response.method || 'Recv JSONRPC DATA'}`, response);
      }
    }
  };

  if (shouldInitialize) {
    sendInitializeRequest();
  }

  setInterval(sendPing, 20 * 1000);
}

function registerConnectionListener() {
  if (!connection) {
    return;
  }
  connection.onInitialize((params: ls.InitializeParams) => sendInitializeRequest(params));

  connection.onRequest((method: string, params: object | any[] | undefined, token: ls.CancellationToken) =>
    sendRequest({
      params,
      method,
    })
  );

  connection.onCompletion(
    (params: ls.CompletionParams) =>
      sendRequest({
        params,
        method: ls.CompletionRequest.method,
      }) as Promise<undefined>
  );

  connection.onNotification((method: string, params: any[] | object | undefined) => {
    const payload = {
      params,
      method,
      jsonrpc: '2.0',
    };
    logger.trace('sendNotification', method, payload);
    if (method === '$/plugin_exit') {
      serverExit = true;
      workerSocket && workerSocket.close();
      return;
    }
    workerSocket && workerSocket.send(JSON.stringify(payload));
  });

  connection.onDidOpenTextDocument(params => {
    const payload = {
      params,
      method: 'textDocument/didOpen',
      jsonrpc: '2.0',
    };
    logger.trace('onDidOpenTextDocument', 'textDocument/didOpen', payload);
    workerSocket && workerSocket.send(JSON.stringify(payload));
  });

  connection.onExecuteCommand(params => {
    if (params.command === '_typescript.applyWorkspaceEdit' && params?.arguments?.[0]) {
      return connection?.workspace.applyEdit(params.arguments[0] as ls.WorkspaceEdit);
    }

    return sendRequest({
      params,
      method: ls.ExecuteCommandRequest.method,
    });
  });

  connection.onDidChangeConfiguration(params => {
    logger.trace('onDidChangeConfiguration', 'configuration', params);
  });

  connection.listen();
}

async function sendRequest(message: Record<string, any>) {
  return new Promise((resolve, reject) => {
    const requestId = ++ID;
    const withID = JSON.stringify({
      ...message,
      id: requestId,
      jsonrpc: '2.0',
    });
    pendingRequests.set(requestId, { resolve, message });
    logger.trace(`send Request: ${requestId}`, message.method, withID);

    // 发送消息或放入队列
    if (initialized && workerSocket) {
      workerSocket.send(withID);
    } else {
      pendingMessages.push(withID);
    }

    // 超时检查逻辑
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        // 移除挂起的请求，并reject promise
        pendingRequests.delete(requestId);
        logger.trace(`Request ${requestId} timeout`, message.method, withID);
        // 不返回 reject 以免有报错通知
        // reject(new Error(`Request ${ID} timeout`));
      }
    }, 30000); // 设置超时时间为30秒
  });
}

async function sendResponse(message: Record<string, any>, method: string, id: string) {
  return new Promise(() => {
    const withID = JSON.stringify({ ...message, id, jsonrpc: '2.0' });
    logger.trace(`send Response: ${id}`, method, withID);

    // 发送消息或放入队列
    if (initialized && workerSocket) {
      workerSocket.send(withID);
    } else {
      pendingMessages.push(withID);
    }
  });
}

async function sendInitializeRequest(params?: ls.InitializeParams) {
  if (initializeParams) {
    return sendRequest(initializeParams);
  }
  if (!params) {
    return;
  }

  const rootUri = params.workspaceFolders?.[0].uri;
  if (!rootUri) {
    return;
  }

  const initializeParamsRaw = {
    params: {
      ...params,
      rootUri,
      initializationOptions: params.initializationOptions,
    },
    method: 'initialize',
  };

  setInitializeParams(initializeParamsRaw);
  return sendRequest(initializeParamsRaw) as any;
}
