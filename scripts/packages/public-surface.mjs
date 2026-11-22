/**
 * @file public-surface.mjs
 * @description 公开 npm 包导出面测量。用 TypeScript 编译器 API 枚举"从公开入口可达"的导出，
 * 包括类型导出（运行时无法枚举），供快照测试与 `@internal` 机器校验使用。
 *
 * 为什么不用 `Object.keys(await import(...))`：那只能看到值导出，看不到类型，
 * 而本次收口的核心指标之一正是"类型也要能被文档化/被 @internal 标注"。
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 需要纳入公开契约的包（私有的 app-ui / ai / i18n 等不在此列）。 */
export const PUBLIC_PACKAGES = [
  "core",
  "editor",
  "plugin-sdk",
  "plugin-host",
  "markdown-fidelity",
  "shared",
];

/** 只做样式注入的入口，导出面不构成 API。 */
const NON_CODE_ENTRY = /\.css$/u;

function readText(file) {
  return readFileSync(file, "utf8");
}

export function readManifest(root, packageDirName) {
  const dir = join(root, "packages", packageDirName);
  return { dir, manifest: JSON.parse(readText(join(dir, "package.json"))) };
}

/**
 * 从 `package.json` 的 `exports` 推导公开入口。
 * 使用工作区源码入口（`./src/**.ts`），因为快照描述的是"源码契约"，
 * 而不是某个构建产物。`publishConfig.exports` 的键集一致性由 X-8 单独断言。
 */
export function listPublicEntries({ root = REPO_ROOT, packages = PUBLIC_PACKAGES } = {}) {
  const entries = [];
  for (const packageDirName of packages) {
    const { dir, manifest } = readManifest(root, packageDirName);
    const exportsField = manifest.exports ?? {};
    for (const [subpath, target] of Object.entries(exportsField)) {
      const source = typeof target === "string" ? target : (target?.default ?? target?.types);
      if (typeof source !== "string" || NON_CODE_ENTRY.test(source)) continue;
      entries.push({
        id: subpath === "." ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//u, "")}`,
        packageName: manifest.name,
        subpath,
        file: join(dir, source),
        root,
      });
    }
  }
  return entries;
}

function classifySymbol(checker, symbol) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const isValue = (resolved.flags & ts.SymbolFlags.Value) !== 0;
  const isType =
    (resolved.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0 ||
    (resolved.flags & ts.SymbolFlags.Class) !== 0 ||
    (resolved.flags & ts.SymbolFlags.Enum) !== 0;
  if (isValue && isType) return "both";
  return isValue ? "value" : "type";
}

/**
 * 为给定入口建立一次 Program，返回 `{ entryId: [{ name, kind }] }`。
 * 单次 Program 覆盖全部入口，避免逐包重复解析同一张依赖图。
 */
export function collectPublicSurface({
  root = REPO_ROOT,
  entries = listPublicEntries({ root }),
} = {}) {
  const baseConfigPath = join(root, "tsconfig.base.json");
  const baseConfig = ts.parseJsonConfigFileContent(
    { compilerOptions: ts.readConfigFile(baseConfigPath, ts.sys.readFile).config.compilerOptions },
    ts.sys,
    root,
  );

  const program = ts.createProgram({
    rootNames: entries.map((entry) => entry.file),
    options: {
      ...baseConfig.options,
      types: ["node"],
      noEmit: true,
    },
  });
  const checker = program.getTypeChecker();
  const surface = {};
  const problems = [];

  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.file);
    if (!sourceFile) {
      problems.push(`${entry.id}: 入口文件无法解析（${relative(root, entry.file)}）`);
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      problems.push(`${entry.id}: 不是模块（${relative(root, entry.file)}）`);
      continue;
    }
    const exported = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => ({ name: symbol.getName(), kind: classifySymbol(checker, symbol) }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    surface[entry.id] = exported;
  }

  return { surface, problems, program, checker };
}

/** 汇总口径：与 PRD 中"值/类型"计数保持一致。 */
export function summarizeSurface(surface) {
  const summary = {};
  for (const [entryId, exportsList] of Object.entries(surface)) {
    const values = exportsList.filter((item) => item.kind !== "type").length;
    summary[entryId] = { total: exportsList.length, values, types: exportsList.length - values };
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI：生成 / 更新快照基线
// ─────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_PATH = "scripts/packages/public-surface.snapshot.json";

/**
 * 基线快照结构。
 *
 * `exports` 是精确清单（任何增删都必须改这个文件，于是 diff 可见）；
 * `budget` 是**身份棘轮**：新增导出不仅要改 `exports`，还要显式抬高 budget —— 目的是让
 * "顺手往主入口塞一个内部件" 变成一个需要写理由的动作，而不是一次静默编辑。
 *
 * 关键：budget **不会被重新生成抬高**。它只从既有快照继承（没有则取当前值作初值），
 * 否则 `node public-surface.mjs` 一跑棘轮就失效。降低或抬高都必须人手改这个文件。
 */
export function buildSnapshot(surface, { previous } = {}) {
  const entries = {};
  for (const entryId of Object.keys(surface).toSorted()) {
    const exportsList = surface[entryId];
    const current = {
      total: exportsList.length,
      values: exportsList.filter((item) => item.kind !== "type").length,
    };
    entries[entryId] = {
      budget: previous?.entries?.[entryId]?.budget ?? current,
      exports: exportsList,
    };
  }
  // 不写入时间戳：快照必须逐字确定，否则每次重新生成都会产生无意义 diff。
  return {
    schemaVersion: 1,
    generatedBy: "scripts/packages/public-surface.mjs",
    method: "ts.Program + checker.getExportsOfModule over workspace source entries",
    regenerateWith: "node scripts/packages/public-surface.mjs",
    entries,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1])
) {
  const { writeFileSync } = await import("node:fs");
  const { surface, problems } = collectPublicSurface();
  if (problems.length > 0) {
    console.error("入口解析失败：\n" + problems.join("\n"));
    process.exit(1);
  }
  const existingSnapshotPath = join(REPO_ROOT, SNAPSHOT_PATH);
  let previous;
  try {
    previous = JSON.parse(readFileSync(existingSnapshotPath, "utf8"));
  } catch {
    previous = undefined;
  }
  const snapshot = buildSnapshot(surface, { previous });
  writeFileSync(existingSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const summary = summarizeSurface(surface);
  console.log(`写入 ${SNAPSHOT_PATH}`);
  for (const [entryId, counts] of Object.entries(summary))
    console.log(`  ${entryId.padEnd(36)} total=${counts.total} values=${counts.values}`);
}
