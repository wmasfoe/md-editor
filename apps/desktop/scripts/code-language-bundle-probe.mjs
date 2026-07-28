import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
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
if (report.excludedModuleCount > 0) process.exitCode = 1;
