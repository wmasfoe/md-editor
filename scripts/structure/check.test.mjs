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
import {
  runChecks,
  WARN_LINES,
  FAIL_LINES,
  MOVE_HEADROOM,
  SPLIT_TARGETS,
  WYSIWYG_DOMAIN_MEMBERS,
  checkSplitTargets,
  checkWysiwygDomains,
} from "./check.mjs";

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
      "packages/demo/src/deep.ts": 'import { y } from "@md-editor/editor/src/index.ts";\n',
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
    "packages/editor/src/wysiwyg/index.ts": "export {};\n",
  };
  withFixture({ ...base, "packages/editor/src/wysiwyg/loose.ts": "export {};\n" }, (root) => {
    const result = runChecks({ root, phase: "pr2" });
    assert.equal(fails(result, "未归域的条目"), true, "顶层多出文件必须失败");
  });
  withFixture(
    {
      ...base,
      "packages/editor/src/wysiwyg/state/table-projection.ts": "export {};\n",
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

// PR3 专项阈值独立于普通 1200 行阈值，确保残余 controller 不会再次膨胀。
test("PR3：四个拆分入口均为 800 行硬上限，且只在 PR3 启用", () => {
  for (const [target, limit] of Object.entries(SPLIT_TARGETS)) {
    assert.equal(limit, 800, `${target} 必须使用单一职责簇上限`);
    withFixture({ [target]: lines(800) }, (root) => {
      assert.deepEqual(checkSplitTargets({ root }).failures, []);
    });
    withFixture({ [target]: lines(801) }, (root) => {
      assert.equal(checkSplitTargets({ root }).failures.length, 1);
      assert.equal(runChecks({ root, phase: "pr2" }).rules.includes("splitTargets"), false);
      assert.equal(fails(runChecks({ root, phase: "pr3" }), `[splitTargets] ${target}`), true);
    });
  }
});

test("PR3：state 拆分成员精确匹配，拒绝恢复旧聚合文件", () => {
  const members = [
    "types.ts",
    "projection-field.ts",
    "decorations.ts",
    "ranges.ts",
    "atoms.ts",
    "visible-marks.ts",
    "inline-marker-reveal.ts",
    "change-authorization.ts",
    "change-protection.ts",
  ];
  assert.deepEqual(WYSIWYG_DOMAIN_MEMBERS.state, members);
  const files = Object.fromEntries(
    Object.entries(WYSIWYG_DOMAIN_MEMBERS).flatMap(([domain, names]) =>
      names.map((name) => [`packages/editor/src/wysiwyg/${domain}/${name}`, "export {};\n"]),
    ),
  );
  withFixture(files, (root) => assert.deepEqual(checkWysiwygDomains({ root }).failures, []));
  withFixture(
    {
      ...files,
      "packages/editor/src/wysiwyg/state/projection-state.ts": "export {};\n",
    },
    (root) => {
      assert.equal(
        checkWysiwygDomains({ root }).failures.some((failure) =>
          failure.includes("多出未登记文件 projection-state.ts"),
        ),
        true,
      );
    },
  );
});

test("cluster 级硬约束：指定包内 >800 行失败，其它包仅警告", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/editor/src/big.ts": lines(WARN_LINES + 1),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(
        fails(result, "cluster 级硬约束"),
        true,
        "editor 内 801 行必须失败（防拆成巨型协作者）",
      );
    },
  );
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/other/src/big.ts": lines(WARN_LINES + 1),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr1" });
      assert.equal(fails(result, "cluster 级硬约束"), false, "其它包 801 行只应警告");
      assert.equal(
        result.warnings.some((item) => item.includes("src/big.ts")),
        true,
        "其它包必须保留警告",
      );
    },
  );
});

test("PR3：renderer 簇新增未登记协作者必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/editor/src/renderer/index.ts": "export {};\n",
      "packages/editor/src/renderer/controller.ts": "export {};\n",
      "packages/editor/src/renderer/types.ts": "export {};\n",
      "packages/editor/src/renderer/view-adapter.ts": "export {};\n",
      "packages/editor/src/renderer/controller/probe.ts": "export {};\n",
      "packages/editor/src/renderer/controller/new-collaborator.ts": "export {};\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "多出未登记的簇成员"),
        true,
        "renderer 簇新增协作者必须失败（契约第二维度）",
      );
    },
  );
});

/**
 * 依赖声明护栏（declaredWorkspaceDeps）。
 * 核心不变量：monorepo 跨包 import 必须写进 package.json，不能只靠解析器运气。
 */
test("依赖声明：src 值导入未在 deps/peerDeps 必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/consumer/package.json": JSON.stringify({
        name: "@md-editor/consumer",
        dependencies: {},
      }),
      "packages/consumer/src/use.ts": 'import { thing } from "@md-editor/provider";\n',
      "packages/provider/package.json": JSON.stringify({ name: "@md-editor/provider" }),
      "packages/provider/src/index.ts": "export const thing = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "值导入 @md-editor/provider 未在 dependencies 或 peerDependencies 声明"),
        true,
        "src 值导入未声明必须失败",
      );
    },
  );
});

test("依赖声明：src 值导入声明在 peerDependencies 视为合规", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/consumer/package.json": JSON.stringify({
        name: "@md-editor/consumer",
        peerDependencies: { "@md-editor/provider": "workspace:*" },
      }),
      "packages/consumer/src/use.ts": 'import { thing } from "@md-editor/provider";\n',
      "packages/provider/package.json": JSON.stringify({ name: "@md-editor/provider" }),
      "packages/provider/src/index.ts": "export const thing = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "@md-editor/provider"), false, "peerDependencies 声明应视为合规");
    },
  );
});

test("依赖声明：src 纯类型导入允许只声明在 devDependencies", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/consumer/package.json": JSON.stringify({
        name: "@md-editor/consumer",
        dependencies: {},
        devDependencies: { "@md-editor/provider": "workspace:*" },
      }),
      // `import type` 与「全部具名带 type」两种纯类型形态都必须放行
      "packages/consumer/src/a.ts": 'import type { Thing } from "@md-editor/provider";\n',
      "packages/consumer/src/b.ts": 'import { type Thing } from "@md-editor/provider";\n',
      "packages/provider/package.json": JSON.stringify({ name: "@md-editor/provider" }),
      "packages/provider/src/index.ts": "export type Thing = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "@md-editor/provider"), false, "纯类型导入应允许 devDependencies");
    },
  );
});

test("依赖声明：混用具名（值+类型）按值导入处理，devDependencies 不足以放行", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/consumer/package.json": JSON.stringify({
        name: "@md-editor/consumer",
        dependencies: {},
        devDependencies: { "@md-editor/provider": "workspace:*" },
      }),
      "packages/consumer/src/mixed.ts":
        'import { type Thing, createThing } from "@md-editor/provider";\n',
      "packages/provider/package.json": JSON.stringify({ name: "@md-editor/provider" }),
      "packages/provider/src/index.ts":
        "export type Thing = 1;\nexport const createThing = () => 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "值导入 @md-editor/provider"),
        true,
        "含值具名的混合导入必须按值导入校验",
      );
    },
  );
});

test("依赖声明：tests 内导入允许任一依赖字段声明", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/consumer/package.json": JSON.stringify({
        name: "@md-editor/consumer",
        devDependencies: { "@md-editor/provider": "workspace:*" },
      }),
      "packages/consumer/src/index.ts": "export const x = 1;\n",
      "packages/consumer/tests/index.test.ts": 'import { thing } from "@md-editor/provider";\n',
      "packages/provider/package.json": JSON.stringify({ name: "@md-editor/provider" }),
      "packages/provider/src/index.ts": "export const thing = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "@md-editor/provider"), false, "tests 内 devDependencies 应放行");
    },
  );
});

test("依赖声明：自引用不校验", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/self/package.json": JSON.stringify({ name: "@md-editor/self", dependencies: {} }),
      "packages/self/src/index.ts": 'import { own } from "@md-editor/self";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "@md-editor/self"), false, "自引用不应触发依赖声明校验");
    },
  );
});

/**
 * Tailwind 扫描源护栏（tailwindSourceEntry）。
 * 核心不变量：扫描源只在一处维护，app 不得手抄 @source。
 */
const twApp = (name, extra = {}) => ({
  [`apps/${name}/package.json`]: JSON.stringify({
    name: `@md-editor/${name}`,
    devDependencies: { tailwindcss: "catalog:" },
    ...extra,
  }),
});

test("Tailwind：使用 tailwindcss 却未引入共享扫描源必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css": '@import "tailwindcss";\n',
      "packages/app-ui/styles/tailwind-sources.css": '@source "../src";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "未引入共享扫描源入口"), true, "缺失共享入口必须失败");
    },
  );
});

test("Tailwind：引入共享入口视为合规", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css":
        '@import "tailwindcss";\n@import "@md-editor/app-ui/tailwind-sources.css";\n',
      "packages/app-ui/styles/tailwind-sources.css": '@source "../src";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "未引入共享扫描源入口"), false, "引入共享入口应放行");
    },
  );
});

test("Tailwind：app 手抄 @source 必须失败（即使已引入共享入口）", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css":
        '@import "tailwindcss";\n@import "@md-editor/app-ui/tailwind-sources.css";\n@source "../../../packages/app-ui/src";\n',
      "packages/app-ui/styles/tailwind-sources.css": '@source "../src";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "不得直接写 @source"), true, "手抄 @source 必须失败");
    },
  );
});

test("Tailwind：@source inline() 是 safelist，不受禁令影响", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css":
        '@import "tailwindcss";\n@import "@md-editor/app-ui/tailwind-sources.css";\n@source inline("underline");\n',
      "packages/app-ui/styles/tailwind-sources.css": '@source "../src";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "不得直接写 @source"), false, "@source inline() 应放行");
    },
  );
});

test("Tailwind：共享文件缺失必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css":
        '@import "tailwindcss";\n@import "@md-editor/app-ui/tailwind-sources.css";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "共享扫描源入口文件缺失"), true, "共享文件缺失必须失败");
    },
  );
});

test("Tailwind：共享文件 @source 数量不为 1 必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      ...twApp("demo"),
      "apps/demo/src/styles.css":
        '@import "tailwindcss";\n@import "@md-editor/app-ui/tailwind-sources.css";\n',
      "packages/app-ui/styles/tailwind-sources.css": '@source "../src";\n@source "../other";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "应恰好包含 1 处 @source"), true, "多余 @source 必须失败");
    },
  );
});

/**
 * 语法插件独立性护栏（syntaxPluginsIndependence）。
 * 核心不变量：插件包不得依赖插件宿主实现，否则第三方插件作者会跟着学坏。
 */
test("语法插件：src 内 import editor 必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/syntax-plugins/package.json": JSON.stringify({
        name: "@md-editor/syntax-plugins",
      }),
      "packages/syntax-plugins/src/bad.ts": 'import { thing } from "@md-editor/editor";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "语法插件包不得依赖渲染器实现"), true, "反向依赖必须失败");
    },
  );
});

test("语法插件：子路径 import 同样被禁止", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/syntax-plugins/package.json": JSON.stringify({
        name: "@md-editor/syntax-plugins",
      }),
      "packages/syntax-plugins/src/bad.ts": 'import { t } from "@md-editor/editor/testing";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "语法插件包不得依赖渲染器实现"), true, "子路径反向依赖必须失败");
    },
  );
});

test("语法插件：只依赖 plugin-sdk 视为合规", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/syntax-plugins/package.json": JSON.stringify({
        name: "@md-editor/syntax-plugins",
      }),
      "packages/syntax-plugins/src/good.ts":
        'import { definePlugin } from "@md-editor/plugin-sdk";\nimport { x } from "@md-editor/plugin-sdk/syntax";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "语法插件包不得依赖渲染器实现"), false, "只依赖契约应放行");
    },
  );
});

test("语法插件：tests 内引用渲染器不受本规则限制", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/syntax-plugins/package.json": JSON.stringify({
        name: "@md-editor/syntax-plugins",
      }),
      "packages/syntax-plugins/src/index.ts": "export const a = 1;\n",
      "packages/syntax-plugins/tests/a.test.ts":
        'import { EditorState } from "@md-editor/editor";\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "语法插件包不得依赖渲染器实现"),
        false,
        "测试需要渲染器夹具，应放行",
      );
    },
  );
});

/** Editor source, including React, must stay independent of application packages. */
for (const [path, source] of [
  ["src/index.ts", 'import { AppEditor } from "@md-editor/app-ui";'],
  ["src/react/view.ts", 'export { useTranslation } from "@md-editor/i18n";'],
  ["src/react/lazy.ts", 'const load = () => import("@md-editor/app-ui/hooks");'],
  ["src/react/types.ts", 'import type { AppEditorProps } from "@md-editor/app-ui";'],
  ["src/react/setup.ts", 'import "@md-editor/i18n";'],
]) {
  test(`编辑器独立性：禁止应用反向依赖 ${path}`, () => {
    withFixture(
      {
        "packages/editor/package.json": JSON.stringify({
          name: "@md-editor/editor",
          dependencies: {
            "@md-editor/app-ui": "workspace:*",
            "@md-editor/i18n": "workspace:*",
          },
        }),
        [`packages/editor/${path}`]: source,
      },
      (root) => {
        const result = runChecks({ root, phase: "pr3" });
        assert.equal(fails(result, "编辑器不得依赖应用 UI 或国际化"), true);
      },
    );
  });
}

test("编辑器独立性：允许 core、React、相近包名及测试夹具", () => {
  withFixture(
    {
      "packages/editor/package.json": JSON.stringify({ name: "@md-editor/editor" }),
      "packages/editor/src/index.ts": 'export { createDocumentState } from "@md-editor/core";',
      "packages/editor/src/react/index.ts":
        'import { useState } from "react";\nimport { x } from "@md-editor/app-ui-tools";',
      "packages/editor/tests/application.test.ts": 'import { AppEditor } from "@md-editor/app-ui";',
    },
    (root) => {
      assert.equal(
        fails(runChecks({ root, phase: "pr3" }), "编辑器不得依赖应用 UI 或国际化"),
        false,
      );
    },
  );
});

/**
 * 库模块顶层副作用护栏（noTopLevelSideEffects）。
 * 核心不变量：import 一个库不得改动宿主环境。
 */
test("顶层副作用：i18n.ts 顶层裸调用必须失败", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/i18n/src/i18n.ts":
        'import { x } from "./x";\nexport const a = 1;\n\nensureI18nInitialized();\n',
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "顶层不得有执行语句"), true, "顶层裸调用必须失败");
    },
  );
});

test("顶层副作用：只有声明与注释视为合规", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/i18n/src/i18n.ts": [
        "/**",
        " * 文件头注释",
        " */",
        'import { x } from "./x";',
        "",
        "export const a = 1;",
        "export function f() {",
        "  doSomething();",
        "}",
        "export type T = string;",
        "",
      ].join("\n"),
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "顶层不得有执行语句"), false, "纯声明应放行");
    },
  );
});

test("顶层副作用：函数体内的调用不受限制", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/i18n/src/i18n.ts":
        "export function init() {\n  ensureI18nInitialized();\n  return 1;\n}\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "顶层不得有执行语句"), false, "函数体内调用应放行");
    },
  );
});

test("依赖声明：Next 风格 app（components/ 而非 src/）同样受检", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "apps/nextlike/package.json": JSON.stringify({
        name: "@md-editor/nextlike",
        dependencies: {},
      }),
      "apps/nextlike/components/Widget.tsx": 'import { t } from "@md-editor/i18n";\n',
      "packages/i18n/package.json": JSON.stringify({ name: "@md-editor/i18n" }),
      "packages/i18n/src/index.ts": "export const t = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "值导入 @md-editor/i18n"),
        true,
        "Next 风格 app 的 components/ 目录必须纳入依赖声明检查",
      );
    },
  );
});

test("依赖声明：export ... from 重导出按运行期依赖校验", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/reexporter/package.json": JSON.stringify({
        name: "@md-editor/reexporter",
        dependencies: {},
        devDependencies: { "@md-editor/target": "workspace:*" },
      }),
      "packages/reexporter/src/index.ts": 'export * from "@md-editor/target";\n',
      "packages/target/package.json": JSON.stringify({ name: "@md-editor/target" }),
      "packages/target/src/index.ts": "export const a = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(
        fails(result, "值导入 @md-editor/target"),
        true,
        "export * from 必须按运行期依赖校验（devDependencies 不足以放行）",
      );
    },
  );
});

test("依赖声明：export type ... from 允许只声明在 devDependencies", () => {
  withFixture(
    {
      "structure-exceptions.json": exceptions([]),
      ...baselineOf([]),
      "packages/reexporter/package.json": JSON.stringify({
        name: "@md-editor/reexporter",
        dependencies: {},
        devDependencies: { "@md-editor/target": "workspace:*" },
      }),
      "packages/reexporter/src/index.ts": 'export type { T } from "@md-editor/target";\n',
      "packages/target/package.json": JSON.stringify({ name: "@md-editor/target" }),
      "packages/target/src/index.ts": "export type T = 1;\n",
    },
    (root) => {
      const result = runChecks({ root, phase: "pr3" });
      assert.equal(fails(result, "@md-editor/target"), false, "export type 应允许 devDependencies");
    },
  );
});
