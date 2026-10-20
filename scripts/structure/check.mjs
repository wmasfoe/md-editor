/**
 * @file check.mjs
 * @description 仓库结构与命名规范的可机械检查护栏（零第三方依赖）。
 *
 * 设计要点（详见 docs/agent/architecture/repo_structure_and_naming_conventions.md）：
 * 1. **规则分批上线（ruleset rollout）**：护栏只允许在"自身 PR 完成后为真"时才启用，
 *    否则护栏测的是历史欠债而非本次改动。用 `--phase pr1|pr2|pr3` 控制启用集合；
 *    PR1 启用阈值/豁免/冗余路径/跨包深导入/测试镜像，PR2 追加 wysiwyg 集合与 src 内测试禁令，
 *    PR3 追加巨型文件 ≤800 专项。
 * 2. **豁免清单（structure-exceptions.json）** 采用稳定 `id`：现行 `id` 必须是
 *    `scripts/structure/exceptions.baseline.json` 的子集，且同 id 的 `maxLines` 不得高于基线
 *    （搬迁 PR 允许 ≤ +5 行 headroom）。允许删除条目（PR3 拆分后必须能缩减清单）。
 * 3. 所有规则都必须能在当前 main 上自检为绿（基线自检铁律），命令与反例见 check.test.mjs。
 *
 * 用法：
 *   node scripts/structure/check.mjs [--phase pr1|pr2|pr3] [--root <dir>] [--json]
 * 退出码：0 = 通过（可能有 warning）；1 = 有 failure。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 阈值：>800 行警告；>1200 行失败（仅适用 `.ts/.tsx`，且不含测试文件与 CSS）。 */
export const WARN_LINES = 800;
export const FAIL_LINES = 1200;
/** 搬迁 PR 允许的 `maxLines` 缓冲（重连 import 可能导致 ±1 行漂移）。 */
/**
 * **cluster 级硬约束**：这些包内任何 `.ts/.tsx` 超过 `WARN_LINES` 即**失败**
 * （而非仅警告）——防止"把巨型文件拆成巨型协作者"，即 PR3 之后的回涨防线。
 */
export const CLUSTER_STRICT_PACKAGES = ["packages/renderer-codemirror"];
export const MOVE_HEADROOM = 5;
/** 测试辅助目录不入镜像检查（存量合法反例：packages/editor-core/tests/support）。 */
export const MIRROR_EXEMPT_DIRS = new Set(["support", "fixtures", "helpers", "__fixtures__"]);
/** `wysiwyg/` 顶层（PR2 起）必须精确等于该集合。 */
/** `renderer/` 簇成员登记（PR3 拆分后）：顶层文件 + `controller/` 协作者。 */
export const RENDERER_CLUSTER_MEMBERS = {
  ".": ["index.ts", "types.ts", "view-adapter.ts", "controller.ts", "controller"],
  controller: [
    "composition.ts",
    "document-protocol.ts",
    "host-visibility.ts",
    "mode-viewport.ts",
    "plugin-management.ts",
    "probe.ts",
    "root-extensions.ts",
    "selection.ts",
    "transaction-ledger.ts",
    "validation.ts",
    "view-operations.ts",
  ],
};

export const WYSIWYG_TOP_LEVEL = [
  "index.ts",
  "state",
  "blocks",
  "projections",
  "editing",
  "input",
  "view",
  "widgets",
];
/** PR3 起必须 ≤ 单一职责簇阈值的目标文件（路径 → 允许上限）。 */
export const SPLIT_TARGETS = {
  "packages/renderer-codemirror/src/renderer/index.ts": WARN_LINES,
  "packages/renderer-codemirror/src/renderer/controller.ts": WARN_LINES,
  "packages/renderer-codemirror/src/wysiwyg/state/projection-field.ts": WARN_LINES,
  "packages/renderer-codemirror/src/wysiwyg/widgets/table/table-widget.ts": WARN_LINES,
};

/** 各阶段启用的规则集合（分批上线，见文件头说明）。 */
export const PHASE_RULES = {
  pr1: [
    "thresholds",
    "exceptions",
    "redundantParentSegments",
    "crossPackageDeepImports",
    "testMirror",
  ],
  pr2: [
    "thresholds",
    "exceptions",
    "redundantParentSegments",
    "crossPackageDeepImports",
    "testMirror",
    "testsInsideSrc",
    "wysiwygTopLevel",
    "wysiwygDomains",
  ],
  pr3: [
    "thresholds",
    "exceptions",
    "redundantParentSegments",
    "crossPackageDeepImports",
    "testMirror",
    "testsInsideSrc",
    "wysiwygTopLevel",
    "wysiwygDomains",
    "splitTargets",
    "rendererCluster",
  ],
};

/** PR2 起 `wysiwyg/` 各域的成员集合（逐文件域归属，堵住"文件全塞一个域"仍绿）。 */
export const WYSIWYG_DOMAIN_MEMBERS = {
  state: [
    "types.ts",
    "projection-field.ts",
    "decorations.ts",
    "ranges.ts",
    "atoms.ts",
    "visible-marks.ts",
    "inline-marker-reveal.ts",
    "change-authorization.ts",
    "change-protection.ts",
  ],
  blocks: [
    "block-replacement.ts",
    "block-move.ts",
    "block-toolbar.ts",
    "atom-selection.ts",
    "default-atom.ts",
    "default-visualization.ts",
    "fold-toggle.ts",
  ],
  projections: [
    "frontmatter-projection.ts",
    "html-projection.ts",
    "mdx-projection.ts",
    "list-projection.ts",
    "table-projection.ts",
    "code-block-projection.ts",
    "link-projection.ts",
    "inline-heading.ts",
  ],
  editing: [
    "table-editing.ts",
    "code-block-commands.ts",
    "code-block-indent.ts",
    "code-block-line-numbers.ts",
    "code-block-selection.ts",
    "markdown-commands.ts",
    "markdown-formatting.ts",
    "paragraph-indent.ts",
    "task-toggle.ts",
    "head-level-control.ts",
  ],
  input: [
    "plain-text-input.ts",
    "smart-pairs.ts",
    "smart-paste.ts",
    "bracket-escape.ts",
    "bracket-escape-command.ts",
    "tab-arbiter.ts",
    "tab-arbiter-command.ts",
    "typewriter-mode.ts",
  ],
  view: [
    "focus-mode.ts",
    "search-panel.ts",
    "parse-progress.ts",
    "suggestion.ts",
    "image-resolver.ts",
    "link-interaction.ts",
  ],
  // widgets/ 同样纳入域成员登记（含 PR3 引入的 table/ 子目录）
  widgets: [
    "callout-widget.ts",
    "cell-caret.ts",
    "code-block-toolbar-widget.ts",
    "default-atom-widget.ts",
    "frontmatter-header-widget.ts",
    "html-block-widget.ts",
    "image-widget.ts",
    "mdx-component-widget.ts",
    "thematic-break-widget.ts",
    "table",
  ],
};

/** 扫描域：工作区中需要检查的源码根。 */
function workspaceDirs(root) {
  const dirs = [];
  for (const group of ["packages", "apps", "infra"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry);
      if (!statSync(dir).isDirectory() || entry.startsWith(".")) continue;
      dirs.push({ name: `${group}/${entry}`, dir });
      // 二级工作区（apps/mobile/*）
      if (group === "apps") {
        for (const nested of readdirSync(dir)) {
          const nestedDir = join(dir, nested);
          if (!statSync(nestedDir).isDirectory() || nested.startsWith(".")) continue;
          if (existsSync(join(nestedDir, "src")) || existsSync(join(nestedDir, "package.json"))) {
            dirs.push({ name: `${group}/${entry}/${nested}`, dir: nestedDir });
          }
        }
      }
    }
  }
  return dirs;
}

/** 递归收集文件（跳过 node_modules/dist/构建产物与隐藏目录）。 */
function walkFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "target" ||
      entry.startsWith(".")
    ) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

const isSourceFile = (file) => /\.(ts|tsx)$/u.test(file);
const isTestFile = (file) => /\.test\.(ts|tsx)$/u.test(file);

function lineCount(file) {
  const content = readFileSync(file, "utf8");
  if (content.length === 0) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/** 提取文件中的模块标识符（`from "x"`、`import("x")`、`export ... from "x"`）。 */
function moduleSpecifiers(file) {
  const content = readFileSync(file, "utf8");
  const specifiers = [];
  const patterns = [/from\s+["']([^"']+)["']/gu, /import\s*\(\s*["']([^"']+)["']\s*\)/gu];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * 规则：体量阈值（>800 warn / >1200 fail），适用 `<group>/<pkg>/src/**` 与 （同上，含 infra） 的
 * `.ts/.tsx`，**排除测试文件**（测试文件不纳入阈值域）。
 */
export function checkThresholds({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  const warnings = [];
  const excepted = new Map(
    readExceptions(root).map((entry) => [entry.path, entry.maxLines ?? FAIL_LINES]),
  );
  for (const { name, dir } of directories) {
    const srcDir = join(dir, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkFiles(srcDir, isSourceFile)) {
      if (isTestFile(file)) continue;
      const lines = lineCount(file);
      const rel = `${name}/${relative(dir, file).split(sep).join("/")}`;
      const cap = excepted.get(rel);
      if (cap !== undefined) {
        // 已登记豁免：冻结在其 maxLines 上限（可缩不可涨）
        if (lines > cap) failures.push(`${rel}: ${lines} 行 > 豁免上限 ${cap}（豁免只允许缩小）`);
        continue;
      }
      const clusterStrict = CLUSTER_STRICT_PACKAGES.some((prefix) => rel.startsWith(prefix));
      if (lines > FAIL_LINES) failures.push(`${rel}: ${lines} 行 > ${FAIL_LINES}（未登记豁免）`);
      else if (lines > WARN_LINES && clusterStrict) {
        failures.push(
          `${rel}: ${lines} 行 > ${WARN_LINES}（cluster 级硬约束：${CLUSTER_STRICT_PACKAGES.join(", ")} 内任何文件不得超过该上限）`,
        );
      } else if (lines > WARN_LINES) warnings.push(`${rel}: ${lines} 行 > ${WARN_LINES}`);
    }
  }
  return { failures, warnings };
}

/** 读取当前豁免清单（缺失时返回空数组，交由 exceptions 规则报错）。 */
function readExceptions(root) {
  const file = join(root, "structure-exceptions.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** 规则：豁免清单 schema + id 子集 + maxLines 不增长 + 文件存在。 */
export function checkExceptions({ root }) {
  const failures = [];
  const currentPath = join(root, "structure-exceptions.json");
  const baselinePath = join(root, "scripts/structure/exceptions.baseline.json");
  if (!existsSync(currentPath)) {
    return {
      failures: ['缺少 structure-exceptions.json（期望形如 [{"id","path","maxLines","reason"}]）'],
      warnings: [],
    };
  }
  const current = JSON.parse(readFileSync(currentPath, "utf8"));
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : [];
  const baselineById = new Map(baseline.map((entry) => [entry.id, entry]));
  const seen = new Set();

  for (const entry of current) {
    const where = `structure-exceptions.json#${entry.id ?? "<missing id>"}`;
    if (!entry.id || !entry.path || typeof entry.maxLines !== "number" || !entry.reason) {
      failures.push(`${where}: schema 不完整（需 id/path/maxLines/reason）`);
      continue;
    }
    if (seen.has(entry.id)) failures.push(`${where}: id 重复`);
    seen.add(entry.id);
    const base = baselineById.get(entry.id);
    if (!base) {
      failures.push(`${where}: 新增豁免 id 不在基线中（禁止新增豁免）`);
    } else if (entry.maxLines > base.maxLines + MOVE_HEADROOM) {
      failures.push(
        `${where}: maxLines ${entry.maxLines} 超过基线 ${base.maxLines} + ${MOVE_HEADROOM} headroom（禁止增长）`,
      );
    }
    if (!existsSync(join(root, entry.path))) {
      failures.push(`${where}: 豁免指向的文件不存在（${entry.path}），请删除该条目`);
    }
  }
  return { failures, warnings: [] };
}

/**
 * 判定模块路径是否含**冗余**回退段：形如 `a/b/../c` 中 `b/../` 可被直接消除。
 * 注意：前导的 `../../`（向上跳级）是合法的，不得误判。
 */
export function hasRedundantParentSegment(specifier) {
  const segments = specifier.split("/").filter((segment) => segment !== "" && segment !== ".");
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index] !== "..") continue;
    const previous = segments[index - 1];
    if (previous !== ".." && previous !== ".") return true;
  }
  return false;
}

/** 规则：禁止含冗余回退段的模块路径（如 `a/b/../c.ts`）。 */
export function checkRedundantParentSegments({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  for (const { name, dir } of directories) {
    for (const file of walkFiles(dir, isSourceFile)) {
      const rel = `${name}/${relative(dir, file).split(sep).join("/")}`;
      for (const specifier of moduleSpecifiers(file)) {
        if (hasRedundantParentSegment(specifier)) {
          failures.push(`${rel}: 模块路径含冗余回退段 → ${specifier}`);
        }
      }
    }
  }
  return { failures, warnings: [] };
}

/** 规则：禁止直插其他包源码（`@md-editor/<pkg>/src/**`）。 */
export function checkCrossPackageDeepImports({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  for (const { name, dir } of directories) {
    for (const file of walkFiles(dir, isSourceFile)) {
      const rel = `${name}/${relative(dir, file).split(sep).join("/")}`;
      for (const specifier of moduleSpecifiers(file)) {
        if (/^@md-editor\/[a-z0-9-]+\/src\//u.test(specifier)) {
          failures.push(`${rel}: 跨包深导入 → ${specifier}`);
        }
      }
    }
  }
  return { failures, warnings: [] };
}

/**
 * 规则：测试位置镜像。
 * 范围：`<pkg>/tests`（`src/` 的顶层兄弟目录）且该目录含 `*.test.ts*`（TS 测试树）。
 * 排除：`support/fixtures/helpers/__fixtures__`；非 TS 宿主目录（如 apps/mobile/ios/Tests）不在范围。
 */
export function checkTestMirror({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  for (const { name, dir } of directories) {
    const srcDir = join(dir, "src");
    const testsDir = join(dir, "tests");
    if (!existsSync(srcDir) || !existsSync(testsDir)) continue;
    const hasTsTests = walkFiles(testsDir, isTestFile).length > 0;
    if (!hasTsTests) continue;
    for (const entry of readdirSync(testsDir)) {
      const child = join(testsDir, entry);
      if (!statSync(child).isDirectory() || MIRROR_EXEMPT_DIRS.has(entry)) continue;
      if (!existsSync(join(srcDir, entry))) {
        failures.push(
          `${name}/tests/${entry}: 非辅助目录缺少对应 src/${entry}（顶层目录镜像破裂）`,
        );
      }
    }
  }
  return { failures, warnings: [] };
}

/** 规则（PR2+）：`src/**` 内不得存在测试文件，也不得残留 `tests/`、`__tests__/` 目录。 */
export function checkTestsInsideSrc({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  for (const { name, dir } of directories) {
    const srcDir = join(dir, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkFiles(srcDir, isTestFile)) {
      failures.push(
        `${name}/${relative(dir, file).split(sep).join("/")}: 测试文件必须位于 tests/（src/ 内不允许）`,
      );
    }
    for (const file of walkFiles(srcDir, () => false)) void file;
    for (const dirName of ["tests", "__tests__"]) {
      for (const found of findDirs(srcDir, dirName)) {
        failures.push(
          `${name}/${relative(dir, found).split(sep).join("/")}: src/ 内不得有 ${dirName}/ 目录`,
        );
      }
    }
  }
  return { failures, warnings: [] };
}

/** 递归查找指定名字的目录。 */
function findDirs(dir, name, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === name) out.push(full);
    else findDirs(full, name, out);
  }
  return out;
}

/** 规则（PR2+）：`wysiwyg/` 顶层集合精确相等。 */
export function checkWysiwygTopLevel({ root }) {
  const failures = [];
  const dir = join(root, "packages/renderer-codemirror/src/wysiwyg");
  if (!existsSync(dir)) return { failures: [`缺少目录 ${relative(root, dir)}`], warnings: [] };
  const actual = readdirSync(dir).filter((entry) => !entry.startsWith("."));
  const missing = WYSIWYG_TOP_LEVEL.filter((entry) => !actual.includes(entry));
  const extra = actual.filter((entry) => !WYSIWYG_TOP_LEVEL.includes(entry));
  if (missing.length > 0) failures.push(`wysiwyg/ 缺少必须存在的条目：${missing.join(", ")}`);
  if (extra.length > 0) failures.push(`wysiwyg/ 存在未归域的条目：${extra.join(", ")}`);
  return { failures, warnings: [] };
}

/** 规则（PR2+）：`wysiwyg/` 逐文件域归属（集合逐项相等）。 */
export function checkWysiwygDomains({ root }) {
  const failures = [];
  const base = join(root, "packages/renderer-codemirror/src/wysiwyg");
  if (!existsSync(base)) return { failures: [], warnings: [] };
  for (const [domain, expected] of Object.entries(WYSIWYG_DOMAIN_MEMBERS)) {
    const dir = join(base, domain);
    if (!existsSync(dir)) {
      failures.push(`wysiwyg/${domain}: 目录不存在（期望成员 ${expected.length} 个）`);
      continue;
    }
    const actual = readdirSync(dir).filter((entry) => !entry.startsWith("."));
    const missing = expected.filter((entry) => !actual.includes(entry));
    const extra = actual.filter((entry) => !expected.includes(entry));
    if (missing.length > 0) failures.push(`wysiwyg/${domain}: 缺少文件 ${missing.join(", ")}`);
    if (extra.length > 0) failures.push(`wysiwyg/${domain}: 多出未登记文件 ${extra.join(", ")}`);
  }
  return { failures, warnings: [] };
}

/**
 * 规则（PR3+）：`renderer/` 簇成员枚举——新增/重命名协作者必须同步登记，
 * 否则"多出未登记文件"即失败（补上 cluster 契约的第二维度：成员集合）。
 */
export function checkRendererCluster({ root }) {
  const failures = [];
  const base = join(root, "packages/renderer-codemirror/src/renderer");
  if (!existsSync(base)) return { failures: [], warnings: [] };
  for (const [scope, expected] of Object.entries(RENDERER_CLUSTER_MEMBERS)) {
    const dir = scope === "." ? base : join(base, scope);
    if (!existsSync(dir)) {
      failures.push(`renderer/${scope === "." ? "" : scope}: 目录不存在`);
      continue;
    }
    const actual = readdirSync(dir).filter((entry) => !entry.startsWith("."));
    for (const entry of actual) {
      if (!expected.includes(entry))
        failures.push(
          `renderer/${scope === "." ? "" : `${scope}/`}${entry}: 多出未登记的簇成员（新增协作者必须登记 RENDERER_CLUSTER_MEMBERS）`,
        );
    }
    for (const entry of expected) {
      if (!actual.includes(entry))
        failures.push(`renderer/${scope === "." ? "" : `${scope}/`}${entry}: 已登记但文件缺失`);
    }
  }
  return { failures, warnings: [] };
}

/** 规则（PR3+）：拆分目标文件达成 ≤ 单一职责簇阈值。 */
export function checkSplitTargets({ root }) {
  const failures = [];
  for (const [relPath, limit] of Object.entries(SPLIT_TARGETS)) {
    const file = join(root, relPath);
    if (!existsSync(file)) continue;
    const lines = lineCount(file);
    if (lines > limit) failures.push(`${relPath}: ${lines} 行 > 目标 ${limit}`);
  }
  return { failures, warnings: [] };
}

/** 运行指定阶段的所有规则。 */
export function runChecks({ root, phase = "pr1" }) {
  const rules = PHASE_RULES[phase];
  if (!rules) throw new Error(`未知阶段：${phase}（可选 ${Object.keys(PHASE_RULES).join("|")}）`);
  const registry = {
    thresholds: checkThresholds,
    exceptions: checkExceptions,
    redundantParentSegments: checkRedundantParentSegments,
    crossPackageDeepImports: checkCrossPackageDeepImports,
    testMirror: checkTestMirror,
    testsInsideSrc: checkTestsInsideSrc,
    wysiwygTopLevel: checkWysiwygTopLevel,
    wysiwygDomains: checkWysiwygDomains,
    rendererCluster: checkRendererCluster,
    splitTargets: checkSplitTargets,
  };
  const failures = [];
  const warnings = [];
  for (const rule of rules) {
    const result = registry[rule]({ root });
    for (const item of result.failures) failures.push(`[${rule}] ${item}`);
    for (const item of result.warnings) warnings.push(`[${rule}] ${item}`);
  }
  return { phase, root, rules, failures, warnings };
}

function main(argv) {
  const phaseArg = argv.find((arg) => arg.startsWith("--phase=")) ?? null;
  const phaseIndex = argv.indexOf("--phase");
  const phase = phaseArg ? phaseArg.split("=")[1] : phaseIndex >= 0 ? argv[phaseIndex + 1] : "pr1";
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd();
  const asJson = argv.includes("--json");

  const result = runChecks({ root, phase });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`structure check (phase=${result.phase}, root=${root})\n`);
    process.stdout.write(`规则：${result.rules.join(", ")}\n`);
    for (const warning of result.warnings) process.stdout.write(`  warn  ${warning}\n`);
    for (const failure of result.failures) process.stdout.write(`  FAIL  ${failure}\n`);
    process.stdout.write(
      result.failures.length === 0
        ? `✅ 结构检查通过（${result.warnings.length} warning）\n`
        : `❌ 结构检查失败：${result.failures.length} 项\n`,
    );
  }
  process.exitCode = result.failures.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main(process.argv.slice(2));
