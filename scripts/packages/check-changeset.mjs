import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHED_PACKAGE_DIRS = new Set([
  "core",
  "editor",
  "plugin-sdk",
  "shared",
  "markdown-fidelity",
  "plugin-host",
]);

/**
 * Given a list of changed file paths, determine which published packages were touched
 * and whether any new/modified changeset files accompany them.
 */
export function evaluateChangesetRequirement({ changedFiles, changesetFiles }) {
  const touchedPackages = new Set();

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");
    const match = normalized.match(/^packages\/([^/]+)\//);
    if (match && PUBLISHED_PACKAGE_DIRS.has(match[1])) {
      touchedPackages.add(`@md-editor/${match[1]}`);
    }
  }

  const activeChangesets = changesetFiles.filter(
    (name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md",
  );

  return {
    needsChangeset: touchedPackages.size > 0,
    touchedPackages: Array.from(touchedPackages).toSorted(),
    hasChangeset: activeChangesets.length > 0,
    activeChangesets,
  };
}

function getChangedFilesFromGit(root, baseRef = "origin/main") {
  try {
    const stdout = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
      cwd: root,
      encoding: "utf8",
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    try {
      const stdout = execFileSync("git", ["diff", "--name-only", "HEAD~1"], {
        cwd: root,
        encoding: "utf8",
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}

function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/main";

  const changedFiles = getChangedFilesFromGit(root, baseRef);
  let changesetFiles = [];
  try {
    changesetFiles = readdirSync(join(root, ".changeset"));
  } catch {
    changesetFiles = [];
  }

  const result = evaluateChangesetRequirement({ changedFiles, changesetFiles });

  if (result.needsChangeset && !result.hasChangeset) {
    const msg = [
      `Notice: Changes detected in published packages (${result.touchedPackages.join(", ")}), but no changeset was found.`,
      "If this PR should trigger a release or update documentation, please run 'pnpm changeset' to add a changeset fragment.",
    ].join(" ");

    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=Missing Changeset::${msg}`);
    }
    console.warn(`\n⚠️  ${msg}\n`);

    if (process.argv.includes("--strict")) {
      process.exit(1);
    }
  } else if (result.needsChangeset && result.hasChangeset) {
    console.log(
      `✅ Changeset check passed for packages: ${result.touchedPackages.join(", ")} (${result.activeChangesets.join(", ")})`,
    );
  } else {
    console.log("ℹ️  No published package modifications requiring a changeset.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
