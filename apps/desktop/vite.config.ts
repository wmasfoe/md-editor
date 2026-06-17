import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@md-editor/editor-ui": fileURLToPath(
        new URL("../../packages/editor-ui/src/index.ts", import.meta.url)
      ),
      "@md-editor/editor-core": fileURLToPath(
        new URL("../../packages/editor-core/src/index.ts", import.meta.url)
      ),
      "@md-editor/markdown-fidelity": fileURLToPath(
        new URL("../../packages/markdown-fidelity/src/index.ts", import.meta.url)
      ),
      "@codemirror/lang-markdown": fileURLToPath(
        new URL("../../node_modules/@codemirror/lang-markdown/dist/index.js", import.meta.url)
      ),
      "@milkdown/kit/core": fileURLToPath(
        new URL("../../node_modules/@milkdown/kit/lib/core.js", import.meta.url)
      ),
      "@milkdown/kit/plugin/listener": fileURLToPath(
        new URL("../../node_modules/@milkdown/kit/lib/plugin/listener.js", import.meta.url)
      ),
      "@milkdown/kit/plugin/history": fileURLToPath(
        new URL("../../node_modules/@milkdown/kit/lib/plugin/history.js", import.meta.url)
      ),
      "@milkdown/kit/preset/commonmark": fileURLToPath(
        new URL("../../node_modules/@milkdown/kit/lib/preset/commonmark.js", import.meta.url)
      ),
      "@milkdown/kit/preset/gfm": fileURLToPath(
        new URL("../../node_modules/@milkdown/kit/lib/preset/gfm.js", import.meta.url)
      ),
      "@milkdown/react": fileURLToPath(
        new URL("../../node_modules/@milkdown/react/lib/index.js", import.meta.url)
      ),
      "@uiw/react-codemirror": fileURLToPath(
        new URL("../../node_modules/@uiw/react-codemirror/esm/index.js", import.meta.url)
      )
    }
  },
  server: {
    port: 5174,
    strictPort: true
  },
  clearScreen: false
});
