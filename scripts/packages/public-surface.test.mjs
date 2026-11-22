/**
 * @file public-surface.test.mjs
 * @description 公开导出面守卫。三件事：
 *   1. 入口集合与导出清单冻结在 `public-surface.snapshot.json`，任何增删都必须在 diff 里可见；
 *   2. `budget` 身份棘轮——新增导出必须显式抬高预算，把"顺手塞一个内部件"变成需要写理由的动作；
 *   3. `/internals` 白名单与 `docs/agent/architecture/public_api_extensibility_matrix.md` 双向交叉。
 *
 * 快照描述的是**源码契约**（工作区 `./src/*.ts` 入口），不是构建产物。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  PUBLIC_PACKAGES,
  REPO_ROOT,
  collectPublicSurface,
  listPublicEntries,
  readManifest,
} from "./public-surface.mjs";

const SNAPSHOT_PATH = "scripts/packages/public-surface.snapshot.json";
const MATRIX_PATH = "docs/agent/architecture/public_api_extensibility_matrix.md";
/** `/internals` 的导出口数：增减必须同时改 matrix 白名单与本数字（人工确认出口）。 */
const INTERNAL_EXPORT_COUNT = 71;

const snapshot = JSON.parse(readFileSync(join(REPO_ROOT, SNAPSHOT_PATH), "utf8"));
// 单次 Program 覆盖全部入口，避免每个用例重复解析同一张依赖图（实测 ~2.8s）。
const { surface, problems } = collectPublicSurface();

const entryIds = (obj) => Object.keys(obj).toSorted();
const namesOf = (exportsList) => exportsList.map((item) => item.name);
const formatList = (list) =>
  list.length === 0 ? "（空）" : list.map((n) => `  - ${n}`).join("\n");

test("每个公开入口都能被解析", () => {
  assert.deepEqual(problems, [], `入口解析失败：\n${problems.join("\n")}`);
});

test("入口集合与快照一致（新增/删除子入口必须改快照）", () => {
  const declared = entryIds(Object.fromEntries(listPublicEntries().map((e) => [e.id, true])));
  const recorded = entryIds(snapshot.entries);
  assert.deepEqual(
    declared,
    recorded,
    `公开子入口集合发生变化。\n新增：${declared.filter((id) => !recorded.includes(id)).join(", ") || "无"}\n` +
      `消失：${recorded.filter((id) => !declared.includes(id)).join(", ") || "无"}\n` +
      `如属预期，运行 node ${SNAPSHOT_PATH.replace(/\.snapshot\.json$/u, ".mjs")} 更新快照并在 PR 说明。`,
  );
});

for (const entryId of entryIds(snapshot.entries)) {
  test(`${entryId} 的导出清单与快照逐字一致`, () => {
    const recorded = snapshot.entries[entryId];
    const current = surface[entryId];
    assert.ok(current, `快照里有 ${entryId}，但源码入口已不可解析（入口被删除或改名）。`);

    const added = namesOf(current).filter((name) => !namesOf(recorded.exports).includes(name));
    const removed = namesOf(recorded.exports).filter((name) => !namesOf(current).includes(name));
    assert.deepEqual(
      { added, removed },
      { added: [], removed: [] },
      `${entryId} 的导出面发生变化：\n新增：\n${formatList(added)}\n删除：\n${formatList(removed)}\n` +
        `新增必须在 docs/agent/architecture/public_api_extensibility_matrix.md 登记，并抬高 budget；` +
        `删除属于收口，直接更新快照。`,
    );

    // kind 漂移（value ↔ type）同样要暴露：它决定"能否在运行时拿到"，是收口口径的一部分。
    const kindDrift = current
      .filter((item) => {
        const previous = recorded.exports.find((old) => old.name === item.name);
        return previous && previous.kind !== item.kind;
      })
      .map(
        (item) =>
          `${item.name}: ${recorded.exports.find((o) => o.name === item.name).kind} -> ${item.kind}`,
      );
    assert.deepEqual(kindDrift, [], `${entryId} 的导出种类漂移：\n${formatList(kindDrift)}`);
  });
}

test("身份棘轮：任何入口的导出数量不得超过已登记的预算", () => {
  const overBudget = [];
  for (const entryId of entryIds(snapshot.entries)) {
    const budget = snapshot.entries[entryId].budget;
    const current = surface[entryId] ?? [];
    const values = current.filter((item) => item.kind !== "type").length;
    if (current.length > budget.total || values > budget.values) {
      overBudget.push(
        `${entryId}: 当前 total=${current.length}/values=${values}，预算 total=${budget.total}/values=${budget.values}`,
      );
    }
  }
  assert.deepEqual(
    overBudget,
    [],
    `导出面在增长。预算的存在就是为了让"体积回升"需要一次明确决定：\n${overBudget.join("\n")}\n` +
      `如确属必需，修改 ${SNAPSHOT_PATH} 的 budget 并在 PR 写明理由与对应 matrix 条目；否则应下沉到 /internals。`,
  );
});

/**
 * 读取 matrix 的 internals 白名单块。
 * 约定：`<!-- internals-whitelist:start -->` 与 `end` 之间，每行形如
 * `| \`名字\` | \`入口\` | 理由 | 晋级条件 |`
 */
function readInternalsWhitelist() {
  const markdown = readFileSync(join(REPO_ROOT, MATRIX_PATH), "utf8");
  const block =
    /<!-- internals-whitelist:start -->([\s\S]*?)<!-- internals-whitelist:end -->/u.exec(markdown);
  assert.ok(block, `${MATRIX_PATH} 缺少 internals-whitelist 标记块`);
  const rows = [];
  for (const line of block[1].split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/u.exec(line.trim());
    if (match) rows.push({ name: match[1], entry: match[2] });
  }
  return rows;
}

test("/internals 白名单与 matrix 双向交叉", (t) => {
  const whitelist = readInternalsWhitelist();
  const internalsEntryIds = entryIds(snapshot.entries).filter((id) => id.endsWith("/internals"));

  if (internalsEntryIds.length === 0) {
    // P0 阶段 /internals 尚未落地；此断言在 P4 引入入口后自动生效。
    assert.deepEqual(
      whitelist,
      [],
      "/internals 入口尚不存在，但 matrix 里已经登记了白名单条目——先把入口建出来，条目才可解析。",
    );
    t.diagnostic(
      "internals-whitelist 交叉校验暂未激活（/@md-editor/editor/internals 尚未落地，P4 引入后自动生效）",
    );
    return;
  }

  const declared = whitelist.map((row) => row.name).toSorted();
  const actual = namesOf(surface[internalsEntryIds[0]]).toSorted();
  const undocumented = actual.filter((name) => !declared.includes(name));
  const dangling = declared.filter((name) => !actual.includes(name));
  assert.deepEqual(
    { undocumented, dangling },
    { undocumented: [], dangling: [] },
    `/internals 与 matrix 白名单不一致：\n` +
      `未登记（在 /internals 里但 matrix 没有）：\n${formatList(undocumented)}\n` +
      `悬空（matrix 有但 /internals 解析不到）：\n${formatList(dangling)}`,
  );
});

test("exports 与 publishConfig.exports 的键集相等（发布产物不得与源码入口分叉）", () => {
  for (const packageDirName of PUBLIC_PACKAGES) {
    const { manifest } = readManifest(REPO_ROOT, packageDirName);
    const declared = Object.keys(manifest.exports ?? {}).filter((key) => !key.endsWith(".css"));
    const published = Object.keys(manifest.publishConfig?.exports ?? {}).filter(
      (key) => !key.endsWith(".css"),
    );
    assert.deepEqual(
      published.toSorted(),
      declared.toSorted(),
      `${manifest.name}: exports 与 publishConfig.exports 键集不一致。` +
        `build.mjs 只读 exports，漏写 publishConfig 只有打包验证才炸。`,
    );
  }
});

test("X-3：/internals 与 /testing 无交集（两套非正式出口不得重叠）", () => {
  const internals = snapshot.entries["@md-editor/editor/internals"]?.exports ?? [];
  const testingEntries = Object.keys(snapshot.entries).filter(
    (id) => id.startsWith("@md-editor/editor") && id.endsWith("/testing"),
  );
  const testingNames = new Set(
    testingEntries.flatMap((id) => snapshot.entries[id].exports.map((item) => item.name)),
  );
  const overlap = internals.map((item) => item.name).filter((name) => testingNames.has(name));
  assert.deepEqual(overlap, [], `以下名字同时出现在 /internals 与 /testing：${overlap.join(", ")}`);
});

test("X-2：/internals 的每个导出都带 @internal（ts.createProgram 枚举，非正则代理）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ts = (await import("typescript")).default;

  const internalsPath = path.join(REPO_ROOT, "packages/editor/src/internals.ts");
  const program = ts.createProgram([internalsPath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(internalsPath);
  assert.ok(source, "无法加载 internals.ts");
  const moduleSymbol = checker.getSymbolAtLocation(source);
  assert.ok(moduleSymbol, "internals.ts 不是可枚举的模块");
  const exported = checker.getExportsOfModule(moduleSymbol);

  // 目的：证明"每个非公开导出都标注了 @internal"，而不是"文件里出现过 @internal 字样"。
  if (exported.length !== INTERNAL_EXPORT_COUNT) {
    // 增减白名单条目时必须同步本数字与 matrix 文档（两者都是人工确认的出口）。
    assert.fail(`internals 导出数变化：期望 ${INTERNAL_EXPORT_COUNT}，实际 ${exported.length}`);
  }

  const internalsText = fs.readFileSync(internalsPath, "utf8");
  const missing = [];
  for (const symbol of exported) {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = resolved.declarations?.[0];
    const markedOnDeclaration =
      declaration !== undefined &&
      ts.getJSDocTags(declaration).some((tag) => tag.tagName.getText() === "internal");
    // 外部包类型没有"本仓声明"可挂标记，改在 internals.ts 的导出条目上标注。
    const markedOnSpecifier = new RegExp(
      `@internal[\\s\\S]{0,60}?\\b${symbol.getName()}\\b`,
      "u",
    ).test(internalsText);
    if (!markedOnDeclaration && !markedOnSpecifier) missing.push(symbol.getName());
  }
  assert.deepEqual(missing, [], `以下导出缺少 @internal 标注：${missing.join(", ")}`);
});

test("M-2c：没有任何静态 :root 再声明 --theme-editor-font-size（编辑器是唯一 writer）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const targets = [
    "apps/desktop/src/styles.css",
    "apps/web/src/styles.css",
    "apps/utools/src/styles.css",
    "apps/mobile/core/src/styles.css",
    "packages/app-ui/src/themes/kami-themes.ts",
  ];
  const offenders = targets.filter((file) =>
    fs.readFileSync(path.join(REPO_ROOT, file), "utf8").includes("--theme-editor-font-size:"),
  );
  assert.deepEqual(
    offenders,
    [],
    `以下文件仍在静态声明该变量，会与 theme 注入竞争：\n${offenders.join("\n")}`,
  );
});
