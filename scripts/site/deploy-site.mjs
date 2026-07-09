import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const siteDir = path.join(repoRoot, "site");
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

// CI 发布必须显式提供 Vercel CLI 凭证；本地发布可以复用开发者本机登录态。
if (isCi) {
  for (const name of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]) {
    if (!process.env[name]) {
      throw new Error(`Missing ${name}; website deployment requires CLI-only Vercel credentials.`);
    }
  }
}

run("pnpm", ["--filter", "@md-editor/site", "build"]);

const deployArgs = ["exec", "vercel", "--cwd", siteDir, "--prod", "--yes"];
if (process.env.VERCEL_TOKEN) {
  deployArgs.push("--token", process.env.VERCEL_TOKEN);
}

run("pnpm", deployArgs);

function run(command, args) {
  console.log([command, ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg))].join(" "));
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}
