import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  // Web 应用作为子路由挂载在官网的 /playground 路径下
  base: process.env.VITE_BASE_PATH || "/playground/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@md-editor/editor-ui/hooks",
        replacement: workspacePath("../../packages/editor-ui/src/hooks/index.ts"),
      },
      {
        find: /^@md-editor\/editor-ui$/,
        replacement: workspacePath("../../packages/editor-ui/src/index.ts"),
      },
      {
        find: /^@md-editor\/ai$/,
        replacement: workspacePath("../../packages/ai/src/index.ts"),
      },
      {
        find: /^@md-editor\/editor-core$/,
        replacement: workspacePath("../../packages/editor-core/src/index.ts"),
      },
      {
        find: /^@md-editor\/renderer-codemirror$/,
        replacement: workspacePath("../../packages/renderer-codemirror/src/index.ts"),
      },
      {
        find: /^@md-editor\/syntax-plugins$/,
        replacement: workspacePath("../../packages/syntax-plugins/src/index.ts"),
      },
      {
        find: /^@md-editor\/markdown-fidelity$/,
        replacement: workspacePath("../../packages/markdown-fidelity/src/index.ts"),
      },
      {
        find: /^@md-editor\/mdx-component-registry$/,
        replacement: workspacePath("../../packages/mdx-component-registry/src/index.ts"),
      },
      {
        find: "@md-editor/mdx-plugins/metadata",
        replacement: workspacePath("../../packages/mdx-plugins/src/metadata.ts"),
      },
      {
        find: /^@md-editor\/mdx-plugins$/,
        replacement: workspacePath("../../packages/mdx-plugins/src/index.ts"),
      },
      {
        find: /^@md-editor\/shared$/,
        replacement: workspacePath("../../packages/shared/src/index.ts"),
      },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  clearScreen: false,
});
