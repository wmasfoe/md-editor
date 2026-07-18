import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json" with { type: "json" };

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
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
    ],
  },
  server: {
    port: 7273,
    strictPort: true,
  },
  clearScreen: false,
});
