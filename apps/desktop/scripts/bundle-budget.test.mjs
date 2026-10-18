import assert from "node:assert/strict";
import test from "node:test";
import { BUDGETED_METRICS, buildBaseline, evaluateBundleBudget } from "./bundle-budget.mjs";

const baseline = { bootJavaScriptGzipBytes: 1000, totalJavaScriptGzipBytes: 4000, chunkCount: 80 };

test("在 headroom 内通过，并报告 limit 与 baseline", () => {
  const result = evaluateBundleBudget(
    { bootJavaScriptGzipBytes: 1030, totalJavaScriptGzipBytes: 4120 },
    baseline,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checks.length, BUDGETED_METRICS.length);
  assert.equal(result.checks[0].limit, 1030);
  assert.equal(result.checks[0].baseline, 1000);
});

test("恰好等于 limit 视为通过（边界包含）", () => {
  const result = evaluateBundleBudget(
    { bootJavaScriptGzipBytes: 1030, totalJavaScriptGzipBytes: 4000 },
    baseline,
  );
  assert.equal(result.ok, true);
});

test("超出 headroom 即失败，并逐项列出 violation", () => {
  const result = evaluateBundleBudget(
    { bootJavaScriptGzipBytes: 1031, totalJavaScriptGzipBytes: 5000 },
    baseline,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((v) => v.metric),
    ["bootJavaScriptGzipBytes", "totalJavaScriptGzipBytes"],
  );
  assert.equal(result.violations[0].actual, 1031);
  assert.equal(result.violations[0].limit, 1030);
});

test("支持自定义 headroom", () => {
  const result = evaluateBundleBudget(
    { bootJavaScriptGzipBytes: 1100, totalJavaScriptGzipBytes: 4000 },
    baseline,
    { headroomRatio: 0.1 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks[0].limit, 1100);
});

test("基线缺指标时显式报错，而不是静默放行", () => {
  assert.throws(
    () => evaluateBundleBudget({ bootJavaScriptGzipBytes: 1, totalJavaScriptGzipBytes: 1 }, {}),
    /bundle budget baseline 缺少数值指标/u,
  );
});

test("buildBaseline 只写入受预算约束的指标与信息字段", () => {
  const next = buildBaseline(
    {
      bootJavaScriptGzipBytes: 123,
      totalJavaScriptGzipBytes: 456,
      chunkCount: 7,
      excludedModuleCount: 0,
    },
    { note: "custom note" },
  );
  assert.deepEqual(next, {
    bootJavaScriptGzipBytes: 123,
    totalJavaScriptGzipBytes: 456,
    chunkCount: 7,
    note: "custom note",
  });
});
