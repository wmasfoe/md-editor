import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { build } from "vite";
import { buildBaseline, evaluateBundleBudget } from "./bundle-budget.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const baselinePath = resolve(scriptDirectory, "bundle-budget.baseline.json");

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return null;
  }
}
const allowedLanguagePackages = new Set([
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "yaml",
]);
const allowedLegacyModes = new Set(["clike", "ruby", "shell", "swift"]);

const buildResult = await build({
  root: appRoot,
  configFile: resolve(appRoot, "vite.config.ts"),
  mode: "production",
  logLevel: "silent",
  build: { write: false },
});
const outputs = (Array.isArray(buildResult) ? buildResult : [buildResult]).flatMap(
  ({ output }) => output,
);
const chunks = outputs.filter((output) => output.type === "chunk");
const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
const bootSeeds = chunks.filter(
  (chunk) => chunk.isEntry || chunk.facadeModuleId?.endsWith("/src/app/App.tsx"),
);
const bootFiles = new Set();

function includeStaticImports(chunk) {
  if (bootFiles.has(chunk.fileName)) return;
  bootFiles.add(chunk.fileName);
  for (const importedFile of chunk.imports) {
    const importedChunk = chunksByFileName.get(importedFile);
    if (importedChunk) includeStaticImports(importedChunk);
  }
}

for (const seed of bootSeeds) includeStaticImports(seed);

const excludedModules = [];
const parserChunks = [];
for (const chunk of chunks) {
  const parserModules = [];
  for (const moduleId of chunk.moduleIds) {
    if (moduleId.includes("/@codemirror/language-data/")) {
      excludedModules.push(moduleId);
      continue;
    }

    const languageMatch = moduleId.match(/\/@codemirror\/lang-([^/]+)\//u);
    if (languageMatch) {
      const languagePackage = languageMatch[1];
      parserModules.push(`lang-${languagePackage}`);
      if (!allowedLanguagePackages.has(languagePackage)) excludedModules.push(moduleId);
    }

    const legacyMatch = moduleId.match(/\/legacy-modes\/mode\/([^/.]+)\.js$/u);
    if (legacyMatch) {
      const legacyMode = legacyMatch[1];
      parserModules.push(`legacy:${legacyMode}`);
      if (!allowedLegacyModes.has(legacyMode)) excludedModules.push(moduleId);
    }
  }
  if (parserModules.length > 0) {
    parserChunks.push({
      fileName: chunk.fileName,
      gzipBytes: gzipSync(chunk.code).byteLength,
      lazy: !bootFiles.has(chunk.fileName),
      parserModules: [...new Set(parserModules)].toSorted(),
    });
  }
}

const report = {
  chunkCount: chunks.length,
  totalJavaScriptGzipBytes: chunks.reduce(
    (total, chunk) => total + gzipSync(chunk.code).byteLength,
    0,
  ),
  bootJavaScriptGzipBytes: [...bootFiles].reduce(
    (total, fileName) => total + gzipSync(chunksByFileName.get(fileName).code).byteLength,
    0,
  ),
  excludedModuleCount: excludedModules.length,
  excludedModules: [...new Set(excludedModules)].toSorted(),
  parserChunks: parserChunks.toSorted((left, right) => left.fileName.localeCompare(right.fileName)),
};

console.log(JSON.stringify(report, null, 2));

// ---- 包体预算判定 ----
// 指标是 minify+gzip 后的字节数，与机器性能无关（确定性），因此可用绝对阈值。
if (process.argv.includes("--update-budget")) {
  const next = buildBaseline(report, readBaseline() ?? {});
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n[bundle-budget] 已刷新基线：${relative(process.cwd(), baselinePath)}`);
} else {
  const baseline = readBaseline();
  if (!baseline) {
    console.error(
      `\n[bundle-budget] 未找到基线文件 ${baselinePath}（可运行 pnpm test:bundle:update 生成）`,
    );
    process.exitCode = 1;
  } else {
    const evaluation = evaluateBundleBudget(report, baseline);
    console.log(`\n[bundle-budget] headroom=${(evaluation.headroomRatio * 100).toFixed(0)}%`);
    for (const check of evaluation.checks) {
      console.log(
        `  ${check.ok ? "PASS" : "FAIL"}  ${check.metric}: ${check.actual} / limit ${check.limit}（基线 ${check.baseline}）`,
      );
    }
    if (!evaluation.ok) {
      console.error(
        "[bundle-budget] 包体超出预算：先确认是否为有意增重；若有意，运行 pnpm test:bundle:update 刷新基线（让增重成为一次可见 diff）",
      );
      process.exitCode = 1;
    }
  }
}

if (report.excludedModuleCount > 0) process.exitCode = 1;
