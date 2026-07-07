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
        find: "@md-editor/editor-ui/milkdown-editor",
        replacement: workspacePath("../../packages/editor-ui/src/components/MilkdownEditor.tsx"),
      },
      {
        find: "@md-editor/editor-ui/source-editor",
        replacement: workspacePath("../../packages/editor-ui/src/components/SourceEditor.tsx"),
      },
      {
        find: "@md-editor/editor-ui/hooks",
        replacement: workspacePath("../../packages/editor-ui/src/hooks/index.ts"),
      },
      {
        find: /^@md-editor\/editor-ui$/,
        replacement: workspacePath("../../packages/editor-ui/src/index.ts"),
      },
      {
        find: "@md-editor/editor-core/ai",
        replacement: workspacePath("../../packages/editor-core/src/ai/index.ts"),
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
      {
        find: /^@codemirror\/lang-markdown$/,
        replacement: workspacePath("../../node_modules/@codemirror/lang-markdown/dist/index.js"),
      },
      {
        find: /^@milkdown\/kit\/core$/,
        replacement: workspacePath("../../node_modules/@milkdown/kit/lib/core.js"),
      },
      {
        find: /^@milkdown\/kit\/plugin\/listener$/,
        replacement: workspacePath("../../node_modules/@milkdown/kit/lib/plugin/listener.js"),
      },
      {
        find: /^@milkdown\/kit\/plugin\/history$/,
        replacement: workspacePath("../../node_modules/@milkdown/kit/lib/plugin/history.js"),
      },
      {
        find: /^@milkdown\/kit\/preset\/commonmark$/,
        replacement: workspacePath("../../node_modules/@milkdown/kit/lib/preset/commonmark.js"),
      },
      {
        find: /^@milkdown\/kit\/preset\/gfm$/,
        replacement: workspacePath("../../node_modules/@milkdown/kit/lib/preset/gfm.js"),
      },
      {
        find: /^@milkdown\/react$/,
        replacement: workspacePath("../../node_modules/@milkdown/react/lib/index.js"),
      },
      {
        find: /^@uiw\/react-codemirror$/,
        replacement: workspacePath("../../node_modules/@uiw/react-codemirror/esm/index.js"),
      },
    ],
  },
  server: {
    port: 7273,
    strictPort: true,
  },
  clearScreen: false,
});
