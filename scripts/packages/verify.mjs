import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import { selectPublicationPackages, validatePublicationClosure } from "./publication.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: { package: { type: "string", multiple: true } },
});
const temporary = mkdtempSync(join(tmpdir(), "inkpoint-npm-consumer-"));
const entries = [];
try {
  const packages = selectPublicationPackages(
    readdirSync(join(root, "packages")).map((name) =>
      JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")),
    ),
    values.package,
  );
  const tarballs = join(temporary, "tarballs");
  mkdirSync(tarballs);
  // Run the real prepack lifecycle and inspect the exact manifests npm receives.
  execFileSync(
    "pnpm",
    [
      ...packages.flatMap((pkg) => ["--filter", pkg.name]),
      "-r",
      "pack",
      "--pack-destination",
      tarballs,
    ],
    {
      cwd: root,
      stdio: "pipe",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const archives = readdirSync(tarballs);
  assert.equal(archives.length, packages.length, "Every selected package must produce one tarball");
  const packed = archives.map((file) => {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xOf", join(tarballs, file), "package/package.json"], {
        encoding: "utf8",
      }),
    );
    assert.ok(!manifest.private, `${manifest.name} is private`);
    assert.doesNotMatch(JSON.stringify(manifest), /(?:workspace|catalog):/);
    return { file, manifest };
  });
  validatePublicationClosure(packed.map(({ manifest }) => manifest));
  for (const { file, manifest } of packed) {
    const installed = join(temporary, "node_modules", manifest.name);
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", ["-xzf", join(tarballs, file), "--strip-components=1", "-C", installed]);
    assert.ok(existsSync(join(installed, "LICENSE")), `${manifest.name} lacks its license text`);
    for (const [entry, target] of Object.entries(manifest.exports)) {
      if (typeof target === "string") {
        assert.ok(existsSync(join(installed, target)), `${manifest.name}: ${target}`);
        continue;
      }
      for (const path of Object.values(target))
        assert.ok(existsSync(join(installed, path)), `${manifest.name}: ${path}`);
      entries.push(manifest.name + (entry === "." ? "" : entry.slice(1)));
    }
    // Reuse installed third-party dependencies offline; every internal package is
    // resolved from its tarball, never from a workspace source symlink.
    const original = join(root, "packages", manifest.name.split("/")[1]);
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (name.startsWith("@md-editor/")) continue;
      const dependency = join(original, "node_modules", name);
      if (!existsSync(dependency)) {
        assert.ok(
          Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
            (!Object.hasOwn(manifest.dependencies ?? {}, name) &&
              manifest.peerDependenciesMeta?.[name]?.optional),
          `${manifest.name} lacks ${name}`,
        );
        continue;
      }
      const target = join(installed, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(realpathSync(dependency), target, "dir");
    }
  }
  // React hosts provide React and its ambient types. No other dev dependencies
  // are installed into the consumer, so leaked declaration dependencies fail.
  for (const name of ["react", "react-dom", "@types/react", "@types/react-dom"]) {
    const target = join(temporary, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(realpathSync(join(root, "node_modules", name)), target, "dir");
  }
  writeFileSync(join(temporary, "package.json"), JSON.stringify({ type: "module" }));
  const consumer = join(temporary, "consumer.ts");
  writeFileSync(
    consumer,
    entries
      .map(
        (entry, index) =>
          `import * as api${index} from ${JSON.stringify(entry)}; void api${index};`,
      )
      .join("\n"),
  );
  const program = ts.createProgram([consumer], {
    noEmit: true,
    strict: true,
    skipLibCheck: false,
    types: [],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => temporary,
      getNewLine: () => "\n",
    }),
  );
  assert.ok(
    !program
      .getSourceFiles()
      .some(
        (file) =>
          file.fileName.startsWith(join(root, "packages")) && file.fileName.includes("/src/"),
      ),
    "Consumer resolved workspace sources",
  );
  // Node cannot import CSS; this loader models only the bundler's CSS handling.
  // All JavaScript resolution remains Node's native ESM implementation.
  const loader = join(temporary, "css-loader.mjs");
  writeFileSync(
    loader,
    'export async function load(url, context, next) { if (url.endsWith(".css")) return {format:"module", source:"", shortCircuit:true}; return next(url, context); }',
  );
  const runtime = join(temporary, "runtime.mjs");
  writeFileSync(
    runtime,
    entries.map((entry) => `await import(${JSON.stringify(entry)});`).join("\n"),
  );
  execFileSync(process.execPath, ["--loader", loader, runtime], { cwd: temporary, stdio: "pipe" });
  if (packages.some((pkg) => pkg.name === "@md-editor/editor"))
    assert.ok(
      existsSync(join(temporary, "node_modules/@md-editor/editor/dist/react/CodeMirrorEditor.css")),
    );
  console.log(
    `PASS: ${archives.length} tarballs, ${entries.length} JS/type entrypoints, CSS resources; no private packages or workspace sources`,
  );
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
