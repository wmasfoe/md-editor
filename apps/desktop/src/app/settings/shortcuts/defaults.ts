/**
 * @fileoverview 默认快捷键清单与初始化列表
 */

import type { ShortcutSetting } from "./types.ts";

/**
 * 内置快捷键配置模版列表
 */
export const DEFAULT_SHORTCUT_TEMPLATES: readonly Omit<ShortcutSetting, "key">[] = [
  {
    id: "editor.find",
    commandId: "editor.find",
    label: "文档内查找",
    defaultKey: "Mod-F",
  },
  {
    id: "editor.replace",
    commandId: "editor.replace",
    label: "文档内替换",
    defaultKey: "Mod-H",
  },
  {
    id: "format.bold",
    commandId: "format.bold",
    label: "加粗 (Bold)",
    defaultKey: "Mod-B",
  },
  {
    id: "format.italic",
    commandId: "format.italic",
    label: "斜体 (Italic)",
    defaultKey: "Mod-I",
  },
  {
    id: "format.strikethrough",
    commandId: "format.strikethrough",
    label: "删除线 (Strikethrough)",
    defaultKey: "Mod-Shift-S",
  },
  {
    id: "format.inlineCode",
    commandId: "format.inlineCode",
    label: "行内代码 (Inline Code)",
    defaultKey: "Mod-E",
  },
  {
    id: "format.highlight",
    commandId: "format.highlight",
    label: "文本高亮 (Highlight)",
    defaultKey: "Mod-Shift-H",
  },
  {
    id: "format.link",
    commandId: "format.link",
    label: "插入 / 包裹链接",
    defaultKey: "Mod-K",
  },
  {
    id: "format.codeBlock",
    commandId: "format.codeBlock",
    label: "插入代码块",
    defaultKey: "Mod-Shift-C",
  },
  {
    id: "format.blockquote",
    commandId: "format.blockquote",
    label: "切换引用块",
    defaultKey: "Mod-Shift-Q",
  },
  {
    id: "format.bulletList",
    commandId: "format.bulletList",
    label: "无序列表",
    defaultKey: "Mod-Shift-U",
  },
  {
    id: "format.orderedList",
    commandId: "format.orderedList",
    label: "有序列表",
    defaultKey: "Mod-Shift-O",
  },
  {
    id: "format.taskList",
    commandId: "format.taskList",
    label: "待办任务列表",
    defaultKey: "Mod-Shift-T",
  },
  {
    id: "format.heading1",
    commandId: "format.heading1",
    label: "一级标题 (H1)",
    defaultKey: "Mod-Alt-1",
  },
  {
    id: "format.heading2",
    commandId: "format.heading2",
    label: "二级标题 (H2)",
    defaultKey: "Mod-Alt-2",
  },
  {
    id: "format.heading3",
    commandId: "format.heading3",
    label: "三级标题 (H3)",
    defaultKey: "Mod-Alt-3",
  },
  {
    id: "format.heading4",
    commandId: "format.heading4",
    label: "四级标题 (H4)",
    defaultKey: "Mod-Alt-4",
  },
  {
    id: "format.heading5",
    commandId: "format.heading5",
    label: "五级标题 (H5)",
    defaultKey: "Mod-Alt-5",
  },
  {
    id: "format.heading6",
    commandId: "format.heading6",
    label: "六级标题 (H6)",
    defaultKey: "Mod-Alt-6",
  },
  {
    id: "format.paragraph",
    commandId: "format.paragraph",
    label: "正文段落",
    defaultKey: "Mod-Alt-0",
  },
  {
    id: "view.toggleSource",
    commandId: "view.toggleSource",
    label: "切换源码模式",
    defaultKey: "Mod-/",
  },
  {
    id: "view.toggleSidebarPrimary",
    commandId: "view.toggleSidebarPrimary",
    label: "切换文件树 / 大纲",
    defaultKey: "Mod-Shift-B",
  },
  {
    id: "settings.open",
    commandId: "settings.open",
    label: "打开设置",
    defaultKey: "Mod-,",
  },
  {
    id: "mdx.openComponentMenu",
    commandId: "mdx.openComponentMenu",
    label: "插入 MDX 组件",
    defaultKey: "Mod-Shift-M",
  },
  {
    id: "table.insert",
    commandId: "table.insert",
    label: "插入表格",
    defaultKey: "Mod-Alt-T",
  },
  {
    id: "ai.continueWriting",
    commandId: "ai.continueWriting",
    label: "AI 续写",
    defaultKey: "Mod-Shift-A",
  },
  {
    id: "ai.fixGrammar",
    commandId: "ai.fixGrammar",
    label: "AI 语法与润色修复",
    defaultKey: "Mod-Shift-G",
  },
];
