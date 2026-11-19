import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "editor-dist",
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "editor.html") },
  },
});
