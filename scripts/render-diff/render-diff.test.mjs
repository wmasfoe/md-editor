/**
 * @file render-diff.test.mjs
 * @description 渲染差分测试：同一份 Markdown 同时过 JS 渲染器与 Rust 渲染器，按 fixture
 * 声明的模式（byte / semantic）断言两者的等价级别。
 *
 * 为什么这是永久基础设施而不是迁移脚手架：
 * 移动端（`apps/mobile/core/ReaderCanvas.tsx`）继续使用 `@md-editor/compiler`（TS），
 * 桌面与 QuickLook 改用 Rust。因此仓库**长期存在两套渲染实现**，一致性不能靠人工纪律，
 * 只能靠这个会失败的测试来守。
 *
 * 自收紧规则（避免「永久跳过」变成永久漏测）：
 * - 若 `crates/render/Cargo.toml` 不存在 → 阶段 0 状态，跳过 Rust 侧并显式报告；
 * - 若该 crate 存在但渲染器跑不起来 → **失败**。否则一旦开始实现 Rust 侧，
 *   测试就会因为「反正会被跳过」而失去守门作用。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RENDER_FIXTURES, groupFixturesByMode, validateCorpus } from "./corpus/index.mjs";
import { compareRenderedHtml } from "./lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const rustCrateRoot = path.join(repoRoot, "crates/render");
const rustCargoToml = path.join(rustCrateRoot, "Cargo.toml");

/**
 * `cargo` 是否可用。
 *
 * 部分 CI job（如只跑 JS 单测的 `test-unit`）刻意不安装 Rust 工具链——
 * 差分测试在那里应当**显式跳过并报告**，而不是因为 `cargo: command not found`
 * 让整条 JS 测试链变红。真正守门的地方是 `crates/render` 的 crate 存在时：
 * 此时 cargo 必须可用，否则就是配置错误（见下方断言）。
 */
function hasCargo() {
  const result = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

/**
 * 用 JS 实现（`@md-editor/compiler`）渲染一条 fixture。
 *
 * 动态 import 而非顶层 import：`@md-editor/compiler` 是 TS 源码，顶层 import 会让
 * 语料校验类测试在纯 JS 环境里也背上编译负担。
 *
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function renderWithJs(markdown) {
  const { renderStaticHtml } = await import("../../packages/compiler/src/index.ts");
  return renderStaticHtml(markdown).html;
}

/**
 * 用 JS 实现渲染 standalone 文档。
 *
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function renderDocumentWithJs(markdown) {
  const { renderStaticDocument } = await import("../../packages/compiler/src/index.ts");
  return renderStaticDocument(markdown);
}

/**
 * 用 Rust 实现渲染全部 fixture。
 *
 * 约定：`crates/render` 提供一个 `render-fixtures` bin，从 stdin 读
 * `{ fixtures: [{ id, markdown }] }`，向 stdout 写
 * `{ results: { id: html }, documents: { id: standaloneHtml } }`。
 * 一次进程调用渲染全部语料，避免逐条启动的开销。
 *
 * @param {readonly { id: string, markdown: string }[]} fixtures
 * @returns {{ results: Record<string, string>, documents: Record<string, string> }}
 */
function renderWithRust(fixtures) {
  if (!hasCargo()) {
    throw new Error("cargo 不可用");
  }
  const payload = JSON.stringify({
    fixtures: fixtures.map(({ id, markdown }) => ({ id, markdown })),
  });

  const stdout = execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", "crates/render/Cargo.toml", "--bin", "render-fixtures"],
    { cwd: repoRoot, input: payload, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout);
  if (!parsed || typeof parsed.results !== "object" || parsed.results === null) {
    throw new Error("Rust 渲染器输出缺少 results 字段");
  }
  if (typeof parsed.documents !== "object" || parsed.documents === null) {
    throw new Error("Rust 渲染器输出缺少 documents 字段");
  }
  return { results: parsed.results, documents: parsed.documents };
}

test("差分语料自身合法（无重复 id、mode/guards 齐备）", () => {
  const { failures } = validateCorpus(RENDER_FIXTURES);
  assert.deepEqual(failures, [], `语料校验失败：\n${failures.join("\n")}`);
});

test("JS 参照侧能渲染全部语料（差分测试的前置条件）", async () => {
  const failures = [];
  for (const fixture of RENDER_FIXTURES) {
    try {
      const html = await renderWithJs(fixture.markdown);
      if (typeof html !== "string") failures.push(`${fixture.id}: 返回值不是字符串`);
    } catch (error) {
      failures.push(`${fixture.id}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], `JS 参照侧渲染失败：\n${failures.join("\n")}`);
});

test("Rust 与 JS 渲染结果符合约定的等价级别", async (t) => {
  const rustCrateExists = existsSync(rustCargoToml);

  if (!rustCrateExists) {
    // 阶段 0 状态：Rust 渲染核心尚未建立。显式报告而不是静默跳过。
    t.diagnostic(
      "阶段 0：crates/render 尚未建立，差分测试只校验 JS 参照侧。" +
        `待对齐语料 ${RENDER_FIXTURES.length} 条（byte ${groupFixturesByMode().byte.length} / ` +
        `semantic ${groupFixturesByMode().semantic.length}）。`,
    );
    return;
  }

  if (!hasCargo()) {
    // crate 存在但环境没有 Rust：这是**配置问题**而不是「还没开始」，
    // 因此用断言失败而不是静默跳过，避免守门设施被无声绕过。
    assert.fail(
      "crates/render 已存在，但当前环境找不到 cargo。" +
        "差分测试是双实现一致性的守门设施，必须在装有 Rust 工具链的环境中运行" +
        "（参见 .github/workflows 的 test-rust job）。",
    );
  }

  const expected = {};
  for (const fixture of RENDER_FIXTURES) {
    expected[fixture.id] = await renderWithJs(fixture.markdown);
  }

  const actual = renderWithRust(RENDER_FIXTURES);

  const failures = [];
  for (const fixture of RENDER_FIXTURES) {
    if (!(fixture.id in actual.results)) {
      failures.push(`${fixture.id}: Rust 侧未返回结果`);
      continue;
    }
    const result = compareRenderedHtml(
      expected[fixture.id],
      actual.results[fixture.id],
      fixture.mode,
    );
    if (!result.ok) {
      failures.push(`${fixture.id}（${fixture.mode}，守护 ${fixture.guards}）\n${result.message}`);
    }
  }

  assert.deepEqual(failures, [], `差分失败 ${failures.length} 条：\n\n${failures.join("\n\n")}`);
});

test("standalone 文档骨架与 JS 侧一致", async (t) => {
  if (!existsSync(rustCargoToml)) {
    t.diagnostic("阶段 0：crates/render 尚未建立，跳过 standalone 文档对比。");
    return;
  }

  if (!hasCargo()) {
    assert.fail(
      "crates/render 已存在，但当前环境找不到 cargo，无法对比 standalone 文档。" +
        "请在装有 Rust 工具链的环境中运行（参见 .github/workflows 的 test-rust job）。",
    );
  }

  const actual = renderWithRust(RENDER_FIXTURES);

  const failures = [];
  for (const fixture of RENDER_FIXTURES) {
    const expected = await renderDocumentWithJs(fixture.markdown);
    const received = actual.documents[fixture.id];
    if (typeof received !== "string") {
      failures.push(`${fixture.id}: Rust 侧未返回 standalone 文档`);
      continue;
    }
    // standalone 文档按 byte 比较：骨架、内联 CSS、锚点脚本全部由我们控制。
    const result = compareRenderedHtml(expected, received, "byte");
    if (!result.ok) {
      failures.push(`${fixture.id}\n${result.message}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `standalone 文档差分失败 ${failures.length} 条：\n\n${failures.join("\n\n")}`,
  );
});
