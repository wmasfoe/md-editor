/**
 * @file run.mjs
 * @description 8 路 lane 固定语料的汇总 runner：一次性跑完 1.7 万例并给出准确分歧数。
 *
 * 为什么需要它：`corpus/` 是「手写且逐条声明契约」的精英语料，`fuzz.mjs` 是
 * 「组合式抽样」，`real-docs-parity.mjs` 是「真实文档」。三者都覆盖不到按维度
 * 穷举出来的交界形态——8 路并行探针在 17281 例里发现过 1910 例未登记分歧，
 * 而那批脚本原本只存在于 /tmp。本目录把语料固化下来，本文件负责把它们跑成
 * 一个可复现的数字，避免「一次性的发现随临时文件消失而作废」。
 *
 * 分工：
 * - `<lane>.mjs`：只负责生成 markdown 字符串（`buildCases()`），不含比较逻辑；
 * - `run.mjs`：汇总去重 → Rust 批量渲染（单进程）→ TS 逐例渲染 → 逐字节比较
 *   → 按 `KNOWN_DIVERGENCES.md` 过滤已登记分歧 → 分组报告。
 *
 * 用法：
 *   node --experimental-strip-types scripts/render-diff/lanes/run.mjs
 *   node --experimental-strip-types scripts/render-diff/lanes/run.mjs --lane headings
 *   node --experimental-strip-types scripts/render-diff/lanes/run.mjs --json /tmp/lanes.json
 *
 * 退出码：存在未登记分歧时为 1。
 *
 * 注意：全量 1.7 万例主要耗时在 TS 侧逐例渲染（约 1.5 分钟），因此**不**并入
 * `pnpm test:render-diff`，而是独立的 `pnpm test:render-lanes`。
 *
 * 另：语料含大量 CJK 公式，TS 侧的 KaTeX 会向 stderr 打 strict-mode 警告（属预期噪声），
 * 需要干净输出时用 `2>/dev/null`。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { firstDifference } from "../lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(repoRoot);

const { renderStaticHtml } = await import("../../../packages/compiler/src/index.ts");

/** lane 名称 → 语料模块（顺序即报告中 lane 的顺序）。 */
const LANE_NAMES = [
  "alert",
  "links",
  "lists",
  "code",
  "tables",
  "headings",
  "plugins",
  "inline-text",
];

/**
 * 已登记分歧（见 `scripts/render-diff/KNOWN_DIVERGENCES.md`）。
 *
 * 判定逻辑与 `fuzz.mjs` 一致，另外补上 KD-2（行内代码含 `$$`）：fuzz 的套件
 * 刻意不生成该形态，而这批评测语料会大量生成，若不过滤就会被误计为未登记。
 */
const KNOWN_DIVERGENCES = [
  {
    id: "KD-4",
    // 四冒号嵌套指令：TS 的正则回溯把首尾多余冒号当作文本，Rust 整体保留字面量。
    test: (markdown) => /^:{4,}/m.test(markdown),
  },
  {
    id: "KD-1/KD-3",
    // 两个 `$$` 块相邻或被内容隔开：TS 的跨块匹配会吞掉中间内容或产出 katex-error。
    test: (markdown, tsHtml, rustHtml) =>
      (tsHtml.match(/math-display|katex-display/g) ?? []).length !==
        (rustHtml.match(/math-display|katex-display/g) ?? []).length ||
      (tsHtml.includes("katex-error") && !rustHtml.includes("katex-error")),
  },
  {
    id: "KD-2",
    // 行内代码里含连续美元符：TS 会插入一个空格篡改内容，Rust 原样输出。
    test: (markdown) => /`[^`\n]*\$\$[^`\n]*`/.test(markdown),
  },
];

/** 命令行参数。 */
function parseArgs(argv) {
  const options = { lanes: [], json: null, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lane") {
      const value = argv[i + 1] ?? "";
      i += 1;
      options.lanes.push(
        ...value
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--lane=")) {
      options.lanes.push(
        ...arg
          .slice("--lane=".length)
          .split(",")
          .map((s) => s.trim()),
      );
    } else if (arg === "--json") {
      options.json = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--json=")) {
      options.json = arg.slice("--json=".length);
    } else if (arg === "--limit") {
      options.limit = Number(argv[i + 1] ?? 0);
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "用法: node --experimental-strip-types scripts/render-diff/lanes/run.mjs [选项]",
          "",
          "  --lane <name>   只跑指定 lane，可重复或用逗号分隔（默认全部）",
          "  --json <path>   把完整未截断结果写入文件",
          "  --limit <n>     每个 lane 最多打印 n 条未登记分歧（0 = 不限，默认）",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

const selected = options.lanes.length === 0 ? LANE_NAMES : options.lanes;
for (const name of selected) {
  if (!LANE_NAMES.includes(name)) {
    console.error(`未知 lane：${name}（可选：${LANE_NAMES.join(", ")}）`);
    process.exit(2);
  }
}

/**
 * 用 Rust 渲染器批量渲染（单进程一次调用，避免逐例启动开销）。
 *
 * 说明：`scripts/render-diff/lib.mjs` 只提供纯函数的投影/比较逻辑，cargo 批量
 * 适配器在 `fuzz.mjs` 与 `real-docs-parity.mjs` 里各写了一份（未抽公共模块），
 * 这里保持一致的最小实现，而不是去改动既有文件。
 *
 * @param {string[]} markdowns
 * @returns {string[]}
 */
function renderWithRust(markdowns) {
  const fixtures = markdowns.map((markdown, index) => ({ id: `f${index}`, markdown }));
  const stdout = execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", "crates/render/Cargo.toml", "--bin", "render-fixtures"],
    {
      cwd: repoRoot,
      input: JSON.stringify({ fixtures }),
      encoding: "utf8",
      // cargo 的构建/警告输出统一由本进程接管（失败时 execFileSync 仍会带出 stderr），
      // 保证 stdout 上只有结果 JSON。
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout);
  return markdowns.map((_, index) => parsed.results[`f${index}`]);
}

/** 按首次出现顺序汇总去重，并记录每条用例归属的 lane。 */
async function collectCases(laneNames) {
  const laneOf = new Map();
  const ordered = [];
  const rawCounts = new Map();

  for (const lane of laneNames) {
    const module = await loadLane(lane);
    const markdowns = module.buildCases();
    rawCounts.set(lane, markdowns.length);
    for (const markdown of markdowns) {
      if (laneOf.has(markdown)) continue;
      laneOf.set(markdown, lane);
      ordered.push(markdown);
    }
  }
  return { ordered, laneOf, rawCounts };
}

/** 动态加载 lane 语料模块。 */
async function loadLane(lane) {
  return import(`./${lane}.mjs`);
}

const { ordered, laneOf, rawCounts } = await collectCases(selected);

console.log(`lane: ${selected.join(", ")}`);
console.log(`用例生成：${[...rawCounts.entries()].map(([lane, n]) => `${lane}=${n}`).join("  ")}`);
console.log(`去重后合计：${ordered.length} 例\n`);

console.log("Rust 侧批量渲染中（单进程）…");
const rustHtml = renderWithRust(ordered);

/** 逐 lane 统计。 */
const stats = new Map();
for (const lane of selected) stats.set(lane, { total: 0, same: 0, known: [], unknown: [] });

for (const [index, markdown] of ordered.entries()) {
  const page = stats.get(laneOf.get(markdown));
  page.total += 1;

  const ts = renderStaticHtml(markdown).html;
  const rust = rustHtml[index];
  if (ts === rust) {
    page.same += 1;
    continue;
  }

  const registered = KNOWN_DIVERGENCES.find((entry) => entry.test(markdown, ts, rust));
  const diff = firstDifference(ts, rust);
  const record = { markdown, ts, rust, firstDiffIndex: diff.index };
  if (registered) page.known.push({ ...record, known: registered.id });
  else page.unknown.push(record);
}

// ─────────────────────────────────────────────── 分组报告
console.log("lane        例数   一致  未登记  已登记");
console.log("---------------------------------------------");
let totalUnknown = 0;
let totalKnown = 0;
let totalCases = 0;
for (const lane of selected) {
  const page = stats.get(lane);
  totalUnknown += page.unknown.length;
  totalKnown += page.known.length;
  totalCases += page.total;
  const mark = page.unknown.length === 0 ? "✅" : "❌";
  console.log(
    `${mark} ${lane.padEnd(11)} ${String(page.total).padStart(5)} ` +
      `${String(page.same).padStart(6)} ${String(page.unknown.length).padStart(7)} ` +
      `${String(page.known.length).padStart(7)}`,
  );
}
console.log("---------------------------------------------");
console.log(
  `合计         ${String(totalCases).padStart(5)} ` +
    `${String(totalCases - totalUnknown - totalKnown).padStart(6)} ` +
    `${String(totalUnknown).padStart(7)} ${String(totalKnown).padStart(7)}`,
);

/** 把一段 HTML 截断成便于阅读的窗口（以首处差异为中心）。 */
function window(html, firstIndex, width = 240) {
  const from = Math.max(0, firstIndex - 60);
  const slice = html.slice(from, from + width);
  const prefix = from > 0 ? "…" : "";
  const suffix = from + width < html.length ? "…" : "";
  return `${prefix}${JSON.stringify(slice).slice(1, -1)}${suffix}`;
}

/** 打印某个 lane 的未登记分歧（md / TS / Rust 三段式）。 */
function printUnknown(lane, list) {
  if (list.length === 0) return;
  const limit = options.limit > 0 ? Math.min(options.limit, list.length) : list.length;
  console.log(`\n=== ${lane}：未登记分歧 ${list.length} 例（打印 ${limit} 例）===`);
  for (const item of list.slice(0, limit)) {
    console.log(`\n输入: ${JSON.stringify(item.markdown.slice(0, 300))}`);
    console.log(`  TS  : ${window(item.ts, item.firstDiffIndex)}`);
    console.log(`  RUST: ${window(item.rust, item.firstDiffIndex)}`);
  }
  if (limit < list.length) console.log(`\n…还有 ${list.length - limit} 例，用 --json 查看全量`);
}

for (const lane of selected) printUnknown(lane, stats.get(lane).unknown);

// ─────────────────────────────────────────────── 已登记摘要
if (totalKnown > 0) {
  console.log(`\n=== 已登记分歧（不计入失败）${totalKnown} 例 ===`);
  const byId = new Map();
  for (const lane of selected) {
    for (const item of stats.get(lane).known) {
      const key = `${lane} ${item.known}`;
      byId.set(key, (byId.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of [...byId.entries()].toSorted()) console.log(`  ${key}: ${count}`);
}

// ─────────────────────────────────────────────── 机器可读输出
if (options.json) {
  const payload = {
    totalCases,
    totalUnknown,
    totalKnown,
    lanes: selected.map((lane) => {
      const page = stats.get(lane);
      return {
        lane,
        generated: rawCounts.get(lane) ?? 0,
        cases: page.total,
        same: page.same,
        unknown: page.unknown,
        known: page.known,
      };
    }),
  };
  const target = path.resolve(options.json);
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\n完整结果已写入 ${target}`);
}

console.log(`\n未登记分歧合计 ${totalUnknown} / ${totalCases}（已登记 ${totalKnown}）`);
process.exit(totalUnknown === 0 ? 0 : 1);
