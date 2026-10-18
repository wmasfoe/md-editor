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
      fs.copyFileSync(workspacePath("preload/index.js"), path.join(preloadDir, "index.js"));
      const preloadPkgJson = workspacePath("preload/package.json");
      if (fs.existsSync(preloadPkgJson)) {
        fs.copyFileSync(preloadPkgJson, path.join(preloadDir, "package.json"));
      }

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

/**
 * 工作区包（`@md-editor/*`）不在此声明 Vite alias：
 * 它们经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * 别名只是重复的第二份入口描述，会随包增删漂移。
 * 解析契约回归测试见 `tests/vite-workspace-resolution.test.ts`。
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), utoolsDistBundlePlugin()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
