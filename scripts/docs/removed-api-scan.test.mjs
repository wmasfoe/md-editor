/**
 * @file removed-api-scan.test.mjs
 * @description 已删 API 扫描门禁的自证测试。
 *
 * 门禁类测试必须证明"它真的会红"，否则只是摆设：这里用临时文件注入一条违规，
 * 断言扫描器能抓到；同时断言当前仓库是干净的。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { REMOVED_API, findRemovedApiReferences, scanTargets } from "./removed-api-scan.mjs";

test("当前仓库没有已删 API 的残留引用", () => {
  const violations = findRemovedApiReferences();
  assert.deepEqual(
    violations,
    [],
    `以下位置仍在教已删除的 API：\n${violations
      .map((v) => `${v.file}:${v.line} → ${v.id}（应改为 ${v.replacement}）`)
      .join("\n")}`,
  );
});

test("登记表覆盖本轮与上轮删掉的对外标识符", () => {
  const ids = REMOVED_API.map((entry) => entry.id);
  for (const expected of ["renderer.use", "renderer.setPlugins", "plugin-sdk/mdx"]) {
    assert.ok(ids.includes(expected), `登记表缺少 ${expected}，该删除项会重新变成盲区`);
  }
});

test("扫描范围包含根 README 与 docs（此前的盲区）", () => {
  const targets = scanTargets();
  assert.ok(targets.includes("README.md"), "根 README 必须纳入扫描");
  assert.ok(targets.includes("README_ZH.md"), "中文根 README 必须纳入扫描");
  assert.ok(
    targets.some((file) => file.startsWith("docs/agent/")),
    "docs 目录必须纳入扫描",
  );
  assert.ok(
    targets.some((file) => file.startsWith("packages/editor/src/")),
    "公开包的 src 注释必须纳入扫描",
  );
});

test("每条登记项都有替代写法（不允许只说“删了”而不给出路）", () => {
  for (const entry of REMOVED_API) {
    assert.ok(entry.replacement?.length > 0, `${entry.id} 缺少 replacement 指引`);
  }
});
