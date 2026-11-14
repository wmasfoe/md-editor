import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "note-sentry-auth.mjs");

function run(env) {
  return execFileSync(process.execPath, [script], {
    env,
    encoding: "utf8",
  });
}

function childEnv(overrides) {
  const env = { ...process.env };
  delete env.SENTRY_AUTH_TOKEN;
  delete env.GITHUB_ACTIONS;
  return { ...env, ...overrides };
}

test("missing token warns and still exits 0", () => {
  const output = run(childEnv({ GITHUB_ACTIONS: "true" }));
  assert.match(output, /::warning::/u);
  assert.match(output, /project:releases/u);
  assert.match(output, /org:read/u);
  assert.equal(output.includes("SENTRY_AUTH_TOKEN is set"), false);
});

test("a present token is not echoed", () => {
  const secret = "sntrys_test_token_value";
  const output = run(childEnv({ SENTRY_AUTH_TOKEN: `  ${secret}  `, GITHUB_ACTIONS: "false" }));
  assert.match(output, /SENTRY_AUTH_TOKEN is set/u);
  assert.match(output, /inkpoint@<version>/u);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("::warning::"), false);
});

test("whitespace token is treated as missing outside GitHub Actions", () => {
  const output = run(childEnv({ SENTRY_AUTH_TOKEN: "   " }));
  assert.match(output, /^\[sentry\] SENTRY_AUTH_TOKEN is not set/u);
});
