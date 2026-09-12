// apps/utools/src/utools/fonts.ts
// 正文与代码字体族栈预设与解析器（与桌面端规范 100% 对齐）

export interface FontOption {
  readonly id: string;
  readonly label: string;
  readonly stack: string;
}

/**
 * 预设正文字体选项清单
 */
export const PROSE_FONT_OPTIONS: readonly FontOption[] = [
  { id: "", label: "跟随主题默认", stack: "" },
  {
    id: "system-sans",
    label: "系统无衬线 (苹方 / San Francisco)",
    stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif`,
  },
  {
    id: "lxgw-wenkai",
    label: "霞鹜文楷 (LXGW WenKai)",
    stack: `"LXGW WenKai", "LXGW WenKai Screen", "LXGW WenKai GB", "LXGWWenKai-Regular", "LXGWWenKai", "霞鹜文楷", "霞鹜文楷 屏幕阅读版", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif`,
  },
  {
    id: "songti",
    label: "经典宋体 (Songti SC / SimSun)",
    stack: `"Songti SC", "STSong", "SimSun", "宋体", "Source Han Serif SC", "Noto Serif CJK SC", serif`,
  },
  {
    id: "kaiti",
    label: "传统楷体 (Kaiti SC / KaiTi)",
    stack: `"Kaiti SC", "STKaiti", "KaiTi", "楷体", "Source Han Serif SC", serif`,
  },
];

/**
 * 预设等宽代码字体选项清单
 */
export const CODE_FONT_OPTIONS: readonly FontOption[] = [
  { id: "", label: "跟随主题默认", stack: "" },
  {
    id: "system-mono",
    label: "系统等宽 (SF Mono / Menlo / Consolas)",
    stack: `ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace`,
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    stack: `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
  {
    id: "fira-code",
    label: "Fira Code",
    stack: `"Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
  {
    id: "cascadia-code",
    label: "Cascadia Code",
    stack: `"Cascadia Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    stack: `"Source Code Pro", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
];

/**
 * 解析正文字体实际 CSS font-family 字符串
 */
export function resolveProseFontStack(fontKey: string): string {
  if (!fontKey) return "";
  const matched = PROSE_FONT_OPTIONS.find((opt) => opt.id === fontKey);
  if (matched) return matched.stack;
  return `${fontKey}, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
}

/**
 * 解析等宽代码字体实际 CSS font-family 字符串
 */
export function resolveCodeFontStack(fontKey: string): string {
  if (!fontKey) return "";
  const matched = CODE_FONT_OPTIONS.find((opt) => opt.id === fontKey);
  if (matched) return matched.stack;
  return `${fontKey}, ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
}
