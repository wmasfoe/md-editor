/**
 * G010/P5b 判据：四个重依赖必须留在主入口静态图之外。
 *
 * 这不是"体积优化"的守卫，而是 API 契约的守卫：
 * - 只 `import "@md-editor/editor"` 不应把 markdownlint / turndown / sanitize-html / mdast 系加载进来；
 * - 唯一的加载汇合点必须是 `packages/editor/src/module-loader.ts`（动态 import），
 *   这样"何时加载"才是单点可审的；
 * - 消毒器未就绪时返回 null（降级），不得"跳过消毒"直接放行。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");
const EDITOR_SRC = join(ROOT, "packages/editor/src");
const LOADER = join(EDITOR_SRC, "module-loader.ts");

/** 必须按需加载的依赖（前缀匹配，覆盖 mdast-util-* / micromark-extension-* 家族）。 */
const LAZY_ONLY = [
  "markdownlint",
  "turndown",
  "turndown-plugin-gfm",
  "sanitize-html",
  "mdast-util-",
  "micromark-extension-",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = walk(EDITOR_SRC);

/** 匹配静态值导入（`import type` 不产生运行时依赖，放行）。 */
function staticValueImports(source) {
  const found = [];
  for (const line of source.split("\n")) {
    const match = /^\s*import\s+(?!type\b)([\s\S]*?)\bfrom\s+"([^"]+)"/u.exec(line);
    if (match) found.push(match[2]);
  }
  return found;
}

test("编辑器源码里没有任何静态值导入指向四个重依赖", () => {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const spec of staticValueImports(source)) {
      if (LAZY_ONLY.some((prefix) => spec === prefix || spec.startsWith(prefix))) {
        violations.push(`${file.replace(`${ROOT}/`, "")} ← ${spec}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `这些文件仍有静态值导入，会让依赖回到首屏静态图：\n${violations.join("\n")}`,
  );
});

test("四个重依赖的动态 import 只出现在 module-loader.ts（单点可审）", () => {
  const violations = [];
  for (const file of files) {
    if (file === LOADER) continue;
    const source = readFileSync(file, "utf8");
    for (const prefix of LAZY_ONLY) {
      if (new RegExp(`import\\("${prefix}[^"]*"\\)`, "u").test(source)) {
        violations.push(`${file.replace(`${ROOT}/`, "")} → ${prefix}`);
      }
    }
  }
  assert.deepEqual(violations, [], `加载汇合点必须唯一：\n${violations.join("\n")}`);
});

test("module-loader 确实按需加载这四类依赖", () => {
  const source = readFileSync(LOADER, "utf8");
  for (const prefix of [
    "sanitize-html",
    "turndown",
    "mdast-util-from-markdown",
    "micromark-extension-mdx-jsx",
  ]) {
    assert.match(
      source,
      new RegExp(`import\\("${prefix}"\\)`, "u"),
      `module-loader.ts 缺少对 ${prefix} 的动态 import`,
    );
  }
});

test("markdownlint 仍是可选 peer（未就绪不得阻断创建）", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages/editor/package.json"), "utf8"));
  assert.equal(pkg.dependencies?.markdownlint, undefined, "markdownlint 不得进入 dependencies");
  assert.ok(pkg.peerDependenciesMeta?.markdownlint?.optional, "markdownlint 必须是可选 peer");
});
