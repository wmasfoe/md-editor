import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { expect, it } from "vitest";
import viteConfig from "../vite.config";

const require = createRequire(import.meta.url);
const editorRequire = createRequire(require.resolve("@md-editor/editor"));
const lintRequire = createRequire(editorRequire.resolve("markdownlint/sync"));

// esbuild lowers unsupported literals to RegExp constructors. Chromium 108 rejects their v flag.
function LegacyRegExp(pattern: string, flags?: string) {
  if (flags?.includes("v")) throw new SyntaxError("Unsupported RegExp v flag");
  return new RegExp(pattern, flags);
}

it("bundles markdownlint's display width dependency for Chromium 108", async () => {
  const result = await build({
    ...viteConfig,
    configFile: false,
    logLevel: "silent",
    build: {
      ...viteConfig.build,
      lib: { entry: lintRequire.resolve("string-width"), formats: ["cjs"], fileName: "width" },
      write: false,
    },
  });
  const [bundle] = Array.isArray(result) ? result : [result];
  if (!bundle || !("output" in bundle)) throw new Error("Expected build output");
  const entry = bundle.output.find((file) => file.type === "chunk" && file.isEntry);
  if (!entry || entry.type !== "chunk") throw new Error("Expected a bundled entry");

  const module = { exports: null as ((value: string) => number) | null };
  runInNewContext(entry.code, { module, RegExp: LegacyRegExp });
  expect(module.exports?.("汉👩🏽‍💻")).toBe(4);
});
