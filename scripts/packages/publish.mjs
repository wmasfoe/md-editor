import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Ensure npm authentication environment variables are mapped for both pnpm and npm.
if (process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
}

console.log("==> Running package build and distribution verification...");
execFileSync("pnpm", ["verify:packages"], { cwd: root, stdio: "inherit", env: process.env });

console.log("==> Publishing updated packages via Changesets...");
execFileSync("pnpm", ["exec", "changeset", "publish"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
