import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const NATIVE_FIXTURE_ID = "M2-S3-NATIVE-01";
export const N13_NATIVE_FIXTURE_ID = "M2-S3-NATIVE-EMPTY-01";
export const EXPECTED_COPIED_BODY = [
  "const alpha = 1;",
  "const wrapped = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
  "",
].join("\n");

const SOURCE_MARKDOWN = [
  "# M2 native code-block acceptance",
  "",
  "Before",
  "",
  "```ts meta=keep",
  "const alpha = 1;",
  "const wrapped = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
  "```",
  "",
  "Between",
  "",
  "    indented one",
  "    indented two",
  "",
  "After",
  "",
].join("\n");

const EXPECTED_SAVED_MARKDOWN = SOURCE_MARKDOWN.replace(
  "const alpha = 1;\n",
  "const alpha = 1;\n// native-save\n",
);

const MALFORMED_MARKDOWN = [
  "# M2 malformed fallback",
  "",
  "Before",
  "",
  "~~~ts",
  "malformed body",
  "```",
  "",
].join("\n");

const N13_SOURCE_MARKDOWN = [
  "# M2 native empty fenced body acceptance",
  "",
  "Before",
  "",
  "```js",
  "```",
  "",
  "After",
  "",
].join("\n");

export const N13_EXPECTED_MALFORMED_MARKDOWN = N13_SOURCE_MARKDOWN.replace(
  "```js\n```",
  "```js\n``",
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ROW_IDS = Array.from({ length: 12 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`);
const N13_CHECKS = Object.freeze([
  "Direct typing",
  "Pointer entry",
  "Enter materialization",
  "Undo/redo",
  "WYSIWYG Backspace protection",
  "Source single-backtick fail-open",
  "Later paragraph unindented",
]);

export async function prepareNativeEvidence(
  outputRoot = "/private/tmp/md-editor-m2-s3-code-blocks",
  timestamp = utcTimestamp(),
) {
  const evidenceDirectory = resolve(outputRoot, timestamp);
  await mkdir(evidenceDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(evidenceDirectory, "source-before-save.md"), SOURCE_MARKDOWN, "utf8"),
    writeFile(resolve(evidenceDirectory, "working.md"), SOURCE_MARKDOWN, "utf8"),
    writeFile(resolve(evidenceDirectory, "expected-saved.md"), EXPECTED_SAVED_MARKDOWN, "utf8"),
    writeFile(resolve(evidenceDirectory, "malformed.md"), MALFORMED_MARKDOWN, "utf8"),
    writeFile(resolve(evidenceDirectory, "notes.md"), createNotesTemplate(timestamp), "utf8"),
    writeFile(resolve(evidenceDirectory, "console.log"), "", "utf8"),
  ]);
  return Object.freeze({ evidenceDirectory, fixtureId: NATIVE_FIXTURE_ID });
}

export async function verifyNativeEvidence(evidenceDirectory) {
  const directory = resolve(evidenceDirectory);
  const [notes, copiedBody, sourceBeforeSave, savedMarkdown, expectedSaved, consoleLog] =
    await Promise.all([
      readRequiredText(directory, "notes.md"),
      readRequiredText(directory, "copied-body.txt"),
      readRequiredText(directory, "source-before-save.md"),
      readRequiredText(directory, "working.md"),
      readRequiredText(directory, "expected-saved.md"),
      readRequiredText(directory, "console.log"),
    ]);

  assertEqual(sourceBeforeSave, SOURCE_MARKDOWN, "source-before-save.md changed");
  assertEqual(copiedBody, EXPECTED_COPIED_BODY, "copied-body.txt is not the exact fenced body");
  assertEqual(expectedSaved, EXPECTED_SAVED_MARKDOWN, "expected-saved.md changed");
  assertEqual(savedMarkdown, EXPECTED_SAVED_MARKDOWN, "working.md is not the exact saved result");
  assertNoCarriageReturns(savedMarkdown, "working.md");
  assertNoCarriageReturns(copiedBody, "copied-body.txt");
  assertNotesComplete(notes);
  if (consoleLog.trim().length === 0) {
    throw new Error("console.log is empty");
  }
  await Promise.all([
    assertPng(resolve(directory, "screen-source.png")),
    assertPng(resolve(directory, "screen-wysiwyg.png")),
  ]);

  return Object.freeze({
    evidenceDirectory: directory,
    fixtureId: NATIVE_FIXTURE_ID,
    rows: Object.freeze([...ROW_IDS]),
    copiedBodyBytes: Buffer.byteLength(copiedBody),
    savedMarkdownBytes: Buffer.byteLength(savedMarkdown),
    lfOnly: true,
  });
}

export async function prepareN13NativeEvidence(
  outputRoot = "/private/tmp/md-editor-m2-s3-code-blocks",
  timestamp = utcTimestamp(),
) {
  const evidenceDirectory = resolve(outputRoot, `${timestamp}-n13`);
  await mkdir(evidenceDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(evidenceDirectory, "source.md"), N13_SOURCE_MARKDOWN, "utf8"),
    writeFile(resolve(evidenceDirectory, "working.md"), N13_SOURCE_MARKDOWN, "utf8"),
    writeFile(
      resolve(evidenceDirectory, "expected-malformed.md"),
      N13_EXPECTED_MALFORMED_MARKDOWN,
      "utf8",
    ),
    writeFile(resolve(evidenceDirectory, "notes.md"), createN13NotesTemplate(timestamp), "utf8"),
    writeFile(resolve(evidenceDirectory, "console.log"), "", "utf8"),
  ]);
  return Object.freeze({ evidenceDirectory, fixtureId: N13_NATIVE_FIXTURE_ID });
}

export async function verifyN13NativeEvidence(evidenceDirectory) {
  const directory = resolve(evidenceDirectory);
  const [notes, source, working, expectedMalformed, consoleLog] = await Promise.all([
    readRequiredText(directory, "notes.md"),
    readRequiredText(directory, "source.md"),
    readRequiredText(directory, "working.md"),
    readRequiredText(directory, "expected-malformed.md"),
    readRequiredText(directory, "console.log"),
  ]);

  assertEqual(source, N13_SOURCE_MARKDOWN, "source.md changed");
  assertEqual(expectedMalformed, N13_EXPECTED_MALFORMED_MARKDOWN, "expected-malformed.md changed");
  assertEqual(working, N13_EXPECTED_MALFORMED_MARKDOWN, "working.md is not the exact N13 result");
  assertNoCarriageReturns(working, "working.md");
  assertN13NotesComplete(notes);
  if (consoleLog.trim().length === 0) {
    throw new Error("console.log is empty");
  }
  await Promise.all([
    assertPng(resolve(directory, "n13-empty.png")),
    assertPng(resolve(directory, "n13-typed.png")),
    assertPng(resolve(directory, "n13-malformed.png")),
  ]);

  return Object.freeze({
    evidenceDirectory: directory,
    fixtureId: N13_NATIVE_FIXTURE_ID,
    rows: Object.freeze(["N13"]),
    checks: N13_CHECKS,
    savedMarkdownBytes: Buffer.byteLength(working),
    lfOnly: true,
  });
}

function createNotesTemplate(timestamp) {
  const rows = ROW_IDS.map((row) => `${row}: PENDING`).join("\n");
  return `# M2/S3 Native Acceptance

Fixture ID: ${NATIVE_FIXTURE_ID}
Build ID: PENDING
UTC: ${timestamp}

## Runbook

1. Start the product app with \`pnpm tauri dev --no-watch\` and append terminal output to \`console.log\`.
2. Open \`working.md\`, keep one editor visible, and exercise source/WYSIWYG mode switching.
3. Run N01-N11 against the fenced and indented blocks. Undo every exploratory edit.
4. Use the fenced toolbar Copy action and save the clipboard as \`copied-body.txt\`.
5. Insert \`// native-save\` immediately after \`const alpha = 1;\`, save with Cmd+S, and leave \`working.md\` at that exact state.
6. Open \`malformed.md\`, confirm raw fail-open editing, repair the closing fence to \`~~~\`, then undo.
7. Save source and WYSIWYG screenshots as \`screen-source.png\` and \`screen-wysiwyg.png\`.
8. Replace each PENDING below with PASS only after observing the row in the real Tauri/WebKit app.

## Results

${rows}
`;
}

function createN13NotesTemplate(timestamp) {
  const checks = N13_CHECKS.map((check) => `${check}: PENDING`).join("\n");
  return `# M2/S3 Native N13 Acceptance

Fixture ID: ${N13_NATIVE_FIXTURE_ID}
Build ID: PENDING
UTC: ${timestamp}

## Runbook

1. Start the current product app in real Tauri/WebKit and open \`working.md\`.
2. In WYSIWYG, confirm the empty fenced body has one visible caret line.
3. Verify direct typing, pointer entry, Enter materialization, and one-step undo/redo.
4. Verify Backspace at the empty body boundary does not remove the hidden fence.
5. In source mode, delete one backtick from the closing fence and save.
6. Confirm WYSIWYG fails open to raw source and \`After\` is not rendered as indented code.
7. Save \`n13-empty.png\`, \`n13-typed.png\`, and \`n13-malformed.png\`.
8. Replace every PENDING below only after observing the behavior in the native app.

## Results

N13: PENDING
${checks}
`;
}

function assertNotesComplete(notes) {
  if (!notes.includes(`Fixture ID: ${NATIVE_FIXTURE_ID}`)) {
    throw new Error(`notes.md must identify fixture ${NATIVE_FIXTURE_ID}`);
  }
  if (!/^Build ID: (?!PENDING\s*$)\S.+$/mu.test(notes)) {
    throw new Error("notes.md must contain a non-placeholder Build ID");
  }
  for (const row of ROW_IDS) {
    if (!new RegExp(`^${row}: PASS(?:\\s|$)`, "mu").test(notes)) {
      throw new Error(`notes.md does not record ${row}: PASS`);
    }
  }
}

function assertN13NotesComplete(notes) {
  if (!notes.includes(`Fixture ID: ${N13_NATIVE_FIXTURE_ID}`)) {
    throw new Error(`notes.md must identify fixture ${N13_NATIVE_FIXTURE_ID}`);
  }
  if (!/^Build ID: (?!PENDING\s*$)\S.+$/mu.test(notes)) {
    throw new Error("notes.md must contain a non-placeholder Build ID");
  }
  if (!/^N13: PASS(?:\s|$)/mu.test(notes)) {
    throw new Error("notes.md does not record N13: PASS");
  }
  for (const check of N13_CHECKS) {
    if (!new RegExp(`^${escapeRegExp(check)}: PASS(?:\\s|$)`, "mu").test(notes)) {
      throw new Error(`notes.md does not record ${check}: PASS`);
    }
  }
}

async function assertPng(path) {
  const contents = await readFile(path).catch(() => {
    throw new Error(`Missing required PNG: ${path}`);
  });
  if (contents.length <= PNG_SIGNATURE.length || !contents.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid or empty PNG: ${path}`);
  }
}

async function readRequiredText(directory, fileName) {
  const path = resolve(directory, fileName);
  return readFile(path, "utf8").catch(() => {
    throw new Error(`Missing required evidence file: ${path}`);
  });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

function assertNoCarriageReturns(value, fileName) {
  if (value.includes("\r")) throw new Error(`${fileName} contains CR bytes`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function utcTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

async function runCli() {
  const [command, argument] = process.argv.slice(2);
  if (command === "prepare") {
    console.log(JSON.stringify(await prepareNativeEvidence(argument), null, 2));
    return;
  }
  if (command === "verify" && argument) {
    console.log(JSON.stringify(await verifyNativeEvidence(argument), null, 2));
    return;
  }
  if (command === "prepare-n13") {
    console.log(JSON.stringify(await prepareN13NativeEvidence(argument), null, 2));
    return;
  }
  if (command === "verify-n13" && argument) {
    console.log(JSON.stringify(await verifyN13NativeEvidence(argument), null, 2));
    return;
  }
  throw new Error(
    "Usage: node code-block-native-evidence.mjs prepare [output-root] | verify <evidence-directory> | prepare-n13 [output-root] | verify-n13 <evidence-directory>",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
