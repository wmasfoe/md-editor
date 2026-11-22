/**
 * @file removed-api-scan.mjs
 * @description 已删 API 的文档扫描门禁。
 *
 * 背景：同一个缺陷类连续两轮逃过评审 —— `renderer.use`、`renderer.setPlugins`、
 * `@md-editor/plugin-sdk/mdx` 都曾在删除后仍被文档/README 教给用户。此前只有 R-4
 * 一条 grep 且只扫 README，docs 目录与公开包的 src 注释都是盲区。
 *
 * 这里改成"**单一登记表 + 全量扫描**"：
 * - 每删一个对外标识符，就往 REMOVED_API 里加一条（名字 + 替代写法 + 允许出现的上下文）；
 * - 扫描 README、docs 目录、公开包的 src 注释，命中即失败；
 * - 历史归档目录（`docs/agent/status`、带"历史方案"标记的文档）通过 `allow` 显式豁免，
 *   豁免必须写明理由，不允许静默跳过。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 已删除的对外 API 登记表。
 *
 * `pattern` 用字符串而非正则，避免转义歧义；`allow` 是相对仓库根的路径前缀。
 */
export const REMOVED_API = [
  {
    id: "renderer.use",
    pattern: "renderer.use(",
    replacement: "syntax plugins 数组 / ports.setSyntaxPlugins / ports.addSyntaxPlugin",
    allow: ["packages/editor/tests/", "apps/desktop/e2e/", ".omx/"],
  },
  {
    id: "renderer.setPlugins",
    pattern: "renderer.setPlugins(",
    replacement:
      "ports.setSyntaxPlugins(plugins)（声明式）或 ports.addSyntaxPlugin(plugin)（命令式）",
    allow: ["packages/editor/tests/", ".omx/"],
  },
  {
    id: "plugin-sdk/mdx",
    pattern: "@md-editor/plugin-sdk/mdx",
    replacement: "@md-editor/shared/mdx",
    allow: [".omx/", "docs/agent/architecture/github_external_plugins.md"],
  },
];

/**
 * 迁移备注豁免：这些词出现在命中点附近时，视为"说明它已改名"而不是"教用户使用"。
 *
 * 为什么要这个豁免：`docs/agent/architecture/github_external_plugins.md` 这类文档
 * 必须能写"公共 MDX 契约原位于 `@md-editor/plugin-sdk/mdx`，现迁至 shared"，
 * 否则迁移记录本身就成了违规。判据要求**同时**出现替代写法或迁移词，避免误放行。
 */
const MIGRATION_MARKERS = ["原位于", "原为", "原名", "已迁移", "已删除", "已改", "迁至", "历史"];

/** 命中点前后窗口内是否属于迁移备注。 */
function isMigrationNote(source, index, replacement) {
  const window = source.slice(Math.max(0, index - 160), index + 160);
  if (window.includes(replacement)) return true;
  return MIGRATION_MARKERS.some((marker) => window.includes(marker));
}

/** 需要扫描的文档与源码注释范围。 */
export function scanTargets() {
  const targets = ["README.md", "README_ZH.md"];
  const walk = (dir, out) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(md|ts|tsx)$/u.test(entry.name)) out.push(relative(REPO_ROOT, full));
    }
  };
  walk(join(REPO_ROOT, "docs/agent"), targets);
  for (const pkg of [
    "core",
    "editor",
    "plugin-sdk",
    "plugin-host",
    "markdown-fidelity",
    "shared",
  ]) {
    targets.push(`packages/${pkg}/README.md`);
    walk(join(REPO_ROOT, "packages", pkg, "src"), targets);
  }
  return targets;
}

/**
 * 扫描并返回违规项。
 * @returns `[{ file, id, replacement, line }]`
 */
export function findRemovedApiReferences() {
  const violations = [];
  for (const file of scanTargets()) {
    let source;
    try {
      source = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const entry of REMOVED_API) {
      if (entry.allow.some((prefix) => file.startsWith(prefix))) continue;
      let cursor = source.indexOf(entry.pattern);
      while (cursor !== -1) {
        if (!isMigrationNote(source, cursor, entry.replacement)) {
          const line = source.slice(0, cursor).split("\n").length;
          violations.push({ file, id: entry.id, replacement: entry.replacement, line });
          break;
        }
        cursor = source.indexOf(entry.pattern, cursor + entry.pattern.length);
      }
    }
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = findRemovedApiReferences();
  if (violations.length > 0) {
    console.error("文档/注释仍在引用已删除的 API：");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} → ${v.id}（应改为 ${v.replacement}）`);
    }
    process.exit(1);
  }
  console.log("未发现已删 API 的残留引用");
}
