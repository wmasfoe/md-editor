/**
 * @file check.test.mjs
 * @description 结构护栏的反例测试（N 类证据）：证明"护栏真的会拦人"，
 * 以及"不误伤存量合法形态"。每个用例构造一个最小 fixture 根目录后调用 `runChecks`。
 *
 * 覆盖（对应 test-spec §1.1）：
 * N1–N4 阈值边界（800 通过 / 801 warn / 1200 通过 / 1201 fail）
 * N5/N6/N6b/N6c/N6d 豁免清单（超 maxLines / 文件缺失 / 新增 id / maxLines 上调 / 下调与删除允许）
 * N7 冗余回退段路径
 * N8/N8b/N9e src 内测试与残留目录（PR2 规则）
 * N9/N9d wysiwyg 顶层集合与逐文件域归属（PR2 规则）
 * N9b/N9c/N9c2 测试镜像（破裂失败 / support 豁免 / 非 TS 宿主目录不入范围）
 * N10 跨包深导入
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runChecks, WARN_LINES, FAIL_LINES, MOVE_HEADROOM } from "./check.mjs";

/** 在临时目录中构造 fixture 根并执行回调；回调结束后清理。 */
function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "structure-check-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** 生成一条 demo 豁免条目（N5–N6d 共用）。 */
const exceptionEntry = (maxLines) => [
  { id: "demo-module", path: "packages/demo/src/big.ts", maxLines, reason: "test fixture" },
];

const lines = (count) => `${"const a = 1;\n".repeat(count - 1)}const a = 1;`;
const exceptions = (entries) => JSON.stringify(entries, null, 2);
const baselineOf = (entries) => ({
  "scripts/structure/exceptions.baseline.json": exceptions(entries),
});

function fails(result, matcher) {
  return result.failures.some((item) => item.includes(matcher));
}

test("N1–N4：阈值边界（800 通过 / 801 warn / 1200 通过 / 1201 fail）", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/ok.ts": lines(WARN_LINES),
      "packages/demo/src/warn.ts": lines(WARN_LINES + 1),
      "packages/demo/src/fail-edge.ts": lines(FAIL_LINES),
      "packages/demo/src/fail.ts": lines(FAIL_LINES + 1),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "src/fail.ts"), true, "1201 行且未登记必须失败");
      assert.equal(fails(result, "src/fail-edge.ts"), false, "1200 行为边界内，不得失败");
      assert.equal(fails(result, "src/warn.ts"), false, "801 行只警告不失败");
      assert.equal(
        result.warnings.some((item) => item.includes("src/warn.ts")),
        true,
        "801 行必须产生警告",
      );
      assert.equal(
        result.warnings.some((item) => item.includes("src/ok.ts")),
        false,
        "800 行不得产生警告",
      );
    },
  );
});

test("N5/N6/N6b/N6c/N6d：豁免清单约束", () => {
  // N5：现行 maxLines 超过 基线 + headroom
  withFixture(
    {
      "packages/demo/src/big.ts": lines(1300),
      "structure-exceptions.json": exceptions(exceptionEntry(1300)),
      ...baselineOf(exceptionEntry(1200)),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "禁止增长"), true, "maxLines 上调超 headroom 必须失败");
    },
  );
  // N6：豁免指向不存在文件
  withFixture(
    {
      "structures/placeholder.txt": "",
      "structure-exceptions.json": exceptions(exceptionEntry(1300)),
      ...baselineOf(exceptionEntry(1300)),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "文件不存在"), true, "僵尸豁免条目必须失败");
    },
  );
  // N6b：新增 id 不在基线
  withFixture(
    {
      "packages/demo/src/big.ts": lines(1300),
      "structure-exceptions.json": exceptions(exceptionEntry(1300)),
      ...baselineOf([]),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "新增豁免 id"), true, "新增豁免条目必须失败");
    },
  );
  // N6c/N6d：headroom 内允许；下调与删除允许
  withFixture(
    {
      "packages/demo/src/big.ts": lines(1300),
      "structure-exceptions.json": exceptions(exceptionEntry(1200 + MOVE_HEADROOM)),
      ...baselineOf(exceptionEntry(1200)),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "headroom"), false, "headroom 内的上调必须允许（搬迁 PR）");
    },
  );
  withFixture(
    {
      "packages/demo/src/big.ts": lines(1300),
      "structure-exceptions.json": exceptions([]),
      ...baselineOf(exceptionEntry(1300)),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "新增豁免 id"), false, "删除条目必须允许（PR3 拆分后缩减清单）");
    },
  );
});

test("N7：冗余回退段路径必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/bad.ts": 'import { x } from "../../src/wysiwyg/../markdown/x.ts";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "冗余回退段"), true);
    },
  );
});

test("N10：跨包深导入必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/deep.ts":
        'import { y } from "@md-editor/renderer-codemirror/src/index.ts";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "跨包深导入"), true);
    },
  );
});

test("N9b/N9c/N9c2：测试镜像（破裂失败 / support 豁免 / 非 TS 宿主目录不入范围）", () => {
  // N9b：非辅助目录缺少 src 对应目录
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/index.ts": "export const a = 1;\n",
      "packages/demo/tests/wysiwyg/sample.test.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "镜像破裂"), true);
    },
  );
  // N9c：support 目录豁免
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/index.ts": "export const a = 1;\n",
      "packages/demo/tests/support/helper.ts": "export const helper = 1;\n",
      "packages/demo/tests/index.test.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "support"), false, "support/ 属辅助目录，不得误伤");
    },
  );
  // N9c2：非 TS 宿主测试目录（无 src 兄弟目录）不入范围
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "apps/mobile/ios/Tests/InkpointContractTests/main.swift": "import XCTest\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "InkpointContractTests"), false, "非 TS 宿主目录不得入镜像范围");
    },
  );
});

test("N8/N8b/N9e：src 内测试与残留目录（PR2 规则）", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/index.ts": "export const a = 1;\n",
      "packages/demo/src/foo.test.ts": "export {};\n",
      "packages/demo/tests/index.test.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr2" });
      assert.equal(fails(result, "测试文件必须位于 tests/"), true, "扁平 colocated 必须失败");
    },
  );
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/index.ts": "export const a = 1;\n",
      "packages/demo/src/tests/foo.test.ts": "export {};\n",
      "packages/demo/tests/index.test.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr2" });
      assert.equal(fails(result, "测试文件必须位于 tests/"), true, "src/tests/ 伪镜像必须失败");
      assert.equal(fails(result, "不得有 tests/ 目录"), true, "src/tests/ 目录残留必须失败");
    },
  );
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/index.ts": "export const a = 1;\n",
      "packages/demo/tests/index.test.ts": "export {};\n",
      "packages/demo/src/tests/.keep": "",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr2" });
      assert.equal(fails(result, "不得有 tests/ 目录"), true, "空目录残留必须失败（PR2 后）");
    },
  );
});

test("N9/N9d：wysiwyg 顶层集合与逐文件域归属（PR2 规则）", () => {
  const base = {
    "structure-exceptions.json": exceptions([]),
    ...baselineOf([]),
    "packages/renderer-codemirror/src/wysiwyg/index.ts": "export {};\n",
  };
  withFixture(
    { ...base, "packages/renderer-codemirror/src/wysiwyg/loose.ts": "export {};\n" },
    (root) => {
      const result = runChecks({ root, phase: "pr2" });
      assert.equal(fails(result, "未归域的条目"), true, "顶层多出文件必须失败");
    },
  );
  withFixture(
    {
      ...base,
      "packages/renderer-codemirror/src/wysiwyg/state/table-projection.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr2" });
      assert.equal(
        fails(result, "state: 多余") || fails(result, "多出未登记文件"),
        true,
        "错误域归属必须失败",
      );
    },
  );
});

test("PR1 阶段不得启用 PR2/PR3 规则（ruleset rollout）", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/demo/src/foo.test.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(result.rules.includes("testsInsideSrc"), false, "PR1 不得启用 PR2 规则");
      assert.equal(
        fails(result, "测试文件必须位于 tests/"),
        false,
        "PR1 不应因存量 src 内测试而红",
      );
    },
  );
});
