import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizePath, resolveConfig } from "vite";
import viteConfig from "../vite.config";

/**
 * 工作区解析契约（O2）：本应用**不得**再维护 `@md-editor/*` 的 Vite alias。
 *
 * 工作区包经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * alias 只是重复的第二份入口描述，历史上已出现漂移（desktop 曾缺 file-system/shared/i18n）。
 * 这里用真实 Vite resolver 验证 `exports` 回退链路成立，防止有人再靠 alias 兜底。
 */

const configSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const workspacePackages = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
}).filter((name) => name.startsWith("@md-editor/"));

/** 仓库实际使用的工作区子路径入口（仅校验本应用确实声明了其根包的那些） */
const WORKSPACE_SUBPATHS = [
  "@md-editor/editor-ui/hooks",
  "@md-editor/editor-ui/CodeMirrorEditor/testing",
  "@md-editor/mdx-plugins/metadata",
  "@md-editor/renderer-codemirror/testing",
  "@md-editor/syntax-plugins/math",
];

describe("web 工作区解析（无 alias）", () => {
  it("不声明冗余的 @md-editor/* alias", () => {
    // 对象级：配置中不得存在 resolve.alias（注释里出现 @md-editor/* 不算违规）
    const alias = (viteConfig as { resolve?: { alias?: unknown } }).resolve?.alias;
    expect(alias ?? []).toHaveLength(0);
    // 源码级：不得再出现 resolve 配置块，防止 alias 换写法回归
    expect(configSource).not.toMatch(/^\s*resolve:/mu);
  });

  it("每个工作区依赖与子路径入口都能经 exports 解析到 packages/*/src", async () => {
    const config = await resolveConfig(viteConfig, "serve", "development");
    const resolveId = config.createResolver({ asSrc: true });
    const importer = fileURLToPath(new URL("../src/main.tsx", import.meta.url));

    const specifiers = [
      ...workspacePackages,
      ...WORKSPACE_SUBPATHS.filter((subpath) =>
        workspacePackages.includes(subpath.split("/").slice(0, 2).join("/")),
      ),
    ];

    expect(specifiers.length).toBeGreaterThan(5);

    for (const specifier of specifiers) {
      const resolved = await resolveId(specifier, importer);
      expect(resolved, `${specifier} 未能解析`).toBeTruthy();
      expect(normalizePath(resolved ?? "")).toMatch(/\/packages\/[^/]+\/src\//u);
    }
  });
});
