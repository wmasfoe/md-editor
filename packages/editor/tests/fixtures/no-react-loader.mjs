import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import ts from "typescript";

// Model a consumer without React even when the workspace installs it for adapter tests.
export function resolve(specifier, context, nextResolve) {
  if (/^(?:react|react-dom)(?:\/|$)/u.test(specifier)) {
    throw new Error(`The framework-independent entrypoint resolved ${specifier}`);
  }
  // Workspace source exports use bundler-style extensionless TypeScript imports.
  if (specifier.startsWith(".") && context.parentURL) {
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(specifier + suffix, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/u.test(url)) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
  }
  return nextLoad(url, context);
}
