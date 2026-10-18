import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * KaTeX 样式依赖契约。
 *
 * 1) **声明义务**：任何在入口样式里全局 `@import "katex/dist/katex.min.css"` 的应用，
 *    都必须在自己 `package.json` 里声明 `katex` —— 否则该样式只能靠 pnpm 隐式提升解析，
 *    属幽灵依赖（换 node-linker / 提升策略或裁剪安装即会构建失败）。
 * 2) **单一投放**：`@md-editor/syntax-plugins` 自身不再引入官方样式，避免与接入端重复投放
 *    同一份 CSS（历史上 site/mobile 曾同时存在全局与包内两份）。
 */
const repoRoot = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, repoRoot), "utf8");

const APP_STYLESHEET_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["apps/web", "apps/web/src/styles.css"],
  ["apps/desktop", "apps/desktop/src/styles.css"],
  ["apps/utools", "apps/utools/src/styles.css"],
  ["apps/mobile/core", "apps/mobile/core/src/styles.css"],
  ["apps/site", "apps/site/app/globals.css"],
];

describe("KaTeX stylesheet dependency contract", () => {
  it("requires every app that imports the KaTeX stylesheet to declare katex", () => {
    for (const [app, stylesheet] of APP_STYLESHEET_ENTRIES) {
      if (!read(stylesheet).includes("katex/dist/katex.min.css")) {
        continue;
      }
      const manifest = JSON.parse(read(`${app}/package.json`)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = { ...manifest.dependencies, ...manifest.devDependencies }.katex;
      expect(declared, `${app} 引入了 KaTeX 官方样式但未声明 katex 依赖`).toBeTruthy();
    }
  });

  it("keeps the official stylesheet out of the plugin package to avoid duplicate投放", () => {
    const loader = read("packages/syntax-plugins/src/math/math-loader.ts");
    expect(loader).not.toContain("katex/dist/katex.min.css");
  });
});
