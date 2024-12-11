// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

export function string(value: any): value is string {
  return typeof value === 'string' || value instanceof String;
}

export function number(value: any): value is number {
  return typeof value === 'number' || value instanceof Number;
}
