import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Use emitted files to resolve extensionless ESM imports, including directory indexes. */
export function rewriteImports(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith(".")) {
      const parent = node.parent;
      const isModule =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent));
      if (isModule && !node.text.endsWith(".css")) {
        const plain = node.text.replace(/\.(?:tsx?|jsx?)$/, "");
        const target = resolve(dirname(filename), plain);
        const declaration = filename.endsWith(".d.ts");
        const suffix = existsSync(target + (declaration ? ".d.ts" : ".js"))
          ? ".js"
          : existsSync(join(target, declaration ? "index.d.ts" : "index.js"))
            ? "/index.js"
            : undefined;
        if (!suffix) throw new Error(`Unresolved emitted import ${node.text} in ${filename}`);
        edits.push({ start: node.getStart(tree) + 1, end: node.end - 1, text: plain + suffix });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const edit of edits.toReversed())
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export function buildPackage(directory) {
  const configPath = join(directory, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
  // Published dependencies resolve to declarations, keeping other packages' sources
  // out of this package's rootDir and preserving normal package boundaries.
  const paths = {};
  for (const name of readdirSync(join(workspace, "packages"))) {
    const root = join(workspace, "packages", name);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (resolve(root) === resolve(directory)) continue;
    for (const [entry, target] of Object.entries(manifest.exports)) {
      if (typeof target !== "string" || !/\.tsx?$/.test(target)) continue;
      paths[manifest.name + (entry === "." ? "" : entry.slice(1))] = [
        join(root, target.replace(/^\.\/src\//, "dist/").replace(/\.tsx?$/, ".d.ts")),
      ];
    }
  }
  const outDir = join(directory, "dist");
  const options = {
    ...parsed.options,
    paths,
    rootDir: join(directory, "src"),
    outDir,
    noEmit: false,
    noEmitOnError: true,
    declaration: true,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
    rewriteRelativeImportExtensions: true,
  };
  const files = walk(join(directory, "src")).filter((file) => /\.tsx?$/.test(file));
  rmSync(outDir, { recursive: true, force: true });
  const program = ts.createProgram(files, options);
  const result = program.emit();
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
  if (diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => directory,
        getNewLine: () => "\n",
      }),
    );
  }
  for (const file of walk(outDir)) {
    if (extname(file) === ".js" || file.endsWith(".d.ts")) {
      writeFileSync(file, rewriteImports(readFileSync(file, "utf8"), file));
    }
  }
  for (const file of walk(join(directory, "src"))) {
    if (/\.tsx?$/.test(file)) continue;
    const target = join(outDir, file.slice(join(directory, "src").length));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPackage(process.cwd());
}
