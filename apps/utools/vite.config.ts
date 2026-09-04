import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  base: "./",
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
        find: /^@md-editor\/editor-core$/,
        replacement: workspacePath("../../packages/editor-core/src/index.ts"),
      },
      {
        find: /^@md-editor\/markdown-fidelity$/,
        replacement: workspacePath("../../packages/markdown-fidelity/src/index.ts"),
      },
      {
        find: /^@md-editor\/file-system$/,
        replacement: workspacePath("../../packages/file-system/src/index.ts"),
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
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
