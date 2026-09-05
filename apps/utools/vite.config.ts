import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import fs from "node:fs";
import path from "node:path";

function workspacePath(subpath: string): string {
  return fileURLToPath(new URL(subpath, import.meta.url));
}

function utoolsDistBundlePlugin() {
  return {
    name: "utools-dist-bundle",
    closeBundle() {
      const outDir = workspacePath("dist");
      if (!fs.existsSync(outDir)) return;

      // 1. 复制 logo.png
      const logoSrc = workspacePath("logo.png");
      if (fs.existsSync(logoSrc)) {
        fs.copyFileSync(logoSrc, path.join(outDir, "logo.png"));
      }

      // 2. 复制 preload/ 目录
      const preloadDir = path.join(outDir, "preload");
      fs.mkdirSync(preloadDir, { recursive: true });
      fs.copyFileSync(workspacePath("preload/index.cjs"), path.join(preloadDir, "index.cjs"));

      // 3. 生成发布版 plugin.json (main 指向 index.html，去除开发配置)
      const pluginJsonPath = workspacePath("plugin.json");
      if (fs.existsSync(pluginJsonPath)) {
        const raw = fs.readFileSync(pluginJsonPath, "utf-8");
        const json = JSON.parse(raw);
        const distJson = {
          ...json,
          main: "index.html",
        };
        delete distJson.development;
        fs.writeFileSync(
          path.join(outDir, "plugin.json"),
          JSON.stringify(distJson, null, 2),
          "utf-8",
        );
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), utoolsDistBundlePlugin()],
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
