import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EXPECTED_COPIED_BODY,
  N13_EXPECTED_MALFORMED_MARKDOWN,
  prepareNativeEvidence,
  prepareN13NativeEvidence,
  verifyNativeEvidence,
  verifyN13NativeEvidence,
} from "./code-block-native-evidence.mjs";

const TEST_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("native-evidence"),
]);

test("prepares and verifies the exact N01-N12 native evidence contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "md-editor-native-evidence-"));
  try {
    const prepared = await prepareNativeEvidence(root, "20260723T000000Z");
    const notesPath = join(prepared.evidenceDirectory, "notes.md");
    const notes = (await readFile(notesPath, "utf8"))
      .replace("Build ID: PENDING", "Build ID: test-build")
      .replaceAll(": PENDING", ": PASS");
    await Promise.all([
      writeFile(notesPath, notes, "utf8"),
      writeFile(join(prepared.evidenceDirectory, "copied-body.txt"), EXPECTED_COPIED_BODY),
      writeFile(
        join(prepared.evidenceDirectory, "working.md"),
        await readFile(join(prepared.evidenceDirectory, "expected-saved.md")),
      ),
      writeFile(join(prepared.evidenceDirectory, "console.log"), "Tauri WebKit started\n"),
      writeFile(join(prepared.evidenceDirectory, "screen-source.png"), TEST_PNG),
      writeFile(join(prepared.evidenceDirectory, "screen-wysiwyg.png"), TEST_PNG),
    ]);

    const result = await verifyNativeEvidence(prepared.evidenceDirectory);
    assert.equal(result.rows.length, 12);
    assert.equal(result.lfOnly, true);

    await writeFile(join(prepared.evidenceDirectory, "copied-body.txt"), "wrong\n", "utf8");
    await assert.rejects(verifyNativeEvidence(prepared.evidenceDirectory), /exact fenced body/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares and verifies the exact post-fix N13 native evidence contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "md-editor-native-n13-evidence-"));
  try {
    const prepared = await prepareN13NativeEvidence(root, "20260724T000000Z");
    const notesPath = join(prepared.evidenceDirectory, "notes.md");
    const notes = (await readFile(notesPath, "utf8"))
      .replace("Build ID: PENDING", "Build ID: test-build")
      .replaceAll(": PENDING", ": PASS");
    await Promise.all([
      writeFile(notesPath, notes, "utf8"),
      writeFile(join(prepared.evidenceDirectory, "working.md"), N13_EXPECTED_MALFORMED_MARKDOWN),
      writeFile(join(prepared.evidenceDirectory, "console.log"), "Tauri WebKit started\n"),
      writeFile(join(prepared.evidenceDirectory, "n13-empty.png"), TEST_PNG),
      writeFile(join(prepared.evidenceDirectory, "n13-typed.png"), TEST_PNG),
      writeFile(join(prepared.evidenceDirectory, "n13-malformed.png"), TEST_PNG),
    ]);

    const result = await verifyN13NativeEvidence(prepared.evidenceDirectory);
    assert.deepEqual(result.rows, ["N13"]);
    assert.equal(result.checks.length, 7);
    assert.equal(result.lfOnly, true);

    await writeFile(join(prepared.evidenceDirectory, "working.md"), "wrong\n", "utf8");
    await assert.rejects(verifyN13NativeEvidence(prepared.evidenceDirectory), /exact N13 result/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
