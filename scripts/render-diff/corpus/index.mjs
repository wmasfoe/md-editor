/**
 * @file index.mjs
 * @description 差分测试语料汇总入口。
 *
 * 设计原则：
 * 1. **不存 golden 快照文件**。参照物是「当前的 JS 实现」本身——差分测试实时双跑
 *    JS 与 Rust 两个渲染器并对比。这样不会出现快照过期，也不会被 prettier 改写
 *    `.md` / `.html` 文件而破坏字节级比较。
 * 2. 每条 fixture 显式声明 `mode`：
 *    - `byte`：必须逐字节一致（输出完全由我们控制的部分）
 *    - `semantic`：规范化 DOM 等价（CJK 强调边界——comrak 与 marked-cjk-friendly
 *      是两套独立实现，不 fork comrak 就无法保证字节一致）
 * 3. 每条 fixture 用 `guards` 说明它守护 `packages/compiler/tests/` 里的哪条契约，
 *    便于契约回归时定位。
 */

import { INLINE_AND_CJK_FIXTURES } from "./inline-and-cjk.mjs";
import { BLOCKS_FIXTURES } from "./blocks.mjs";
import { PLUGINS_FIXTURES } from "./plugins.mjs";
import {
  AUDIT_ROUND2_FIXTURES,
  EDGE_FIXTURES,
  PARITY_GAP_FIXTURES,
  REAL_WORLD_FIXTURES,
} from "./edge.mjs";

/** 全部差分语料。 */
export const RENDER_FIXTURES = [
  ...INLINE_AND_CJK_FIXTURES,
  ...BLOCKS_FIXTURES,
  ...PLUGINS_FIXTURES,
  ...EDGE_FIXTURES,
  ...PARITY_GAP_FIXTURES,
  ...REAL_WORLD_FIXTURES,
  ...AUDIT_ROUND2_FIXTURES,
];

/** 按 id 建索引，便于报错时反查守卫的契约。 */
export const FIXTURES_BY_ID = new Map(RENDER_FIXTURES.map((fixture) => [fixture.id, fixture]));

/**
 * 校验语料自身的形状一致性。
 *
 * 语料是手写的，重复 id 或缺失字段会让差分测试静默漏测，因此在测试启动时先断言。
 *
 * @param {readonly { id: string, mode: string, guards: string, markdown: string }[]} fixtures
 * @returns {{ failures: string[] }}
 */
export function validateCorpus(fixtures) {
  const failures = [];
  const seen = new Set();

  for (const [index, fixture] of fixtures.entries()) {
    const where = `fixtures[${index}]`;
    if (typeof fixture?.id !== "string" || fixture.id.length === 0) {
      failures.push(`${where}: 缺少 id`);
      continue;
    }
    if (seen.has(fixture.id)) {
      failures.push(`${where}: id 重复 —— ${fixture.id}`);
    }
    seen.add(fixture.id);

    if (fixture.mode !== "byte" && fixture.mode !== "semantic") {
      failures.push(`${fixture.id}: mode 必须是 byte 或 semantic，实际 ${String(fixture.mode)}`);
    }
    if (typeof fixture.guards !== "string" || fixture.guards.length === 0) {
      failures.push(`${fixture.id}: 缺少 guards（必须说明守护哪条契约）`);
    }
    if (typeof fixture.markdown !== "string") {
      failures.push(`${fixture.id}: markdown 必须是字符串`);
    }
  }

  return { failures };
}

/** 按 mode 划分，供差分测试分别断言。 */
export function groupFixturesByMode(fixtures = RENDER_FIXTURES) {
  return {
    byte: fixtures.filter((fixture) => fixture.mode === "byte"),
    semantic: fixtures.filter((fixture) => fixture.mode === "semantic"),
  };
}
