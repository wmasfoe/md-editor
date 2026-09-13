import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  usage,
  deployWeb,
  DEFAULT_WEB_PROJECT_ID,
  DEFAULT_VERCEL_ORG_ID,
  DEFAULT_WEB_PROJECT_NAME,
} from "../web/deploy-web.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

test("parseArgs parses flags correctly", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, help: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true, help: false });
  assert.deepEqual(parseArgs(["--help"]), { dryRun: false, help: true });
  assert.deepEqual(parseArgs(["-h"]), { dryRun: false, help: true });
  assert.throws(() => parseArgs(["--invalid"]), /Unexpected argument: --invalid/u);
});

test("usage contains release:web and Vercel CLI instructions", () => {
  const text = usage();
  assert.match(text, /pnpm release:web/u);
  assert.match(text, /Desktop App installers/u);
  assert.match(text, /--dry-run/u);
});

test("apps/web/vercel.json explicitly disables git auto deployments", () => {
  const vercelJsonPath = path.join(repoRoot, "apps/web/vercel.json");
  assert.ok(fs.existsSync(vercelJsonPath), "apps/web/vercel.json must exist");

  const config = JSON.parse(fs.readFileSync(vercelJsonPath, "utf8"));
  assert.equal(
    config.git?.deploymentEnabled,
    false,
    "apps/web/vercel.json must have git.deploymentEnabled set to false to prevent auto deployments on PR merges",
  );
});

test("deploy constants are defined", () => {
  assert.equal(DEFAULT_WEB_PROJECT_ID, "prj_OYIhjN5VFmxwa5t8v9ydZywt0f3O");
  assert.equal(DEFAULT_VERCEL_ORG_ID, "team_T5HZzs5DBSs79DWD9f1YADyM");
  assert.equal(DEFAULT_WEB_PROJECT_NAME, "md-editor-web");
});

test("deployWeb dry-run succeeds without modifying filesystem", () => {
  const rootVercelProjectJson = path.join(repoRoot, ".vercel/project.json");
  const beforeExists = fs.existsSync(rootVercelProjectJson);
  const beforeContent = beforeExists ? fs.readFileSync(rootVercelProjectJson, "utf8") : null;

  assert.doesNotThrow(() => {
    deployWeb({ dryRun: true });
  });

  const afterExists = fs.existsSync(rootVercelProjectJson);
  const afterContent = afterExists ? fs.readFileSync(rootVercelProjectJson, "utf8") : null;

  assert.equal(beforeExists, afterExists, "dryRun must not create or delete .vercel/project.json");
  assert.equal(beforeContent, afterContent, "dryRun must not modify .vercel/project.json");
});
