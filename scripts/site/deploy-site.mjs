import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const siteDir = path.join(repoRoot, "site");
const rootChangelogPath = path.join(repoRoot, "CHANGELOG.md");
// 约定：.vercel 只放在 monorepo 根。Vercel Root Directory=site，CLI cwd=仓库根。
const rootVercelDir = path.join(repoRoot, ".vercel");
const legacySiteVercelDir = path.join(siteDir, ".vercel");
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

migrateLegacySiteVercelLink();

const vercelBin = resolveVercelBin();
const tokenArgs = process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : [];

// 预构建在 monorepo 完整 checkout 中执行，静态页已嵌入 CHANGELOG；
// deploy --prebuilt 只上传产物，避免 Vercel 远程再 build 时丢 monorepo 上下文。
runVercel(["pull", "--yes", "--environment", "production", ...tokenArgs]);
assertProjectRootDirectory();
runVercel(["build", "--prod", ...tokenArgs]);
runVercel(["deploy", "--prebuilt", "--prod", "--yes", ...tokenArgs]);

/**
 * 历史遗留：曾在 site/ 下 vercel link。统一迁到仓库根 .vercel/，之后只认根目录。
 */
function migrateLegacySiteVercelLink() {
  const rootProject = path.join(rootVercelDir, "project.json");
  const legacyProject = path.join(legacySiteVercelDir, "project.json");

  if (!fs.existsSync(legacyProject)) {
    return;
  }

  if (!fs.existsSync(rootProject)) {
    fs.mkdirSync(rootVercelDir, { recursive: true });
    for (const name of fs.readdirSync(legacySiteVercelDir)) {
      // output 是构建产物缓存，不必迁到根。
      if (name === "output") {
        continue;
      }
      const from = path.join(legacySiteVercelDir, name);
      const to = path.join(rootVercelDir, name);
      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, to);
      }
    }
    console.log(`Migrated Vercel link: ${legacySiteVercelDir} -> ${rootVercelDir}`);
  }

  console.warn(
    `Legacy ${legacySiteVercelDir} is ignored. Safe to delete it; use monorepo-root .vercel only.`,
  );
}

function assertProjectRootDirectory() {
  const projectPath = path.join(rootVercelDir, "project.json");
  if (!fs.existsSync(projectPath)) {
    return;
  }

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const rootDirectory = project?.settings?.rootDirectory;

  // 本仓库约定：Vercel Root Directory = site，CLI cwd = monorepo 根，.vercel 在 monorepo 根。
  if (rootDirectory && rootDirectory !== "site" && rootDirectory !== "./site") {
    throw new Error(
      `Unexpected Vercel rootDirectory "${rootDirectory}". Expected "site" so CLI can run from the monorepo root with .vercel at the repo root.`,
    );
  }

  if (!rootDirectory) {
    console.warn(
      'Warning: Vercel project rootDirectory is empty. Prefer setting Root Directory to "site" and keeping .vercel at the monorepo root.',
    );
  }
}

function resolveVercelBin() {
  const candidates = [
    path.join(siteDir, "node_modules", ".bin", "vercel"),
    path.join(repoRoot, "node_modules", ".bin", "vercel"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "vercel CLI not found under site/node_modules; run `pnpm install` from the repo root first.",
  );
}

function runVercel(args) {
  // cwd 固定 monorepo 根：读取根目录 .vercel，匹配 rootDirectory=site。
  run(vercelBin, args, repoRoot);
}

function run(command, args, cwd = repoRoot) {
  console.log(
    [command, ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg))].join(" "),
  );
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}
