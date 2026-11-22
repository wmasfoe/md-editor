import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_PACKAGES,
  README_TARGETS,
  REPO_ROOT,
  checkReadmeExamples,
  extractCheckedBlocks,
  findStaleSubpathReferences,
} from "./readme-examples.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("每个公开包的 README 至少有一个被标记的可编译示例", () => {
  const missing = PUBLIC_PACKAGES.filter((pkg) => {
    const readme = join(REPO_ROOT, "packages", pkg, "README.md");
    return extractCheckedBlocks(readme).length === 0;
  });
  assert.deepEqual(
    missing,
    [],
    `以下包的 README 没有 \`<!-- readme-check -->\` 标记的标准示例：\n${missing.join("\n")}\n` +
      `文档是公开契约的一部分，至少要有一段能被编译验证的用法。`,
  );
});

test("被标记的示例全部通过 typecheck", () => {
  assert.equal(checkReadmeExamples(), "");
});

test("文档里不再出现已删除的 renderer.use( 字面（R-4）", () => {
  const offenders = [];
  for (const relative of README_TARGETS) {
    const readme = join(REPO_ROOT, relative);
    if (readFileSync(readme, "utf8").includes("renderer.use(")) offenders.push(relative);
  }
  assert.deepEqual(offenders, [], `以下 README 仍在教已删除的 API：\n${offenders.join("\n")}`);
});

test("R-2：README 引用的子入口都存在于对应包的 exports（含根 README）", () => {
  const offenders = findStaleSubpathReferences();
  assert.deepEqual(offenders, [], `文档指向了不存在的子入口：\n${offenders.join("\n")}`);
});
