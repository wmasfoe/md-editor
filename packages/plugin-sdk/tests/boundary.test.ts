import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public SDK dependency boundary", () => {
  it("keeps app, host and editor implementations out of the author package", () => {
    const directory = new URL("../src/", import.meta.url);
    const source = readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(new URL(name, directory), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /@md-editor\/(?:plugin-host|editor-core|renderer-codemirror|syntax-plugins|mdx-plugins)|@tauri-apps|from ["']react/,
    );
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    // The SDK ships only types plus the definePlugin identity helper, so it must
    // not pull in any runtime dependencies. CodeMirror/Lezer are type-only and are
    // declared as optional peer dependencies, never hard dependencies.
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(
      Object.keys(manifest.peerDependencies ?? {}).every((name) =>
        /^(?:@codemirror|@lezer)\//.test(name),
      ),
    ).toBe(true);
  });
});
