import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const webDir = path.join(repoRoot, "apps/web");
const webChangelogPath = path.join(webDir, "CHANGELOG.md");
const rootVercelDir = path.join(repoRoot, ".vercel");
const rootProjectJsonPath = path.join(rootVercelDir, "project.json");
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

const DEFAULT_WEB_PROJECT_ID = "prj_OYIhjN5VFmxwa5t8v9ydZywt0f3O";
const DEFAULT_VERCEL_ORG_ID = "team_T5HZzs5DBSs79DWD9f1YADyM";
const DEFAULT_WEB_PROJECT_NAME = "md-editor-web";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return `Usage:
  pnpm release:web [--dry-run]
  node scripts/web/deploy-web.mjs [--dry-run]

Description:
  Deploy the Web application (@md-editor/web) directly to Vercel production using CLI-only prebuilt deployment.
  Follows the same architecture as scripts/site/deploy-site.mjs.
  Does not create GitHub Releases, keeping the repository release page dedicated to Desktop App installers.

Options:
  --dry-run    Print commands without executing them.
  --help, -h   Show this help message.`;
}

function resolveVercelBin() {
  const candidates = [
    path.join(repoRoot, "site/node_modules/.bin/vercel"),
    path.join(repoRoot, "node_modules/.bin/vercel"),
    path.join(repoRoot, "node_modules/.pnpm/node_modules/.bin/vercel"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const whichResult = execFileSync("which", ["vercel"], { encoding: "utf8" }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult;
    }
  } catch {
    // which failed, continue to error
  }

  throw new Error("vercel CLI not found. Run `pnpm install` from repository root first.");
}

function run(command, args, options = {}) {
  const formatted = [
    command,
    ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg)),
  ].join(" ");

  if (options.dryRun) {
    console.log(`[dry-run] ${formatted}`);
    return;
  }

  console.log(`> ${formatted}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
  });
}

function deployWeb(options = {}) {
  if (isCi && !options.dryRun) {
    if (!process.env.VERCEL_TOKEN) {
      throw new Error("Missing VERCEL_TOKEN in CI environment; deployment requires Vercel token.");
    }
  }

  if (!fs.existsSync(webDir)) {
    throw new Error(`Directory ${webDir} does not exist.`);
  }

  if (!fs.existsSync(webChangelogPath)) {
    throw new Error(`Missing ${webChangelogPath}; web changelog cannot be verified.`);
  }

  const vercelBin = resolveVercelBin();
  const tokenArgs = process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : [];

  const projectId = process.env.VERCEL_WEB_PROJECT_ID || DEFAULT_WEB_PROJECT_ID;
  const orgId = process.env.VERCEL_ORG_ID || DEFAULT_VERCEL_ORG_ID;
  const projectName = DEFAULT_WEB_PROJECT_NAME;

  const webProjectConfig = {
    projectId,
    orgId,
    projectName,
    settings: {
      framework: "vite",
      rootDirectory: "apps/web",
    },
  };

  let originalProjectJson = null;
  const projectJsonExisted = fs.existsSync(rootProjectJsonPath);

  if (projectJsonExisted) {
    originalProjectJson = fs.readFileSync(rootProjectJsonPath, "utf8");
  }

  if (!options.dryRun) {
    if (!fs.existsSync(rootVercelDir)) {
      fs.mkdirSync(rootVercelDir, { recursive: true });
    }
    fs.writeFileSync(rootProjectJsonPath, JSON.stringify(webProjectConfig, null, 2), "utf8");
  } else {
    console.log(`[dry-run] Would write web project configuration to ${rootProjectJsonPath}`);
  }

  try {
    console.log("\n1. 拉取 md-editor-web 生产环境配置 (Vercel pull)...");
    run(vercelBin, ["pull", "--yes", "--environment", "production", ...tokenArgs], {
      dryRun: options.dryRun,
    });

    console.log("\n2. 构建 Web 端生产环境产物 (Vercel build --prod)...");
    run(vercelBin, ["build", "--prod", ...tokenArgs], {
      dryRun: options.dryRun,
    });

    console.log("\n3. 部署预构建产物至 Vercel 生产环境 (Vercel deploy --prebuilt)...");
    run(vercelBin, ["deploy", "--prebuilt", "--prod", "--yes", ...tokenArgs], {
      dryRun: options.dryRun,
    });

    console.log("\n🎉 Web 在线端已成功发布至 Vercel 生产环境！");
  } finally {
    if (!options.dryRun) {
      if (projectJsonExisted && originalProjectJson !== null) {
        fs.writeFileSync(rootProjectJsonPath, originalProjectJson, "utf8");
        console.log("已安全恢复原有 Vercel 项目配置。");
      } else if (!projectJsonExisted && fs.existsSync(rootProjectJsonPath)) {
        fs.unlinkSync(rootProjectJsonPath);
      }
    }
  }
}

export {
  parseArgs,
  usage,
  deployWeb,
  DEFAULT_WEB_PROJECT_ID,
  DEFAULT_VERCEL_ORG_ID,
  DEFAULT_WEB_PROJECT_NAME,
};

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  deployWeb(options);
}

if (process.argv[1] && process.argv[1].endsWith("deploy-web.mjs")) {
  main();
}
