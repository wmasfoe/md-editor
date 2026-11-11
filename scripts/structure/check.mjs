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
export const CLUSTER_STRICT_PACKAGES = ["packages/editor"];
export const MOVE_HEADROOM = 5;
/** 测试辅助目录不入镜像检查（存量合法反例：packages/core/tests/support）。 */
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
  "packages/editor/src/renderer/index.ts": WARN_LINES,
  "packages/editor/src/renderer/controller.ts": WARN_LINES,
  "packages/editor/src/wysiwyg/state/projection-field.ts": WARN_LINES,
  "packages/editor/src/wysiwyg/widgets/table/table-widget.ts": WARN_LINES,
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
    "declaredWorkspaceDeps",
    "tailwindSourceEntry",
    "syntaxPluginsIndependence",
    "editorIndependence",
    "noTopLevelSideEffects",
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
    "virtual-trailing-line.ts",
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
    "mouse-selection.ts",
  ],
  view: [
    "focus-mode.ts",
    "search-panel.ts",
    "parse-progress.ts",
    "suggestion.ts",
    // AI 建议的数据模型与行内部件，从 suggestion.ts 拆出（2026-11 风格学习 PR5）
    "suggestion-model.ts",
    "suggestion-widgets.ts",
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
  const patterns = [
    /from\s+["']([^"']+)["']/gu,
    /import\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bimport\s*["']([^"']+)["']/gu,
  ];
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
  const dir = join(root, "packages/editor/src/wysiwyg");
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
  const base = join(root, "packages/editor/src/wysiwyg");
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
  const base = join(root, "packages/editor/src/renderer");
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

/**
 * 收集一个源文件里对 `@md-editor/*` 的导入，并判定是否**纯类型导入**。
 *
 * 纯类型导入在编译期被擦除，不进运行期产物，因此允许只声明在 `devDependencies`；
 * 值导入（含副作用导入、动态 import、require）必须声明在 `dependencies` 或
 * `peerDependencies`，否则消费方安装后会在运行期解析失败。
 *
 * 判据：
 * - `import type { X } from "m"`         → 纯类型
 * - `import { type A, type B } from "m"` → 纯类型（全部具名都带 `type` 前缀）
 * - 其余 `import` / `import()` / `require()` → 值导入
 */
export function collectWorkspaceImports(file) {
  const content = readFileSync(file, "utf8");
  const results = [];

  for (const match of content.matchAll(/import\s+type\s+[^;]*?from\s+["']([^"']+)["']/gu)) {
    results.push({ specifier: match[1], typeOnly: true });
  }
  for (const match of content.matchAll(/import\s*\{([^}]*)\}\s*from\s+["']([^"']+)["']/gu)) {
    const names = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const allTypeOnly = names.length > 0 && names.every((name) => /^type\s/u.test(name));
    results.push({ specifier: match[2], typeOnly: allTypeOnly });
  }
  for (const match of content.matchAll(/import\s+(?!type\s)[^;{]*?from\s+["']([^"']+)["']/gu)) {
    results.push({ specifier: match[1], typeOnly: false });
  }
  for (const match of content.matchAll(/import\s*["']([^"']+)["']/gu)) {
    results.push({ specifier: match[1], typeOnly: false });
  }
  for (const match of content.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    results.push({ specifier: match[1], typeOnly: false });
  }
  for (const match of content.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    results.push({ specifier: match[1], typeOnly: false });
  }
  // 重导出同样是运行期依赖：`export * from "x"` / `export { a } from "x"`。
  // `export type { T } from "x"` 是纯类型，可放 devDependencies。
  for (const match of content.matchAll(/export\s+type\s+[^;]*?from\s+["']([^"']+)["']/gu)) {
    results.push({ specifier: match[1], typeOnly: true });
  }
  for (const match of content.matchAll(/export\s*\{([^}]*)\}\s*from\s+["']([^"']+)["']/gu)) {
    const names = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const allTypeOnly = names.length > 0 && names.every((name) => /^type\s/u.test(name));
    results.push({ specifier: match[2], typeOnly: allTypeOnly });
  }
  for (const match of content.matchAll(/export\s*\*\s*(?:as\s+\w+\s*)?from\s+["']([^"']+)["']/gu)) {
    results.push({ specifier: match[1], typeOnly: false });
  }

  return results;
}

/**
 * 规则：每个 workspace 必须声明它实际 import 的 `@md-editor/*` 包。
 *
 * 背景：monorepo 里跨包 import 若只靠 pnpm 的解析能力而不写进 package.json，
 * 在切换 linker 模式、改 hoisting、或单包发包时会直接解析失败。声明即契约。
 *
 * 分档：
 * - `src/**` 的值导入 → 必须在 `dependencies` 或 `peerDependencies`
 * - `src/**` 的纯类型导入 → 允许只出现在 `devDependencies`
 * - `tests/**` 的导入 → 任一依赖字段即可
 */
export function checkDeclaredWorkspaceDeps({ root, directories = workspaceDirs(root) }) {
  const failures = [];

  for (const { name, dir } of directories) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const runtime = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const devOnly = new Set(Object.keys(pkg.devDependencies ?? {}));

    // 扫描域：标准 `src/`、`tests/`，以及 Next.js 风格的 `app/`/`components/`/`lib/`
    // （apps/site 没有 src/，只有这三者——早期只扫 src/tests 导致它完全漏检）。
    for (const area of ["src", "tests", "app", "components", "lib"]) {
      const areaDir = join(dir, area);
      if (!existsSync(areaDir)) continue;
      for (const file of walkFiles(areaDir, isSourceFile)) {
        const rel = `${name}/${relative(dir, file).split(sep).join("/")}`;
        for (const { specifier, typeOnly } of collectWorkspaceImports(file)) {
          if (!specifier.startsWith("@md-editor/")) continue;
          const dependency = specifier.split("/").slice(0, 2).join("/");
          if (dependency === pkg.name) continue;
          const declaredAtRuntime = runtime.has(dependency);
          const declaredAnywhere = declaredAtRuntime || devOnly.has(dependency);

          // 只有 `tests/` 是测试域（可放宽到 devDependencies）；其余扫描域都是运行期代码。
          if (area !== "tests") {
            if (declaredAtRuntime) continue;
            if (typeOnly && declaredAnywhere) continue;
            failures.push(
              typeOnly
                ? `${rel}: 类型导入 ${dependency} 未在 dependencies/devDependencies 声明`
                : `${rel}: 值导入 ${dependency} 未在 dependencies 或 peerDependencies 声明`,
            );
          } else if (!declaredAnywhere) {
            failures.push(`${rel}: 测试导入 ${dependency} 未在任何依赖字段声明`);
          }
        }
      }
    }
  }

  return { failures, warnings: [] };
}

/**
 * 规则：Tailwind 扫描源必须经由共享入口登记，且不得手抄 `@source`。
 *
 * 背景：Tailwind v4 默认不扫描 `node_modules`，而 workspace 包经 pnpm 链接后位于各 app
 * 的 `node_modules/@md-editor/*`。因此每个用到 `@md-editor/app-ui` 的 app 必须显式登记
 * 扫描源，否则该包内的工具类不会生成 CSS，界面静默缺失样式。
 *
 * 历史缺陷：四个 app 各自手抄一行 `@source "../../../packages/app-ui/src";`，
 * 而 `apps/site` 漏抄——因为 site 当时只用纯 CSS 类组件，样式缺失被掩盖。
 * 手抄仪式本身才是根因：新增第五个 app 时必然再漏一次。
 *
 * 契约：
 * 1. 引入 Tailwind 的 app 必须 `@import "@md-editor/app-ui/tailwind-sources.css"`；
 * 2. 任何 app 的 CSS 不得直接写 `@source`（扫描源只在共享文件里维护）；
 * 3. 共享文件自身必须恰好包含一处 `@source`。
 */
export const TAILWIND_SHARED_SOURCES_IMPORT = "@md-editor/app-ui/tailwind-sources.css";

export function checkTailwindSourceEntry({ root, directories = workspaceDirs(root) }) {
  const failures = [];
  const cssFiles = (dir) => walkFiles(dir, (file) => file.endsWith(".css"));

  for (const { name, dir } of directories) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const usesTailwind = Object.keys(allDeps).some((dep) => dep === "tailwindcss");
    if (!usesTailwind) continue;

    const files = [...cssFiles(join(dir, "src")), ...cssFiles(join(dir, "app"))];
    if (files.length === 0) continue;

    let importsShared = false;
    for (const file of files) {
      const rel = `${name}/${relative(dir, file).split(sep).join("/")}`;
      const content = readFileSync(file, "utf8");

      // 禁止手抄 @source（扫描源集中在共享文件）
      for (const match of content.matchAll(/^\s*@source\s+(?!inline\()([^;]+);/gmu)) {
        failures.push(
          `${rel}: 不得直接写 @source（${match[1].trim()}）；扫描源统一在 ${TAILWIND_SHARED_SOURCES_IMPORT}`,
        );
      }

      if (content.includes(`@import "${TAILWIND_SHARED_SOURCES_IMPORT}"`)) importsShared = true;
    }

    if (!importsShared) {
      failures.push(
        `${name}: 使用 tailwindcss 但未引入共享扫描源入口（@import "${TAILWIND_SHARED_SOURCES_IMPORT}"）`,
      );
    }
  }

  // 共享文件自身：必须恰好一处 @source，且指向 ../src
  const sharedPath = join(root, "packages/app-ui/styles/tailwind-sources.css");
  if (!existsSync(sharedPath)) {
    failures.push("packages/app-ui/styles/tailwind-sources.css: 共享扫描源入口文件缺失");
  } else {
    const content = readFileSync(sharedPath, "utf8");
    const sources = [...content.matchAll(/^\s*@source\s+(?!inline\()([^;]+);/gmu)].map((m) =>
      m[1].trim(),
    );
    if (sources.length !== 1) {
      failures.push(
        `packages/app-ui/styles/tailwind-sources.css: 应恰好包含 1 处 @source，实际 ${sources.length} 处`,
      );
    } else if (sources[0] !== '"../src"') {
      failures.push(
        `packages/app-ui/styles/tailwind-sources.css: @source 应指向 "../src"，实际 ${sources[0]}`,
      );
    }
  }

  return { failures, warnings: [] };
}

/**
 * 规则：语法插件包不得反向依赖渲染器实现。
 *
 * 背景：`@md-editor/editor` 与 `@md-editor/syntax-plugins` 在架构图里是
 * **并列兄弟**（都只消费 `@md-editor/plugin-sdk` 的语法契约，见
 * `docs/agent/architecture/markdown_syntax_plugin_architecture.md` §1）。
 * 插件依赖插件宿主会让第三方插件作者跟着学坏，且渲染器无法独立演进。
 *
 * 两类历史成因与对应出路：
 * 1. **纯函数 / 纯数据**（如 `defaultCalloutTitle`、CJK flanking）→ 上移至
 *    `@md-editor/plugin-sdk/syntax`；
 * 2. **宿主能力**（如媒体查看器、Callout widget 工厂）→ 走 `SyntaxPluginHostPorts`
 *    端口注入（facet），插件从 `state.facet(...)` 取值，不 import 实现。
 *
 * `tests/**` 不在本规则范围内：测试需要渲染器提供 `EditorState` 夹具。
 */
export const SYNTAX_PLUGINS_NO_RENDERER_IMPORT = [
  {
    name: "syntax-plugins",
    forbidden: /^@md-editor\/editor(?:\/|$)/u,
    reason: "语法插件包不得依赖渲染器实现（应走 plugin-sdk 契约或 host 端口）",
  },
];

// Both the browser API and its React adapter consume host data through explicit props/ports.
export const EDITOR_NO_APP_IMPORT = [
  {
    name: "editor",
    forbidden: /^@md-editor\/(?:app-ui|i18n)(?:\/|$)/u,
    reason: "编辑器不得依赖应用 UI 或国际化（应通过 props 或端口注入）",
  },
];

export function checkSyntaxPluginsIndependence(options) {
  return checkPackageSourceImports(options, SYNTAX_PLUGINS_NO_RENDERER_IMPORT);
}

export function checkEditorIndependence(options) {
  return checkPackageSourceImports(options, EDITOR_NO_APP_IMPORT);
}

function checkPackageSourceImports({ root, directories = workspaceDirs(root) }, rules) {
  const failures = [];

  for (const rule of rules) {
    const target = directories.find((entry) => entry.name.endsWith(`/${rule.name}`));
    if (!target) continue;
    const srcDir = join(target.dir, "src");
    if (!existsSync(srcDir)) continue;

    for (const file of walkFiles(srcDir, isSourceFile)) {
      const rel = `${target.name}/${relative(target.dir, file).split(sep).join("/")}`;
      for (const specifier of moduleSpecifiers(file)) {
        if (rule.forbidden.test(specifier)) {
          failures.push(`${rel}: ${rule.reason} → ${specifier}`);
        }
      }
    }
  }

  return { failures, warnings: [] };
}

/**
 * 规则：库模块不得在顶层产生副作用。
 *
 * 背景：`import` 一个库不应改动宿主环境。历史缺陷：`@md-editor/i18n` 在模块顶层
 * 调用 `ensureI18nInitialized()`，后果是任何 `import` 一个编辑器组件的外部宿主
 * 都会无条件拉入 i18next + react-i18next + 四份语言包，并悄悄改写
 * `document.documentElement.lang`。
 *
 * 判据：文件的**顶层**（不在任何函数/类/接口/对象字面量内）不得出现表达式语句。
 * 允许的顶层结构：import、export（含 `export const/function/class/type/interface`）、
 * 声明（`const`/`let`/`function`/`class`/`type`/`interface`/`enum`）、注释、空行。
 *
 * 实现方式：逐行跟踪花括号深度，只看深度 0 的非空行；排除声明关键字开头的行。
 */
export const NO_TOP_LEVEL_SIDE_EFFECT_FILES = [
  {
    path: "packages/i18n/src/i18n.ts",
    reason:
      "库模块不得在 import 时初始化 i18n 或改写宿主 document 属性（改为惰性初始化 + configureI18n）",
  },
];

/** 顶层允许出现的行首关键字（含修饰后的声明）。 */
const TOP_LEVEL_DECLARATION =
  /^(?:import|export|declare|const|let|var|function|class|type|interface|enum|abstract)\b/u;

export function checkNoTopLevelSideEffects({ root }) {
  const failures = [];

  for (const entry of NO_TOP_LEVEL_SIDE_EFFECT_FILES) {
    const file = join(root, entry.path);
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    let depth = 0;
    let inBlockComment = false;

    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      const line = raw.trim();

      // 粗略处理块注释：注释内容不参与判定。
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.startsWith("/*")) {
        if (!line.includes("*/", 2)) inBlockComment = true;
        continue;
      }
      if (line === "" || line.startsWith("//") || line.startsWith("*")) {
        continue;
      }

      const atTopLevel = depth === 0;
      // 先更新深度，保证 `}` 收尾的行不被误判。
      const opens = (line.match(/\{/gu) ?? []).length;
      const closes = (line.match(/\}/gu) ?? []).length;
      depth += opens - closes;

      if (!atTopLevel) continue;
      // 多行声明的续行（如 `export const x =` 换行后的表达式）不在本规则范围内，
      // 因为行首不是关键字；这里只拦「顶层裸调用」这类明确副作用。
      if (TOP_LEVEL_DECLARATION.test(line)) continue;
      // 跳过闭合括号行与纯符号行。
      if (/^[)}\]);,]*$/u.test(line)) continue;

      failures.push(
        `${entry.path}:${index + 1}: 顶层不得有执行语句 → ${line.slice(0, 80)}（${entry.reason}）`,
      );
    }
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
    declaredWorkspaceDeps: checkDeclaredWorkspaceDeps,
    tailwindSourceEntry: checkTailwindSourceEntry,
    syntaxPluginsIndependence: checkSyntaxPluginsIndependence,
    editorIndependence: checkEditorIndependence,
    noTopLevelSideEffects: checkNoTopLevelSideEffects,
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
