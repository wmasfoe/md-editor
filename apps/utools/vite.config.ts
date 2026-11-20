import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import unicodeSetsRegex from "@babel/plugin-transform-unicode-sets-regex";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import fs from "node:fs";
import path from "node:path";

function workspacePath(subpath: string): string {
  return fileURLToPath(new URL(subpath, import.meta.url));
}

const utoolsChromiumTarget = "chrome108";
const stringWidthEntry = /[/\\]string-width[/\\]index\.js$/u;

function transformStringWidth(code: string): string {
  return (
    transformSync(code, {
      babelrc: false,
      configFile: false,
      plugins: [unicodeSetsRegex],
    })?.code ?? code
  );
}

function utoolsUnicodeRegexPlugin(): Plugin {
  return {
    name: "utools-unicode-regex",
    enforce: "pre",
    // uTools 7.x uses Chromium 108. markdownlint imports string-width eagerly,
    // and esbuild alone preserves the unsupported RegExp v flag at runtime.
    transform(code, id) {
      if (stringWidthEntry.test(id)) return transformStringWidth(code);
    },
    config(): UserConfig {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "utools-unicode-regex",
                setup(build) {
                  // esbuild passes this filter to Go's regexp engine, which has no u flag.
                  build.onLoad(
                    { filter: new RegExp(stringWidthEntry.source) },
                    async ({ path: entryPath }) => ({
                      contents: transformStringWidth(await fs.promises.readFile(entryPath, "utf8")),
                      loader: "js",
                    }),
                  );
                },
              },
            ],
          },
        },
      };
    },
  };
}

function utoolsDistBundlePlugin() {
  return {
    name: "utools-dist-bundle",
    writeBundle() {
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
  plugins: [utoolsUnicodeRegexPlugin(), react(), tailwindcss(), utoolsDistBundlePlugin()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
  build: {
    target: utoolsChromiumTarget,
    outDir: "dist",
    emptyOutDir: true,
  },
});
