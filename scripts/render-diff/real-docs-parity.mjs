/**
 * 用仓库自己的全部 markdown 文档跑渲染差分。
 *
 * 为什么需要：人工构造的 fixture 语料永远覆盖不到真实文档的写法。
 * 实测该脚本在初次迁移后立刻发现了 10 类分叉（标题裸 `<`、fence info 属性、
 * HTML 实体、松散任务列表、未知标签 HTML 块、BOM、引用定义、`$$` 行内、
 * 行内代码 `:::`、npm 版本号自动链接），这些都不在原始语料里。
 *
 * 用法：`node --experimental-strip-types scripts/render-diff/real-docs-parity.mjs`
 * 退出码非 0 表示存在分叉。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repoRoot);
const { renderStaticHtml } = await import("../../packages/compiler/src/index.ts");

// 收集仓库真实 markdown 文档
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
const docs = [
  ...walk("docs"),
  ...walk("packages"),
  ...walk("apps"),
  "README.md",
  "AGENTS.md",
].filter((f) => fs.existsSync(f));

console.log(`扫描 ${docs.length} 个 markdown 文件`);

const fixtures = docs.map((f, i) => ({ id: `d${i}`, markdown: fs.readFileSync(f, "utf8") }));
const out = execFileSync(
  "cargo",
  ["run", "--quiet", "--manifest-path", "crates/render/Cargo.toml", "--bin", "render-fixtures"],
  {
    input: JSON.stringify({ fixtures }),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  },
);
const rust = JSON.parse(out).results;

let same = 0;
const diffs = [];
for (let i = 0; i < docs.length; i++) {
  const ts = renderStaticHtml(fixtures[i].markdown).html;
  if (ts === rust[`d${i}`]) same++;
  else diffs.push({ file: docs[i], ts, rust: rust[`d${i}`] });
}
console.log(`字节级一致: ${same}/${docs.length}`);
/**
 * 已登记的已知分歧（见 KNOWN_DIVERGENCES.md）。
 *
 * 每条给出「只在 TS 侧出现、Rust 侧更正确」的特征，用于把**已评估**的分歧
 * 从「未知失败」中区分出来。命中时不计入失败，但会单独列出，避免悄悄放过。
 */
/** 去掉全部空白，用于「只差空白」的差异判定。 */
function stripWhitespace(value) {
  return value.replace(/\s+/gu, "");
}

const KNOWN_DIVERGENCE_PATTERNS = [
  {
    id: "KD-2",
    // TS 在行内代码的连续美元符前插入空格（篡改内容）；Rust 原样输出。
    // 注意：仓库文档已刻意避免该写法，因此通常不会命中；保留登记是为了
    // 让未来新增文档触发时能被识别为「已知」而非「未知」。
    test: (tsText, rustText) => {
      if (stripWhitespace(tsText) !== stripWhitespace(rustText)) return false;
      return tsText.length === rustText.length + 1 && /\s\$\$/u.test(tsText);
    },
    note: "TS 在行内代码的连续美元符前插入空格（篡改内容），Rust 原样输出",
  },
];

const knownHits = [];
const unknownDiffs = [];
for (const diff of diffs) {
  const known = KNOWN_DIVERGENCE_PATTERNS.find((pattern) => pattern.test(diff.ts, diff.rust));
  if (known) {
    knownHits.push({ ...diff, known });
  } else {
    unknownDiffs.push(diff);
  }
}

if (knownHits.length > 0) {
  console.log(`\nℹ️  命中 ${knownHits.length} 处已登记分歧（不计入失败）：`);
  for (const hit of knownHits) {
    console.log(`   [${hit.known.id}] ${hit.file} — ${hit.known.note}`);
  }
}

if (unknownDiffs.length === 0) {
  console.log("\n✅ 无未登记分歧");
  process.exit(0);
}

diffs.length = 0;
diffs.push(...unknownDiffs);

console.log(`\n❌ 不一致 ${diffs.length} 个，前 5 个的首处差异：`);
{
  for (const d of diffs.slice(0, 5)) {
    let i = 0;
    while (i < Math.min(d.ts.length, d.rust.length) && d.ts[i] === d.rust[i]) i++;
    console.log(`\n  ${d.file} @ ${i}`);
    console.log(`    TS  : ${JSON.stringify(d.ts.slice(Math.max(0, i - 50), i + 70))}`);
    console.log(`    RUST: ${JSON.stringify(d.rust.slice(Math.max(0, i - 50), i + 70))}`);
  }
}
process.exit(1);
