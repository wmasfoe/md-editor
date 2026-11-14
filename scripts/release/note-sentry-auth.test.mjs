import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "note-sentry-auth.mjs");

function run(env, args = []) {
  try {
    const output = execFileSync(process.execPath, [script, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    if (!error || typeof error !== "object" || !("status" in error)) {
      throw error;
    }
    const failed = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    const stdout = typeof failed.stdout === "string" ? failed.stdout : "";
    const stderr = typeof failed.stderr === "string" ? failed.stderr : "";
    return { status: failed.status ?? 1, output: `${stdout}${stderr}` };
  }
}

function childEnv(overrides) {
  const env = { ...process.env };
  delete env.SENTRY_AUTH_TOKEN;
  delete env.GITHUB_ACTIONS;
  return { ...env, ...overrides };
}

test("missing token warns and still exits 0", () => {
  const result = run(childEnv({ GITHUB_ACTIONS: "true" }));
  assert.equal(result.status, 0);
  assert.match(result.output, /::warning::/u);
  assert.match(result.output, /project:releases/u);
  assert.match(result.output, /org:read/u);
  assert.equal(result.output.includes("SENTRY_AUTH_TOKEN is set"), false);
  assert.equal(result.output.includes("::error::"), false);
});

test("a present token is not echoed", () => {
  const secret = "sntrys_test_token_value";
  const result = run(childEnv({ SENTRY_AUTH_TOKEN: `  ${secret}  `, GITHUB_ACTIONS: "false" }), [
    "--require",
  ]);
  assert.equal(result.status, 0);
  assert.match(result.output, /SENTRY_AUTH_TOKEN is set/u);
  assert.match(result.output, /inkpoint@<version>/u);
  assert.equal(result.output.includes(secret), false);
  assert.equal(result.output.includes("::warning::"), false);
  assert.equal(result.output.includes("::error::"), false);
});

test("whitespace token is treated as missing outside GitHub Actions", () => {
  const result = run(childEnv({ SENTRY_AUTH_TOKEN: "   " }));
  assert.equal(result.status, 0);
  assert.match(result.output, /^\[sentry\] SENTRY_AUTH_TOKEN is not set/u);
});

test("--require exits 1 when the token is missing", () => {
  const result = run(childEnv({ GITHUB_ACTIONS: "true" }), ["--require"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /::error::/u);
  assert.match(result.output, /Refusing the stable desktop release/u);
  assert.match(result.output, /project:releases/u);
  assert.match(result.output, /org:read/u);
  assert.equal(result.output.includes("::warning::"), false);
});

test("--require treats a blank token as missing outside Actions", () => {
  const result = run(childEnv({ SENTRY_AUTH_TOKEN: "   " }), ["--require"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /^\[sentry\] SENTRY_AUTH_TOKEN is not set/u);
  assert.match(result.output, /Refusing the stable desktop release/u);
  assert.equal(result.output.includes("::error::"), false);
  assert.equal(result.output.includes("::warning::"), false);
});
