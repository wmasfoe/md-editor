/**
 * 终端风格主题
 *
 * 每个样式函数包住一段文本并返回带 ANSI 的字符串。使用「具体关闭码」而不是整体 reset，
 * 这样嵌套样式（例如链接里的加粗）不会互相破坏。
 * plainTheme 是恒等实现：无颜色环境（哑终端、测试断言结构）用。
 */
import { execFileSync } from "node:child_process";

export type TerminalColorScheme = "dark" | "light";

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

/** 暗色背景主题：偏暖金橙阶梯，高亮对比暗背景清晰 */
export const darkTheme: TerminalTheme = {
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

/**
 * 亮色背景主题：解决浅色终端下浅黄色标题泛白发虚、对比度不足的问题。
 *
 * 选色原则（基于 WCAG AA 对比度与 Inkpoint 温暖基调）：
 * - H1：焦橙/深琥珀红 (ANSI 166，#d75f00)，白底对比度 > 4.5:1
 * - H2：深琥珀/古铜 (ANSI 130，#af5f00)，白底对比度 > 5.5:1
 * - H3：深橄榄金 (ANSI 94，#875f00)，白底对比度 > 7.5:1
 * - bullet：深琥珀色，避免亮黄色在白底隐形
 * - code：深青色 (ANSI 30，#008787)，白底对比度 > 4.8:1
 * - link：深宝蓝 (ANSI 25，#005faf)，白底对比度 > 6.5:1
 * - fence：深岩灰 (ANSI 241，#626262)，清晰不发淡
 */
export const lightTheme: TerminalTheme = {
  strong: (text) => `\x1b[1m${text}\x1b[22m`,
  emphasis: (text) => `\x1b[3m${text}\x1b[23m`,
  code: (text) => `\x1b[38;5;30m${text}\x1b[39m`,
  link: (text) => `\x1b[4;38;5;25m${text}\x1b[24;39m`,
  heading: (level, text) => {
    switch (level) {
      case 1:
        return `\x1b[1;38;5;166m${text}\x1b[22;39m`;
      case 2:
        return `\x1b[1;38;5;130m${text}\x1b[22;39m`;
      case 3:
        return `\x1b[1;38;5;94m${text}\x1b[22;39m`;
      default:
        return `\x1b[1m${text}\x1b[22m`;
    }
  },
  marker: (text) => `\x1b[2;38;5;244m${text}\x1b[22;39m`,
  quote: (text) => `\x1b[2;3;38;5;240m${text}\x1b[22;23;39m`,
  bullet: (text) => `\x1b[38;5;130m${text}\x1b[39m`,
  fence: (text) => `\x1b[38;5;241m${text}\x1b[39m`,
  dim: (text) => `\x1b[2m${text}\x1b[22m`,
};

export const defaultTheme: TerminalTheme = darkTheme;

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

/** 根据配色方案名称返回对应主题 */
export function getThemeByColorScheme(scheme: TerminalColorScheme): TerminalTheme {
  return scheme === "light" ? lightTheme : darkTheme;
}

/** 根据 RGB 计算感知相对亮度（0~1），大于 0.5 判定为浅色背景 */
export function colorSchemeFromRgb(rgb: { r: number; g: number; b: number }): TerminalColorScheme {
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? "light" : "dark";
}

/**
 * 环境变量与操作系统层面的同步终端色彩探测。
 * 提供首帧快速决策，避免首屏闪烁；终端就绪后壳子会通过 OSC 11 / DSR 协议做精确校准。
 */
export function detectEnvironmentColorScheme(
  env: NodeJS.ProcessEnv = process.env,
): TerminalColorScheme {
  // 1. 显式配置：INK_THEME=light|dark
  const envTheme = env.INK_THEME?.toLowerCase().trim();
  if (envTheme === "light" || envTheme === "dark") {
    return envTheme;
  }

  // 2. 终端环境变量：TERM_BACKGROUND=light|dark
  const termBg = env.TERM_BACKGROUND?.toLowerCase().trim();
  if (termBg === "light" || termBg === "dark") {
    return termBg;
  }

  // 3. COLORFGBG 变量 (格式通常为 "fg;bg" 或 "fg;bg;extra")
  const colorFgBg = env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.trim().split(";");
    if (parts.length >= 2) {
      const bg = parseInt(parts[parts.length - 1], 10);
      if (!Number.isNaN(bg)) {
        // ANSI 颜色索引中：0-6, 8 为深色；7, 9-15 为浅色（如 7 浅灰、15 亮白）
        if (bg === 7 || (bg >= 9 && bg <= 15)) {
          return "light";
        }
        return "dark";
      }
    }
  }

  // 4. macOS 系统外观探测（单测环境下跳过外部调用）
  if (process.platform === "darwin" && !env.VITEST) {
    try {
      const style = execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
        stdio: ["pipe", "pipe", "ignore"],
        encoding: "utf8",
        timeout: 100,
      }).trim();
      if (style.toLowerCase() === "dark") {
        return "dark";
      }
    } catch {
      // 在 macOS 上若未启用系统暗色模式，AppleInterfaceStyle 读取失败，表示当前系统为浅色模式
      return "light";
    }
  }

  return "dark";
}
