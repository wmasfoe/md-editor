import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rewriteImports } from "./build.mjs";

test("emitted ESM paths include extensions, directory indexes and import types", () => {
  const dir = mkdtempSync(join(tmpdir(), "inkpoint-build-"));
  try {
    mkdirSync(join(dir, "nested"));
    for (const file of ["leaf.js", "leaf.d.ts", "nested/index.js", "nested/index.d.ts"])
      writeFileSync(join(dir, file), "");
    const source =
      'export * from "./leaf.ts"; export * from "./nested"; type T = import("./leaf").T; import "./style.css"; import("./nested");';
    const output = rewriteImports(source, join(dir, "index.d.ts"));
    assert.match(output, /from "\.\/leaf.js"/);
    assert.match(output, /from "\.\/nested\/index.js"/);
    assert.match(output, /import\("\.\/leaf.js"\)/);
    assert.match(output, /import "\.\/style.css"/);
    assert.match(output, /import\("\.\/nested\/index.js"\)/);
    assert.throws(
      () => rewriteImports('import "./missing";', join(dir, "index.js")),
      /Unresolved emitted import/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
