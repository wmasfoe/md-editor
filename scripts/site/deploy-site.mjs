import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const siteDir = path.join(repoRoot, "site");
const rootChangelogPath = path.join(repoRoot, "CHANGELOG.md");
const rootVercelDir = path.join(repoRoot, ".vercel");
const siteVercelDir = path.join(siteDir, ".vercel");
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

// CI 发布必须显式提供 Vercel CLI 凭证；本地发布可以复用开发者本机登录态。
if (isCi) {
  for (const name of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]) {
    if (!process.env[name]) {
      throw new Error(`Missing ${name}; website deployment requires CLI-only Vercel credentials.`);
    }
  }
}

if (!fs.existsSync(rootChangelogPath)) {
  throw new Error(`Missing ${rootChangelogPath}; website changelog cannot be built.`);
}

// Vercel 项目 Root Directory 配置为 site/ 时，CLI 必须以 monorepo 根为 cwd，
// 否则会拼出 site/site/package.json。本地若只在 site/ 做过 link，这里同步到根目录。
ensureRootVercelLink();

const vercelBin = resolveVercelBin();
const tokenArgs = process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : [];

// 预构建在 monorepo 完整 checkout 中执行，静态页已嵌入 CHANGELOG；
// deploy --prebuilt 只上传产物，避免 Vercel 远程再 build 时丢 monorepo 上下文。
runVercel(["pull", "--yes", "--environment", "production", ...tokenArgs]);
assertProjectRootDirectory();
runVercel(["build", "--prod", ...tokenArgs]);
runVercel(["deploy", "--prebuilt", "--prod", "--yes", ...tokenArgs]);

function ensureRootVercelLink() {
  const rootProject = path.join(rootVercelDir, "project.json");
  const siteProject = path.join(siteVercelDir, "project.json");

  if (fs.existsSync(rootProject)) {
    return;
  }

  if (!fs.existsSync(siteProject)) {
    // CI 仅靠 VERCEL_ORG_ID / VERCEL_PROJECT_ID 时，pull 会在 monorepo 根生成 .vercel。
    return;
  }

  fs.mkdirSync(rootVercelDir, { recursive: true });
  fs.copyFileSync(siteProject, rootProject);
  console.log(`Synced Vercel project link: ${siteProject} -> ${rootProject}`);
}

function assertProjectRootDirectory() {
  const projectPath = path.join(rootVercelDir, "project.json");
  if (!fs.existsSync(projectPath)) {
    return;
  }

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const rootDirectory = project?.settings?.rootDirectory;

  // 本仓库约定：Vercel Root Directory = site，CLI cwd = monorepo 根。
  if (rootDirectory && rootDirectory !== "site" && rootDirectory !== "./site") {
    throw new Error(
      `Unexpected Vercel rootDirectory "${rootDirectory}". Expected "site" so CLI can run from the monorepo root. Update the Vercel project Root Directory setting.`
    );
  }

  if (!rootDirectory) {
    console.warn(
      'Warning: Vercel project rootDirectory is empty. Prefer setting Root Directory to "site" and deploying from the monorepo root.'
    );
  }
}

function resolveVercelBin() {
  const candidates = [
    path.join(siteDir, "node_modules", ".bin", "vercel"),
    path.join(repoRoot, "node_modules", ".bin", "vercel")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "vercel CLI not found under site/node_modules; run `pnpm install` from the repo root first."
  );
}

function runVercel(args) {
  // cwd 固定 monorepo 根：匹配 Vercel 项目 rootDirectory=site，并保留对 CHANGELOG.md 的访问。
  run(vercelBin, args, repoRoot);
}

function run(command, args, cwd = repoRoot) {
  console.log([command, ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg))].join(" "));
  execFileSync(command, args, {
    cwd,
    stdio: "inherit"
  });
}
