// *****************************************************************************
// Copyright (C) 2016 Red Hat, Inc.
// This file may have been modified by Bytedance Ltd. and/or its affiliates (“Bytedance's Modifications”). All Bytedance's Modifications are Copyright (2024) Bytedance Ltd. and/or its affiliates. 
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { window, commands, ExtensionContext, Uri, ConfigurationTarget } from 'vscode';
import * as Commands from './command';
import { getJavaConfiguration } from './utils';

interface Result {
  status: boolean;
  message: string;
}

interface SourcePath {
  path: string;
  displayPath: string;
  projectName: string;
  projectType: string;
}

export interface ListCommandResult extends Result {
  data?: SourcePath[];
}

export function registerCommands(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(Commands.ADD_TO_SOURCEPATH_CMD, async (uri: Uri) => {
      const result = await (commands.executeCommand(
        Commands.EXECUTE_WORKSPACE_COMMAND,
        Commands.ADD_TO_SOURCEPATH,
        uri.toString()
      ) as any);
      if (result.status) {
        if (result.sourcePaths) {
          getJavaConfiguration().update('project.sourcePaths', result.sourcePaths, ConfigurationTarget.Workspace);
        }
        window.showInformationMessage(
          result.message ? result.message : 'Successfully added the folder to the source path.'
        );
      } else {
        window.showErrorMessage(result.message);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand(Commands.REMOVE_FROM_SOURCEPATH_CMD, async (uri: Uri) => {
      const result = await (commands.executeCommand(
        Commands.EXECUTE_WORKSPACE_COMMAND,
        Commands.REMOVE_FROM_SOURCEPATH,
        uri.toString()
      ) as any);
      if (result.status) {
        if (result.sourcePaths) {
          getJavaConfiguration().update('project.sourcePaths', result.sourcePaths, ConfigurationTarget.Workspace);
        }
        window.showInformationMessage(
          result.message ? result.message : 'Successfully removed the folder from the source path.'
        );
      } else {
        window.showErrorMessage(result.message);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand(Commands.LIST_SOURCEPATHS_CMD, async () => {
      const result: ListCommandResult = await commands.executeCommand<ListCommandResult>(
        Commands.EXECUTE_WORKSPACE_COMMAND,
        Commands.LIST_SOURCEPATHS
      );
      if (result.status) {
        if (!result.data?.length) {
          window.showInformationMessage(
            "No Java source directories found in the workspace, please use the command 'Add Folder to Java Source Path' first."
          );
        } else {
          window.showQuickPick(
            result.data.map(sourcePath => ({
              label: sourcePath.displayPath,
              detail: `$(file-directory) ${sourcePath.projectType} Project: ${sourcePath.projectName}`,
            })),
            { placeHolder: 'All Java source directories recognized by the workspace.' }
          );
        }
      } else {
        window.showErrorMessage(result.message);
      }
    })
  );
}
