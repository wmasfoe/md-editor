/**
 * @file bundle-budget.mjs
 * @description 桌面端生产 bundle 的包体预算判定（纯逻辑，便于单测）。
 *
 * 为什么需要：`code-language-bundle-probe.mjs` 过去只检查「是否引入了未登记的语法解析器」
 * （excludedModules），对 boot/总包体没有任何上限 —— 首屏体积回退不会被发现。
 *
 * 指标口径（确定性、与机器性能无关，因此可用绝对阈值）：
 * - `bootJavaScriptGzipBytes`：入口静态依赖图（含 entry 与 App facade）内所有 chunk 的 gzip 之和；
 * - `totalJavaScriptGzipBytes`：全部 JS chunk 的 gzip 之和（含懒加载）。
 *
 * 阈值 = 基线 × (1 + headroomRatio)。基线存放在 `bundle-budget.baseline.json`，
 * 有意增删功能后需用 `pnpm test:bundle:update` 显式刷新（让体积变化成为一次可见 diff）。
 */

export const DEFAULT_HEADROOM_RATIO = 0.03;

/** 参与预算判定的指标（chunkCount 仅作信息展示：代码分割策略变化会合法地改变它）。 */
export const BUDGETED_METRICS = ["bootJavaScriptGzipBytes", "totalJavaScriptGzipBytes"];

/**
 * 评估报告是否满足预算。
 * @param {{ bootJavaScriptGzipBytes: number, totalJavaScriptGzipBytes: number }} report
 * @param {{ bootJavaScriptGzipBytes: number, totalJavaScriptGzipBytes: number }} baseline
 * @param {{ headroomRatio?: number }} [options]
 */
export function evaluateBundleBudget(report, baseline, options = {}) {
  const headroomRatio = options.headroomRatio ?? DEFAULT_HEADROOM_RATIO;
  const checks = BUDGETED_METRICS.map((metric) => {
    const actual = report[metric];
    const base = baseline[metric];
    if (typeof base !== "number" || Number.isNaN(base)) {
      throw new Error(`bundle budget baseline 缺少数值指标：${metric}`);
    }
    const limit = Math.round(base * (1 + headroomRatio));
    return { metric, baseline: base, limit, actual, ok: actual <= limit };
  });

  return {
    headroomRatio,
    checks,
    violations: checks.filter((check) => !check.ok),
    get ok() {
      return this.violations.length === 0;
    },
  };
}

/** 从报告生成新的基线内容（保留既有 note）。 */
export function buildBaseline(report, previousBaseline = {}) {
  const baseline = {};
  for (const metric of BUDGETED_METRICS) {
    baseline[metric] = report[metric];
  }
  baseline.chunkCount = report.chunkCount;
  baseline.note =
    previousBaseline.note ??
    "由 pnpm test:bundle:update 生成：桌面端生产 bundle 的 boot/总 gzip 基线（阈值 = 基线 × 1.03）。";
  return baseline;
}
