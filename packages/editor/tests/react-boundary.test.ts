import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const isReact = (specifier: string) =>
  /^(?:react|react-dom|@types\/react)(?:\/|$)/u.test(specifier);

describe("optional React sub-entrypoint boundary", () => {
  it("declares React only as an optional peer and keeps the main export separate", () => {
    expect(manifest.dependencies.react).toBeUndefined();
    expect(manifest.dependencies["react-dom"]).toBeUndefined();
    expect(manifest.peerDependencies.react).toBeTruthy();
    expect(manifest.peerDependenciesMeta.react).toEqual({ optional: true });
    expect(manifest.peerDependencies["react-dom"]).toBeUndefined();
    expect(manifest.exports["."]).toBe("./src/index.ts");
    expect(manifest.exports["./react"]).toBe("./src/react/index.ts");
  });

  it("imports the real main entrypoint with all React runtime imports unavailable", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "--loader",
        fileURLToPath(new URL("./fixtures/no-react-loader.mjs", import.meta.url)),
        "--input-type=module",
        "--eval",
        'import { createCodeMirrorEditorBridge } from "@md-editor/editor"; console.log(typeof createCodeMirrorEditorBridge);',
      ],
      { cwd: packageRoot, encoding: "utf8", timeout: 15_000, stdio: "pipe" },
    );
    expect(stdout.trim()).toBe("function");
  }, 20_000);

  it("typechecks the main API without resolving React code or React types", () => {
    const configPath = ts.findConfigFile(packageRoot, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) throw new Error("Missing editor TypeScript configuration");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
    // Disable ambient workspace @types packages, then reject React in every explicit import.
    // A non-React consumer does not enable React's implicit JSX-runtime probes.
    const options = { ...parsed.options, jsx: ts.JsxEmit.Preserve, types: [], noEmit: true };
    const host = ts.createCompilerHost(options);
    const attempts: string[] = [];
    host.resolveModuleNames = (names, containingFile) =>
      names.map((name) => {
        if (isReact(name)) {
          attempts.push(name);
          return undefined;
        }
        return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
      });
    const program = ts.createProgram(
      [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      options,
      host,
    );
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.category === ts.DiagnosticCategory.Error);
    expect(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    expect(attempts).toEqual([]);
    expect(
      program.getSourceFiles().some((f) => /\/src\/react\/|\/@types\/react\//u.test(f.fileName)),
    ).toBe(false);
  }, 20_000);
});
