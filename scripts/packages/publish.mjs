import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const PUBLISHED_PACKAGE_DIRS = [
  "core",
  "editor",
  "plugin-sdk",
  "shared",
  "markdown-fidelity",
  "plugin-host",
];

/**
 * Check which public packages have a local version not yet published on the npm registry.
 */
export function getPendingPublishPackages(rootDir = root) {
  const pending = [];
  for (const dir of PUBLISHED_PACKAGE_DIRS) {
    const pkgJsonPath = join(rootDir, "packages", dir, "package.json");
    const manifest = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const localVersion = manifest.version;
    try {
      const stdout = execFileSync(
        "npm",
        ["view", manifest.name, "versions", "--json", "--registry", "https://registry.npmjs.org"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const parsed = JSON.parse(stdout);
      const remoteVersions = Array.isArray(parsed) ? parsed : [parsed];
      if (!remoteVersions.includes(localVersion)) {
        pending.push({ name: manifest.name, version: localVersion });
      }
    } catch {
      // Package not found on registry or network issue; treat as pending publish
      pending.push({ name: manifest.name, version: localVersion });
    }
  }
  return pending;
}

function run() {
  // Ensure npm authentication environment variables are mapped for both pnpm and npm.
  if (process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
    process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
  }

  const pending = getPendingPublishPackages(root);
  if (pending.length === 0) {
    console.log("==> No packages have new unpublished versions on npm registry. Skipping release.");
    return;
  }

  console.log(
    `==> Detected ${pending.length} package(s) pending publication: ` +
      pending.map((p) => `${p.name}@${p.version}`).join(", "),
  );

  // Validate npm registry authentication before expensive build and pack steps
  console.log("==> Verifying npm registry authentication...");
  try {
    const whoami = execFileSync("npm", ["whoami", "--registry", "https://registry.npmjs.org"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    console.log(`==> Authenticated as: ${whoami.trim()}`);
  } catch (err) {
    console.error(
      "==> Failed to authenticate with npm registry. Ensure NPM_TOKEN is valid.",
      err.message,
    );
    process.exit(1);
  }

  console.log("==> Running package build and distribution verification...");
  execFileSync("pnpm", ["verify:packages"], { cwd: root, stdio: "inherit", env: process.env });

  console.log("==> Publishing updated packages via Changesets...");
  execFileSync("pnpm", ["exec", "changeset", "publish"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
