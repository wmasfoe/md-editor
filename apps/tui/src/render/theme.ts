/**
 * 终端风格主题
 *
 * 每个样式函数包住一段文本并返回带 ANSI 的字符串。使用「具体关闭码」而不是整体 reset，
 * 这样嵌套样式（例如链接里的加粗）不会互相破坏。
 * plainTheme 是恒等实现：无颜色环境（哑终端、测试断言结构）用。
 */
export interface TerminalTheme {
  strong: (text: string) => string;
  emphasis: (text: string) => string;
  code: (text: string) => string;
  link: (text: string) => string;
  heading: (level: number, text: string) => string;
  /** markdown 语法标记（#、**、` 等），光标不在该行时会被隐藏 */
  marker: (text: string) => string;
  quote: (text: string) => string;
  bullet: (text: string) => string;
  fence: (text: string) => string;
  dim: (text: string) => string;
}

export const defaultTheme: TerminalTheme = {
  strong: (text) => `\x1b[1m${text}\x1b[22m`,
  emphasis: (text) => `\x1b[3m${text}\x1b[23m`,
  code: (text) => `\x1b[36m${text}\x1b[39m`,
  link: (text) => `\x1b[4;34m${text}\x1b[24;39m`,
  heading: (level, text) => {
    switch (level) {
      case 1:
        return `\x1b[1;38;5;214m${text}\x1b[22;39m`;
      case 2:
        return `\x1b[1;38;5;220m${text}\x1b[22;39m`;
      case 3:
        return `\x1b[1;38;5;228m${text}\x1b[22;39m`;
      default:
        return `\x1b[1m${text}\x1b[22m`;
    }
  },
  marker: (text) => `\x1b[2m${text}\x1b[22m`,
  quote: (text) => `\x1b[2;3m${text}\x1b[22;23m`,
  bullet: (text) => `\x1b[33m${text}\x1b[39m`,
  fence: (text) => `\x1b[38;5;245m${text}\x1b[39m`,
  dim: (text) => `\x1b[2m${text}\x1b[22m`,
};

const identity = (text: string): string => text;

export const plainTheme: TerminalTheme = {
  strong: identity,
  emphasis: identity,
  code: identity,
  link: identity,
  heading: (_level, text) => text,
  marker: identity,
  quote: identity,
  bullet: identity,
  fence: identity,
  dim: identity,
};
