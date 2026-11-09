#!/usr/bin/env node
/**
 * 风格学习验收评测：为未参与学习的文章生成“有画像 / 无画像”两版续写，输出盲评表。
 *
 * 用法：
 *   node scripts/style-eval/run.mjs --articles <dir> --profile <prefix.txt> \
 *     --endpoint http://127.0.0.1:8080/v1 --model md-editor-writer-standard [--seed 42] [--out out/]
 *
 * - `--articles`：留出文章目录（*.md），每篇取前 60% 作为续写上下文；
 * - `--profile`：设置页“写作偏好”渲染出的前缀文本；
 * - `--endpoint`：OpenAI 兼容端点（本地 llama-server 或 Ollama），不会把文章发往其他地址；
 * - 输出 `blind-sheet.md`（给评测人）、`answers.json`（不要给评测人看）、`checks.json`（结构检查）、
 *   `choices.json`（评测人填写模板）与 `REPORT.md`（自动检查汇总 + 人工盲评说明）。
 * - 人工协议：评测人按 `blind-sheet.md` 为每篇填 A/B/same，再运行
 *   `node scripts/style-eval/run.mjs --out <out> --score <out>/choices.json` 得到有画像版本的胜率。
 *
 * 评测人在盲评表中为每篇填写 A / B / same，再用 `--score choices.json` 计算有画像版本的胜率。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  buildBlindSheet,
  checkContinuationStructure,
  scoreBlindChoices,
  writeEvaluationArtifacts,
} from "./lib.mjs";

const SYSTEM =
  "你是 Markdown 续写引擎。紧接光标前文，直接输出接下来最合理的一到两段正文，不要解释。";

const { values } = parseArgs({
  options: {
    articles: { type: "string" },
    profile: { type: "string" },
    endpoint: { type: "string", default: "http://127.0.0.1:8080/v1" },
    model: { type: "string", default: "md-editor-writer-standard" },
    seed: { type: "string", default: "42" },
    out: { type: "string", default: "style-eval-out" },
    score: { type: "string" },
  },
});

if (values.score) {
  const answers = JSON.parse(readFileSync(join(values.out, "answers.json"), "utf8"));
  const choices = JSON.parse(readFileSync(values.score, "utf8"));
  console.log(JSON.stringify(scoreBlindChoices(answers, choices), null, 2));
  process.exit(0);
}

if (!values.articles || !values.profile) {
  console.error("需要 --articles 与 --profile，见文件头部用法说明。");
  process.exit(1);
}

async function complete(prefix, context) {
  const response = await fetch(`${values.endpoint.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: values.model,
      temperature: 0.3,
      max_tokens: 200,
      messages: [
        { role: "system", content: [SYSTEM, prefix].filter(Boolean).join("\n\n") },
        { role: "user", content: `【光标前文】\n${context}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`续写请求失败：${response.status}`);
  const body = await response.json();
  return String(body.choices?.[0]?.message?.content ?? "").trim();
}

const prefix = readFileSync(values.profile, "utf8").trim();
const files = readdirSync(values.articles)
  .filter((name) => name.endsWith(".md"))
  .toSorted();
const pairs = [];
const checks = [];
for (const name of files) {
  const markdown = readFileSync(join(values.articles, name), "utf8");
  const context = markdown.slice(0, Math.floor(markdown.length * 0.6));
  const withProfile = await complete(prefix, context);
  const withoutProfile = await complete("", context);
  pairs.push({ id: name, prompt: context.slice(-300), withProfile, withoutProfile });
  checks.push({
    id: name,
    withProfile: checkContinuationStructure(context, `${context}${withProfile}`),
    withoutProfile: checkContinuationStructure(context, `${context}${withoutProfile}`),
  });
  console.log(`已生成 ${name}`);
}

const { sheet, answers } = buildBlindSheet(pairs, Number(values.seed));
writeEvaluationArtifacts(
  {
    dir: values.out,
    sheet,
    answers,
    checks,
    meta: { generatedAt: new Date().toISOString(), endpoint: values.endpoint, model: values.model },
  },
  { mkdirSync, writeFileSync },
);
console.log(`盲评表：${values.out}/blind-sheet.md（共 ${sheet.length} 篇）`);
