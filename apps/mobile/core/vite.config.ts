import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  // 必须使用相对路径，确保在 iOS/Android 原生文件沙盒（file://）与 assets 下正常寻址
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@md-editor\/compiler$/,
        replacement: workspacePath("../../../packages/compiler/src/index.ts"),
      },
      {
        find: /^@md-editor\/editor-ui$/,
        replacement: workspacePath("../../../packages/editor-ui/src/index.ts"),
      },
      {
        find: /^@md-editor\/renderer-codemirror$/,
        replacement: workspacePath("../../../packages/renderer-codemirror/src/index.ts"),
      },
      {
        find: /^@md-editor\/editor-core$/,
        replacement: workspacePath("../../../packages/editor-core/src/index.ts"),
      },
      {
        find: /^@md-editor\/syntax-plugins$/,
        replacement: workspacePath("../../../packages/syntax-plugins/src/index.ts"),
      },
      {
        find: /^@md-editor\/markdown-fidelity$/,
        replacement: workspacePath("../../../packages/markdown-fidelity/src/index.ts"),
      },
      {
        find: /^@md-editor\/mdx-component-registry$/,
        replacement: workspacePath("../../../packages/mdx-component-registry/src/index.ts"),
      },
      {
        find: /^@md-editor\/shared$/,
        replacement: workspacePath("../../../packages/shared/src/index.ts"),
      },
    ],
  },
  build: {
    target: "es2022",
    // 离线单页建议不拆过多碎 chunk，便于原生离线资产管理
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    port: 5175,
    strictPort: true,
  },
  clearScreen: false,
});
