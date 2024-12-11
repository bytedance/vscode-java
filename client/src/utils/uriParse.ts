// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { Uri } from 'vscode';

export class UriParse {
  private static endpoint = '';
  private static clientId: string | undefined;

  public static init(endpoint: string, clientId: string | undefined) {
    UriParse.endpoint = endpoint;
    UriParse.clientId = clientId;
  }

  public static getEndpoint() {
    return UriParse.endpoint;
  }

  public static getClientId() {
    return UriParse.clientId;
  }

  // custom authority
  public static parseUri(rawUrl: string, scheme = 'vscode-remote', authority = ''): Uri {
    if (!UriParse.endpoint) {
      return Uri.parse(rawUrl).with({
        scheme,
        authority,
      });
    }
    const regex = new RegExp(`.*${UriParse.clientId}\\/file`);
    const path = rawUrl.replace(regex, 'file:');
    return Uri.parse(path).with({
      scheme,
      authority,
    });
  }
}
