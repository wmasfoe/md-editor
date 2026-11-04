import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNoShippedSourcemaps,
  fileContains,
  findShippedSourcemaps,
  hasSourceMappingComment,
  stripSourcemaps,
  stripSourceMappingUrl,
} from "./sourcemaps.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sourcemaps-"));
}

test("stripSourceMappingUrl removes JS and CSS comments and keeps debug ids", () => {
  const source = [
    "console.log(1);",
    "//# sourceMappingURL=index.js.map",
    "/*# sourceMappingURL=app.css.map */",
    "//@ sourceMappingURL=legacy.js.map",
    "//# debugId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "var sourceMappingURL = 'not-a-comment';",
  ].join("\n");
  const stripped = stripSourceMappingUrl(source);
  assert.equal(stripped.includes("sourceMappingURL="), false);
  assert.match(stripped, /debugId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/u);
  assert.match(stripped, /var sourceMappingURL = 'not-a-comment'/u);
  assert.equal(hasSourceMappingComment(stripped), false);
});

test("stripSourcemaps deletes nested maps and rewrites shipped text", () => {
  const root = tempDir();
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "index.js"), "code;\n//# sourceMappingURL=index.js.map\n");
  fs.writeFileSync(path.join(assets, "index.js.map"), '{"version":3,"file":"index.js"}');
  fs.writeFileSync(path.join(assets, "app.css"), "body{}\n/*# sourceMappingURL=app.css.map */\n");
  fs.writeFileSync(path.join(assets, "app.css.map"), "{}");
  fs.writeFileSync(
    path.join(assets, "kept.js"),
    "ok;\n//# debugId=11111111-2222-3333-4444-555555555555\n",
  );

  const result = stripSourcemaps(root);
  assert.equal(result.mapFilesRemoved, 2);
  assert.equal(result.filesRewritten, 2);
  assert.equal(fs.existsSync(path.join(assets, "index.js.map")), false);
  assert.equal(fs.existsSync(path.join(assets, "app.css.map")), false);
  assert.equal(
    fs.readFileSync(path.join(assets, "index.js"), "utf8").includes("sourceMappingURL"),
    false,
  );
  assert.match(
    fs.readFileSync(path.join(assets, "kept.js"), "utf8"),
    /debugId=11111111-2222-3333-4444-555555555555/u,
  );
  assert.deepEqual(findShippedSourcemaps([root]), []);
});

test("bundled postcss sourceMappingURL strings are not shipped comments", () => {
  const root = tempDir();
  const source =
    'let p="\\n";this.css+=p+"/*# sourceMappingURL="+g+" */";f.text.startsWith("# sourceMappingURL=")';
  fs.writeFileSync(path.join(root, "about.js"), source);
  assert.equal(hasSourceMappingComment(source), false);
  assert.equal(stripSourceMappingUrl(source), source);
  assert.deepEqual(findShippedSourcemaps([root]), []);
});

test("assertNoShippedSourcemaps fails when a map file or comment remains", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "app.js"), "x\n//# sourceMappingURL=app.js.map\n");
  assert.throws(() => assertNoShippedSourcemaps([root]), /sourceMappingURL/u);

  fs.writeFileSync(path.join(root, "app.js"), "x\n");
  fs.writeFileSync(path.join(root, "app.js.map"), "{}");
  assert.throws(() => assertNoShippedSourcemaps([root]), /sourcemap file/u);
});

test("findShippedSourcemaps fails when a directory is missing", () => {
  const missing = path.join(tempDir(), "does-not-exist");
  const violations = findShippedSourcemaps([missing]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /does not exist/u);
});

test("fileContains finds a needle that spans read chunks", () => {
  const root = tempDir();
  const file = path.join(root, "blob.bin");
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(10, 0x61), Buffer.from("sourceMappingURL")]));
  assert.equal(fileContains(file, "sourceMappingURL", 8), true);
  assert.equal(fileContains(file, "not-present", 8), false);
});

test("archive members named .map fail the guard", () => {
  let tar;
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
    tar = true;
  } catch {
    tar = false;
  }
  if (!tar) return;

  const root = tempDir();
  const payload = path.join(root, "payload");
  fs.mkdirSync(payload);
  fs.writeFileSync(path.join(payload, "app.js.map"), "{}");
  const archive = path.join(root, "bundle.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", payload, "app.js.map"]);
  fs.rmSync(payload, { recursive: true });

  const violations = findShippedSourcemaps([archive]);
  assert.ok(violations.some((item) => item.includes("app.js.map")));
});
