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
if (diffs.length === 0) {
  console.log("✅ 仓库全部 markdown 文档字节级一致");
  process.exit(0);
}

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
