/**
 * @fileoverview 默认快捷键清单与初始化列表
 */

import { createBuiltInKeymaps } from "@md-editor/core";
import { normalizeShortcutKey } from "./keys.ts";
import type { ShortcutSetting } from "./types.ts";

/**
 * 内建键位的默认 chord，唯一事实来源是 `@md-editor/core`。
 *
 * 此前本文件把 30 多条 chord 逐条抄了一遍（且大小写与 core 不一致：core 写 `Mod-f`，
 * 这里写 `Mod-F`），任何一侧改动都会静默漂移。现在默认值一律从这里取，
 * 缺失即抛错 —— 宁可在启动期炸掉，也不要设置面板显示一个并不生效的键位。
 */
const BUILT_IN_KEYMAP_DEFAULTS = new Map(
  createBuiltInKeymaps().map((keymap) => [keymap.id, keymap.key]),
);

/**
 * 取内建默认 chord，并规范成本应用的内部写法（主键大写，如 `Mod-f` → `Mod-F`）。
 *
 * id 不存在说明 core 的注册表与本表脱钩 —— 直接抛错比在设置面板里显示一个并不生效
 * 的键位要好。
 */
function defaultKeyOf(id: string): string {
  const key = BUILT_IN_KEYMAP_DEFAULTS.get(id);
  if (!key) {
    throw new Error(`[shortcuts] Missing built-in keymap default for "${id}"`);
  }
  return normalizeShortcutKey(key) ?? key;
}

/**
 * 内置快捷键配置模版列表
 */
export const DEFAULT_SHORTCUT_TEMPLATES: readonly Omit<ShortcutSetting, "key">[] = [
  {
    id: "editor.find",
    commandId: "editor.find",
    label: "文档内查找",
    defaultKey: defaultKeyOf("editor.find"),
  },
  {
    id: "editor.replace",
    commandId: "editor.replace",
    label: "文档内替换",
    defaultKey: defaultKeyOf("editor.replace"),
  },
  {
    id: "format.bold",
    commandId: "format.bold",
    label: "加粗 (Bold)",
    defaultKey: defaultKeyOf("format.bold"),
  },
  {
    id: "format.italic",
    commandId: "format.italic",
    label: "斜体 (Italic)",
    defaultKey: defaultKeyOf("format.italic"),
  },
  {
    id: "format.strikethrough",
    commandId: "format.strikethrough",
    label: "删除线 (Strikethrough)",
    defaultKey: defaultKeyOf("format.strikethrough"),
  },
  {
    id: "format.inlineCode",
    commandId: "format.inlineCode",
    label: "行内代码 (Inline Code)",
    defaultKey: defaultKeyOf("format.inlineCode"),
  },
  {
    id: "format.highlight",
    commandId: "format.highlight",
    label: "文本高亮 (Highlight)",
    defaultKey: defaultKeyOf("format.highlight"),
  },
  {
    id: "format.codeBlock",
    commandId: "format.codeBlock",
    label: "插入代码块",
    defaultKey: defaultKeyOf("format.codeBlock"),
  },
  {
    id: "format.blockquote",
    commandId: "format.blockquote",
    label: "切换引用块",
    defaultKey: defaultKeyOf("format.blockquote"),
  },
  {
    id: "format.bulletList",
    commandId: "format.bulletList",
    label: "无序列表",
    defaultKey: defaultKeyOf("format.bulletList"),
  },
  {
    id: "format.orderedList",
    commandId: "format.orderedList",
    label: "有序列表",
    defaultKey: defaultKeyOf("format.orderedList"),
  },
  {
    id: "format.taskList",
    commandId: "format.taskList",
    label: "待办任务列表",
    defaultKey: defaultKeyOf("format.taskList"),
  },
  {
    id: "format.heading1",
    commandId: "format.heading1",
    label: "一级标题 (H1)",
    defaultKey: defaultKeyOf("format.heading1"),
  },
  {
    id: "format.heading2",
    commandId: "format.heading2",
    label: "二级标题 (H2)",
    defaultKey: defaultKeyOf("format.heading2"),
  },
  {
    id: "format.heading3",
    commandId: "format.heading3",
    label: "三级标题 (H3)",
    defaultKey: defaultKeyOf("format.heading3"),
  },
  {
    id: "format.heading4",
    commandId: "format.heading4",
    label: "四级标题 (H4)",
    defaultKey: defaultKeyOf("format.heading4"),
  },
  {
    id: "format.heading5",
    commandId: "format.heading5",
    label: "五级标题 (H5)",
    defaultKey: defaultKeyOf("format.heading5"),
  },
  {
    id: "format.heading6",
    commandId: "format.heading6",
    label: "六级标题 (H6)",
    defaultKey: defaultKeyOf("format.heading6"),
  },
  {
    id: "format.paragraph",
    commandId: "format.paragraph",
    label: "正文段落",
    defaultKey: defaultKeyOf("format.paragraph"),
  },
  {
    id: "view.toggleSource",
    commandId: "view.toggleSource",
    label: "切换源码模式",
    defaultKey: defaultKeyOf("view.toggleSource"),
  },
  {
    id: "view.toggleSidebarPrimary",
    commandId: "view.toggleSidebarPrimary",
    label: "切换文件树 / 大纲",
    defaultKey: defaultKeyOf("view.toggleSidebarPrimary"),
  },
  {
    id: "settings.open",
    commandId: "settings.open",
    label: "打开设置",
    defaultKey: defaultKeyOf("settings.open"),
  },
  {
    // core 用 `Mod-Alt-O` 避开有序列表 `Mod-Shift-O`（原生菜单加速键会先于 webview 生效）。
    id: "file.openFolder",
    commandId: "file.openFolder",
    label: "打开文件夹",
    defaultKey: defaultKeyOf("file.openFolder"),
  },
  {
    id: "mdx.openComponentMenu",
    commandId: "mdx.openComponentMenu",
    label: "插入 MDX 组件",
    defaultKey: defaultKeyOf("mdx.openComponentMenu"),
  },
  {
    id: "table.insert",
    commandId: "table.insert",
    label: "插入表格",
    defaultKey: defaultKeyOf("table.insert"),
  },
  {
    id: "ai.continueWriting",
    commandId: "ai.continueWriting",
    label: "AI 续写",
    defaultKey: defaultKeyOf("ai.continueWriting"),
  },
  {
    id: "ai.fixGrammar",
    commandId: "ai.fixGrammar",
    label: "AI 语法与润色修复",
    defaultKey: defaultKeyOf("ai.fixGrammar"),
  },
  // S8（编辑器交互 bug 批，属主 #7）：块操作快捷键。
  // 占用盘点：与既有 Mod-Alt-T（插表格）/ Mod-Alt-f,y（视图模式）/ Mod-Alt-1..6 / Mod-Alt-0
  // 及全部 Mod-* 条目均无冲突（由 app-settings 的占用守卫测试锁定，含大小写不敏感归一）。
  {
    id: "block.moveUp",
    commandId: "block.moveUp",
    label: "上移块",
    defaultKey: defaultKeyOf("block.moveUp"),
  },
  {
    id: "block.moveDown",
    commandId: "block.moveDown",
    label: "下移块",
    defaultKey: defaultKeyOf("block.moveDown"),
  },
  {
    id: "block.duplicate",
    commandId: "block.duplicate",
    label: "复制块",
    defaultKey: defaultKeyOf("block.duplicate"),
  },
  {
    id: "block.delete",
    commandId: "block.delete",
    label: "删除块",
    defaultKey: defaultKeyOf("block.delete"),
  },
  {
    id: "lint.run",
    commandId: "lint.run",
    label: "运行 Markdown 规范检查",
    defaultKey: defaultKeyOf("lint.run"),
  },
  {
    id: "lint.fixAll",
    commandId: "lint.fixAll",
    label: "一键修复全部规范问题",
    defaultKey: defaultKeyOf("lint.fixAll"),
  },
];
