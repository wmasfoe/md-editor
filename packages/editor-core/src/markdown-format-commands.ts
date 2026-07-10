import type { FeatureContext, FeatureDescriptor } from "./index.ts";

export type MarkdownFormatCommandId =
  | "format.bold"
  | "format.italic"
  | "format.code"
  | "format.strikethrough"
  | "format.link"
  | "format.codeBlock"
  | "format.blockquote"
  | "format.bulletList"
  | "format.orderedList"
  | "format.heading1"
  | "format.heading2"
  | "format.heading3";

export function createMarkdownFormatFeature(): FeatureDescriptor {
  return {
    id: "editor.markdown-format",
    title: "Markdown Formatting Commands",
    setup(context: FeatureContext) {
      // 格式化命令 - 这些命令需要由 Milkdown/ProseMirror 层实现具体逻辑
      // 注意：大部分快捷键已由 Milkdown 的 commonmark 和 gfm presets 内置
      // 我们只注册命令，不注册快捷键，避免与 Milkdown 冲突

      context.commands.register({
        id: "format.bold",
        title: "Bold",
        async run() {
          // 实际实现需要调用 Milkdown 的 toggleStrong 命令
          console.log("format.bold command triggered");
        },
      });

      context.commands.register({
        id: "format.italic",
        title: "Italic",
        async run() {
          console.log("format.italic command triggered");
        },
      });

      context.commands.register({
        id: "format.code",
        title: "Inline Code",
        async run() {
          console.log("format.code command triggered");
        },
      });

      context.commands.register({
        id: "format.strikethrough",
        title: "Strikethrough",
        async run() {
          console.log("format.strikethrough command triggered");
        },
      });

      context.commands.register({
        id: "format.link",
        title: "Insert Link",
        async run() {
          console.log("format.link command triggered");
        },
      });

      context.commands.register({
        id: "format.codeBlock",
        title: "Insert Code Block",
        async run() {
          console.log("format.codeBlock command triggered");
        },
      });

      context.commands.register({
        id: "format.blockquote",
        title: "Insert Blockquote",
        async run() {
          console.log("format.blockquote command triggered");
        },
      });

      context.commands.register({
        id: "format.bulletList",
        title: "Insert Bullet List",
        async run() {
          console.log("format.bulletList command triggered");
        },
      });

      context.commands.register({
        id: "format.orderedList",
        title: "Insert Ordered List",
        async run() {
          console.log("format.orderedList command triggered");
        },
      });

      context.commands.register({
        id: "format.heading1",
        title: "Heading 1",
        async run() {
          console.log("format.heading1 command triggered");
        },
      });

      context.commands.register({
        id: "format.heading2",
        title: "Heading 2",
        async run() {
          console.log("format.heading2 command triggered");
        },
      });

      context.commands.register({
        id: "format.heading3",
        title: "Heading 3",
        async run() {
          console.log("format.heading3 command triggered");
        },
      });

      // 注意：快捷键已由 Milkdown 内置处理，无需重复注册
      // Milkdown 内置快捷键：
      // - Cmd+B: 加粗
      // - Cmd+I: 斜体
      // - Cmd+`: 行内代码
      // - Cmd+K: 插入链接
      // - Cmd+Shift+X: 删除线
      // - Cmd+Shift+8: 无序列表
      // - Cmd+Shift+7: 有序列表
      // - Cmd+Shift+.: 引用块
      // - Cmd+Alt+1/2/3/4/5/6: 标题
    },
  };
}
