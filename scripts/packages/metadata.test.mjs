/**
 * @file metadata.test.mjs
 * @description 发布元数据守卫（P5）：把"依赖卫生"从人工 review 变成断言。
 *
 * 覆盖三类曾经真实存在的缺陷：
 * - 幻影依赖（`editor` 声明了 `@md-editor/plugin-host` 却零引用）；
 * - 无头消费者被迫安装 CodeMirror（`plugin-sdk` 的 CM/Lezer peer 不可选）；
 * - 发布包缺 `sideEffects`，tree-shaking 收益丢失。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PUBLIC_PACKAGES, REPO_ROOT } from "./public-surface.mjs";

const manifestOf = (name) =>
  JSON.parse(readFileSync(join(REPO_ROOT, "packages", name, "package.json"), "utf8"));

test("每个公开包都声明 sideEffects 与 keywords（发布元数据不得残缺）", () => {
  const problems = [];
  for (const name of PUBLIC_PACKAGES) {
    const manifest = manifestOf(name);
    if (manifest.sideEffects === undefined) problems.push(`${manifest.name}: 缺 sideEffects`);
    if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0)
      problems.push(`${manifest.name}: 缺 keywords`);
    if (typeof manifest.homepage !== "string") problems.push(`${manifest.name}: 缺 homepage`);
  }
  assert.deepEqual(problems, [], `发布元数据缺失：\n${problems.join("\n")}`);
});

test("editor 不把 plugin-host 当作运行时依赖（幻影依赖）", () => {
  const manifest = manifestOf("editor");
  assert.equal(
    manifest.dependencies?.["@md-editor/plugin-host"],
    undefined,
    "@md-editor/plugin-host 只被 editor 的测试使用，应放在 devDependencies",
  );
});

test("plugin-sdk 的 CodeMirror/Lezer peer 必须声明齐全且不可选（根入口类型引用它们）", () => {
  const manifest = manifestOf("plugin-sdk");
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const required = ["@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/markdown"];
  const missing = required.filter((name) => !peers.includes(name));
  assert.deepEqual(missing, [], `plugin-sdk 缺少契约所需的 peer：${missing.join(", ")}`);
  // 不可选是**有意**的：SDK 的 .d.ts 引用这些类型，可选 peer 会让严格消费者解析失败。
  const optional = peers.filter((name) => manifest.peerDependenciesMeta?.[name]?.optional === true);
  assert.deepEqual(optional, [], `以下 peer 不应被标记 optional：${optional.join(", ")}`);
});

test("D-2：core 的 dependencies 只有 shared（不依赖 plugin-sdk，也不依赖编辑器运行时）", () => {
  const manifest = manifestOf("core");
  const deps = Object.keys(manifest.dependencies ?? {}).toSorted();
  // 无头约束：core 只能靠 shared 承载跨包词表（MDX 组件契约也在 shared/mdx）。
  assert.deepEqual(deps, ["@md-editor/shared"], `core 的多余依赖：${deps.join(", ")}`);

  const peers = Object.keys(manifest.peerDependencies ?? {});
  assert.deepEqual(
    peers,
    [],
    `core 不应声明 peer（会拖累只装 core 的消费者）：${peers.join(", ")}`,
  );
});

test("D-3：MDX 契约类型落在 shared，plugin-sdk 不再转发", () => {
  const shared = manifestOf("shared");
  const sdk = manifestOf("plugin-sdk");
  assert.equal(shared.exports?.["./mdx"], "./src/mdx.ts", "shared 必须导出 ./mdx 子入口");
  assert.equal(
    sdk.exports?.["./mdx"],
    undefined,
    "plugin-sdk 不得保留 ./mdx 转发入口（类型已迁至 shared）",
  );
});
