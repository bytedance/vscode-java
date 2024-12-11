// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { logger } from './logger';

export const fetchFileContent = async (url: string): Promise<string | undefined> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.error(`Could not fetch file ${url}`);
    }
    return await response.text();
  } catch (error) {
    logger.error(`Could not fetch file ${url}`);
    return undefined;
  }
};
