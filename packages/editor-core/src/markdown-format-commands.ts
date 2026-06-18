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
      context.commands.register({
        id: "format.bold",
        title: "Bold",
        async run(ctx) {
          // 实际实现需要调用 Milkdown 的 toggleStrong 命令
          console.log("format.bold command triggered");
        }
      });

      context.commands.register({
        id: "format.italic",
        title: "Italic",
        async run(ctx) {
          console.log("format.italic command triggered");
        }
      });

      context.commands.register({
        id: "format.code",
        title: "Inline Code",
        async run(ctx) {
          console.log("format.code command triggered");
        }
      });

      context.commands.register({
        id: "format.strikethrough",
        title: "Strikethrough",
        async run(ctx) {
          console.log("format.strikethrough command triggered");
        }
      });

      context.commands.register({
        id: "format.link",
        title: "Insert Link",
        async run(ctx) {
          console.log("format.link command triggered");
        }
      });

      context.commands.register({
        id: "format.codeBlock",
        title: "Insert Code Block",
        async run(ctx) {
          console.log("format.codeBlock command triggered");
        }
      });

      context.commands.register({
        id: "format.blockquote",
        title: "Insert Blockquote",
        async run(ctx) {
          console.log("format.blockquote command triggered");
        }
      });

      context.commands.register({
        id: "format.bulletList",
        title: "Insert Bullet List",
        async run(ctx) {
          console.log("format.bulletList command triggered");
        }
      });

      context.commands.register({
        id: "format.orderedList",
        title: "Insert Ordered List",
        async run(ctx) {
          console.log("format.orderedList command triggered");
        }
      });

      context.commands.register({
        id: "format.heading1",
        title: "Heading 1",
        async run(ctx) {
          console.log("format.heading1 command triggered");
        }
      });

      context.commands.register({
        id: "format.heading2",
        title: "Heading 2",
        async run(ctx) {
          console.log("format.heading2 command triggered");
        }
      });

      context.commands.register({
        id: "format.heading3",
        title: "Heading 3",
        async run(ctx) {
          console.log("format.heading3 command triggered");
        }
      });

      // 快捷键绑定
      context.keymaps.register({
        id: "format.bold",
        key: "Mod-B",
        commandId: "format.bold"
      });

      context.keymaps.register({
        id: "format.italic",
        key: "Mod-I",
        commandId: "format.italic"
      });

      context.keymaps.register({
        id: "format.code",
        key: "Mod-E",
        commandId: "format.code"
      });

      context.keymaps.register({
        id: "format.strikethrough",
        key: "Mod-Shift-X",
        commandId: "format.strikethrough"
      });

      context.keymaps.register({
        id: "format.link",
        key: "Mod-K",
        commandId: "format.link"
      });

      context.keymaps.register({
        id: "format.codeBlock",
        key: "Mod-Shift-C",
        commandId: "format.codeBlock"
      });

      context.keymaps.register({
        id: "format.blockquote",
        key: "Mod-Shift-.",
        commandId: "format.blockquote"
      });

      context.keymaps.register({
        id: "format.bulletList",
        key: "Mod-Shift-8",
        commandId: "format.bulletList"
      });

      context.keymaps.register({
        id: "format.orderedList",
        key: "Mod-Shift-7",
        commandId: "format.orderedList"
      });

      context.keymaps.register({
        id: "format.heading1",
        key: "Mod-Alt-1",
        commandId: "format.heading1"
      });

      context.keymaps.register({
        id: "format.heading2",
        key: "Mod-Alt-2",
        commandId: "format.heading2"
      });

      context.keymaps.register({
        id: "format.heading3",
        key: "Mod-Alt-3",
        commandId: "format.heading3"
      });
    }
  };
}
