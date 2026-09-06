#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const gitHooksDir = path.join(rootDir, ".git", "hooks");
const sourceHooksDir = path.join(__dirname, "hooks");

if (!fs.existsSync(gitHooksDir)) {
  console.log("ℹ️ No .git/hooks directory found. Skipping hook installation.");
  process.exit(0);
}

const hooks = ["commit-msg", "pre-push"];

for (const hook of hooks) {
  const src = path.join(sourceHooksDir, hook);
  const dest = path.join(gitHooksDir, hook);

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`✅ Installed Git hook: ${hook}`);
  }
}

console.log("🎉 Git hooks successfully installed and active.");
