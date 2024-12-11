// *****************************************************************************
// Copyright (C) 2024 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

const defaultStyles = {
  trace: 'color: gray;',
  info: 'color: blue;',
  warn: 'color: orange;',
  error: 'color: red;',
};

type LogType = 'trace' | 'info' | 'warn' | 'error';
type CSSColorToken =
  | 'aliceblue'
  | 'antiquewhite'
  | 'aqua'
  | 'aquamarine'
  | 'azure'
  | 'beige'
  | 'bisque'
  | 'black'
  | 'blanchedalmond'
  | 'blue'
  | 'blueviolet'
  | 'brown'
  | 'burlywood'
  | 'cadetblue'
  | 'chartreuse'
  | 'chocolate'
  | 'coral'
  | 'cornflowerblue'
  | 'cornsilk'
  | 'crimson'
  | 'cyan'
  | 'darkblue'
  | 'darkcyan'
  | 'darkgoldenrod'
  | 'darkgray'
  | 'darkgreen'
  | 'darkgrey'
  | 'darkkhaki'
  | 'darkmagenta'
  | 'darkolivegreen'
  | 'darkorange'
  | 'darkorchid'
  | 'darkred'
  | 'darksalmon'
  | 'darkseagreen'
  | 'darkslateblue'
  | 'darkslategray'
  | 'darkslategrey'
  | 'darkturquoise'
  | 'darkviolet'
  | 'deeppink'
  | 'deepskyblue'
  | 'dimgray'
  | 'dimgrey'
  | 'dodgerblue'
  | 'firebrick'
  | 'floralwhite'
  | 'forestgreen'
  | 'fuchsia'
  | 'gainsboro'
  | 'ghostwhite'
  | 'gold'
  | 'goldenrod'
  | 'gray'
  | 'green'
  | 'greenyellow'
  | 'grey'
  | 'honeydew'
  | 'hotpink'
  | 'indianred'
  | 'indigo'
  | 'ivory'
  | 'khaki'
  | 'lavender'
  | 'lavenderblush'
  | 'lawngreen'
  | 'lemonchiffon'
  | 'lightblue'
  | 'lightcoral'
  | 'lightcyan'
  | 'lightgoldenrodyellow'
  | 'lightgray'
  | 'lightgreen'
  | 'lightgrey'
  | 'lightpink'
  | 'lightsalmon'
  | 'lightseagreen'
  | 'lightskyblue'
  | 'lightslategray'
  | 'lightslategrey'
  | 'lightsteelblue'
  | 'lightyellow'
  | 'lime'
  | 'limegreen'
  | 'linen'
  | 'magenta'
  | 'maroon'
  | 'mediumaquamarine'
  | 'mediumblue'
  | 'mediumorchid'
  | 'mediumpurple'
  | 'mediumseagreen'
  | 'mediumslateblue'
  | 'mediumspringgreen'
  | 'mediumturquoise'
  | 'mediumvioletred'
  | 'midnightblue'
  | 'mintcream'
  | 'mistyrose'
  | 'moccasin'
  | 'navajowhite'
  | 'navy'
  | 'oldlace'
  | 'olive'
  | 'olivedrab'
  | 'orange'
  | 'orangered'
  | 'orchid'
  | 'palegoldenrod'
  | 'palegreen'
  | 'paleturquoise'
  | 'palevioletred'
  | 'papayawhip'
  | 'peachpuff'
  | 'peru'
  | 'pink'
  | 'plum'
  | 'powderblue'
  | 'purple'
  | 'red'
  | 'rosybrown'
  | 'royalblue'
  | 'saddlebrown'
  | 'salmon'
  | 'sandybrown'
  | 'seagreen'
  | 'seashell'
  | 'sienna'
  | 'silver'
  | 'skyblue'
  | 'slateblue'
  | 'slategray'
  | 'slategrey'
  | 'snow'
  | 'springgreen'
  | 'steelblue'
  | 'tan'
  | 'teal'
  | 'thistle'
  | 'tomato'
  | 'turquoise'
  | 'violet'
  | 'wheat'
  | 'white'
  | 'whitesmoke'
  | 'yellow'
  | 'yellowgreen';

interface LoggerOptions {
  enabled?: boolean;
  level?: LogType;
  styles?: { [key in LogType]?: CSSColorToken };
}

export class LSPLogger {
  private enabled: boolean;
  private level: LogType;
  private readonly styles: { [key in LogType]: string };

  constructor(private name: string, options?: LoggerOptions) {
    this.enabled = options?.enabled ?? true;
    this.level = options?.level ?? 'info';
    this.styles = options?.styles
      ? Object.assign(
          defaultStyles,
          ...Object.entries(options.styles).map(([key, value]) => ({
            [key]: `color: ${value}`,
          }))
        )
      : defaultStyles;
  }

  setLoggerLevel(level: LogType) {
    this.level = level;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  private shouldLog(logType: LogType): boolean {
    const levels: LogType[] = ['trace', 'info', 'warn', 'error'];
    return levels.indexOf(logType) >= levels.indexOf(this.level);
  }

  private formatMessage(data: object | string): string {
    return typeof data === 'object' ? JSON.stringify(data, null, 2) : JSON.stringify(JSON.parse(data), null, 2);
  }

  private log(event: string, method: string, data: object | string, logType: LogType = 'info') {
    if (!this.enabled || !this.shouldLog(logType)) {
      return;
    }

    const date = new Date().toLocaleString();
    const header = `%c[${this.name}][${date}][${event}][${method}]`;
    const message = this.formatMessage(data);
    console.groupCollapsed(header, this.styles[logType]);
    console.info(message);
    console.groupEnd();
  }

  error(event: string, method: string, data: object) {
    this.log(event, method, data, 'error');
  }

  info(event: string, method: string, data: object | string) {
    this.log(event, method, data, 'info');
  }

  trace(event: string, method: string, data: object | string) {
    this.log(event, method, data, 'trace');
  }

  warn(event: string, method: string, data: object | string) {
    this.log(event, method, data, 'warn');
  }
}
