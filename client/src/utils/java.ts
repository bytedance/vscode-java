// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { workspace, WorkspaceConfiguration, commands, Uri, version } from 'vscode';
import * as path from 'path-browserify';

import * as Commands from '../command';

export function getJavaConfiguration(): WorkspaceConfiguration {
  return workspace.getConfiguration('java');
}

/**
 * Get all Java projects from Java Language Server.
 * @param excludeDefaultProject whether the default project should be excluded from the list, defaults to true.
 * @returns string array for the project uris.
 */
export async function getAllJavaProjects(excludeDefaultProject = true): Promise<string[]> {
  const projectUris: string[] = await commands.executeCommand<string[]>(
    Commands.EXECUTE_WORKSPACE_COMMAND,
    Commands.GET_ALL_JAVA_PROJECTS
  );
  return filterDefaultProject(projectUris, excludeDefaultProject);
}

function filterDefaultProject(projectUris: string[], excludeDefaultProject: boolean): string[] {
  if (excludeDefaultProject) {
    return projectUris.filter(uriString => {
      const projectPath = Uri.parse(uriString).fsPath;
      return path.basename(projectPath) !== 'jdt.ls-java-project';
    });
  }
  return projectUris;
}

export function getJavaConfig() {
  const origConfig = getJavaConfiguration();
  const javaConfig = JSON.parse(JSON.stringify(origConfig));
  // javaConfig.home = javaHome;
  // Since source & output path are project specific settings. To avoid pollute other project,
  // we avoid reading the value from the global scope.
  javaConfig.project.outputPath = origConfig.inspect<string>('project.outputPath').workspaceValue;
  javaConfig.project.sourcePaths = origConfig.inspect<string[]>('project.sourcePaths').workspaceValue;

  const editorConfig = workspace.getConfiguration('editor');
  javaConfig.format.insertSpaces = editorConfig.get('insertSpaces');
  javaConfig.format.tabSize = editorConfig.get('tabSize');
  const isInsider: boolean = version.includes('insider');
  const androidSupport = javaConfig.jdt.ls.androidSupport.enabled;
  switch (androidSupport) {
    case 'auto':
      javaConfig.jdt.ls.androidSupport.enabled = isInsider;
      break;
    case 'on':
      javaConfig.jdt.ls.androidSupport.enabled = true;
      break;
    case 'off':
      javaConfig.jdt.ls.androidSupport.enabled = false;
      break;
    default:
      javaConfig.jdt.ls.androidSupport.enabled = false;
      break;
  }

  if (javaConfig.completion.matchCase === 'auto') {
    javaConfig.completion.matchCase = 'firstLetter';
  }

  const guessMethodArguments = javaConfig.completion.guessMethodArguments;
  if (guessMethodArguments === 'auto') {
    javaConfig.completion.guessMethodArguments = isInsider ? 'off' : 'insertBestGuessedArguments';
  }

  // javaConfig.telemetry = { enabled: vscode.workspace.getConfiguration('redhat.telemetry').get('enabled', false) };
  // if (detectJdksAtStart) {
  //   const userConfiguredJREs: any[] = javaConfig.configuration.runtimes;
  //   javaConfig.configuration.runtimes = await addAutoDetectedJdks(userConfiguredJREs);
  // }
  return javaConfig;
}
