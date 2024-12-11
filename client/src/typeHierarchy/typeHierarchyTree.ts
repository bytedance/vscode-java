// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import * as vscode from 'vscode';
import { Position, TextDocumentIdentifier, TextDocumentPositionParams } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/browser';
import * as Commands from '../command';
import { showNoLocationFound } from '../javaClient';
import { TypeHierarchyTreeInput } from './model';
import { LSPTypeHierarchyItem, TypeHierarchyDirection, TypeHierarchyItem } from './protocol';
import { SymbolTree } from './referencesView';
import { toTypeHierarchyItem } from './util';
import { logger } from '../utils';

export class TypeHierarchyTree {
  private api: SymbolTree;
  private direction: TypeHierarchyDirection;
  private client: LanguageClient;
  private cancelTokenSource: vscode.CancellationTokenSource;
  private location: vscode.Location;
  private baseItem: TypeHierarchyItem;
  public initialized: boolean;

  constructor() {
    this.initialized = false;
  }

  public async initialize(client: LanguageClient) {
    this.client = client;
    // It uses a new publisher id in June 2022 Update, check both old/new id for compatibility
    // See https://github.com/microsoft/vscode/pull/152213
    const referencesViewExt =
      vscode.extensions.getExtension<SymbolTree>('vscode.references-view') ??
      vscode.extensions.getExtension<SymbolTree>('ms-vscode.references-view');
    this.api = await referencesViewExt?.activate();
    this.initialized = true;
  }

  public async setTypeHierarchy(location: vscode.Location, direction: TypeHierarchyDirection): Promise<void> {
    if (!this.initialized) {
      await this.initialize(this.client);
    }
    if (!this.api) {
      return;
    }
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel();
    }
    this.cancelTokenSource = new vscode.CancellationTokenSource();
    const textDocument: TextDocumentIdentifier = TextDocumentIdentifier.create(location.uri.toString());
    const position: Position = Position.create(location.range.start.line, location.range.start.character);
    const params: TextDocumentPositionParams = {
      textDocument,
      position,
    };
    let lspItem: LSPTypeHierarchyItem;
    try {
      lspItem = await vscode.commands.executeCommand(
        Commands.EXECUTE_WORKSPACE_COMMAND,
        Commands.OPEN_TYPE_HIERARCHY,
        JSON.stringify(params),
        JSON.stringify(direction),
        JSON.stringify(0),
        this.cancelTokenSource.token
      );
      lspItem.uri = this.client.protocol2CodeConverter.asUri(lspItem.uri).toString();
    } catch (e) {
      // operation cancelled
      return;
    }
    if (!lspItem) {
      showNoLocationFound('No Type Hierarchy found');
      return;
    }
    const symbolKind = this.client.protocol2CodeConverter.asSymbolKind(lspItem.kind);
    if (direction === TypeHierarchyDirection.both && symbolKind === vscode.SymbolKind.Interface) {
      direction = TypeHierarchyDirection.children;
    }
    const item: TypeHierarchyItem = toTypeHierarchyItem(this.client, lspItem, direction);
    item.uri = this.client.protocol2CodeConverter.asUri(item.uri).toString();
    const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(
      location,
      direction,
      this.cancelTokenSource.token,
      item,
      this.client
    );
    this.location = location;
    this.direction = direction;
    this.baseItem = item;
    this.api.setInput(input);
    logger.debug('TypeHierarchyModel initialized', JSON.stringify(item));
  }

  public changeDirection(direction: TypeHierarchyDirection): void {
    if (!this.api) {
      return;
    }
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel();
    }
    this.cancelTokenSource = new vscode.CancellationTokenSource();
    this.baseItem.children = undefined;
    this.baseItem.parents = undefined;
    const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(
      this.location,
      direction,
      this.cancelTokenSource.token,
      this.baseItem,
      this.client
    );
    this.direction = direction;
    this.api.setInput(input);
  }

  public async changeBaseItem(item: TypeHierarchyItem): Promise<void> {
    if (!this.api) {
      return;
    }
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel();
    }
    this.cancelTokenSource = new vscode.CancellationTokenSource();
    item.parents = undefined;
    item.children = undefined;
    const location: vscode.Location = new vscode.Location(vscode.Uri.parse(item.uri), item.selectionRange);
    const newLocation: vscode.Location = (await this.isValidRequestPosition(location.uri, location.range.start))
      ? location
      : this.location;
    const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(
      newLocation,
      this.direction,
      this.cancelTokenSource.token,
      item,
      this.client
    );
    this.location = newLocation;
    this.baseItem = item;
    this.api.setInput(input);
  }

  private async isValidRequestPosition(uri: vscode.Uri, position: vscode.Position) {
    const doc = await vscode.workspace.openTextDocument(uri);
    let range = doc.getWordRangeAtPosition(position);
    if (!range) {
      range = doc.getWordRangeAtPosition(position, /[^\s]+/);
    }
    return Boolean(range);
  }
}

export const typeHierarchyTree: TypeHierarchyTree = new TypeHierarchyTree();
