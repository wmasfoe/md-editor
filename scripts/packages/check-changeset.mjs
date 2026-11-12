import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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
 * and whether any new/modified changeset files accompany them in the same changeset diff.
 */
export function evaluateChangesetRequirement({ changedFiles }) {
  const touchedPackages = new Set();
  const touchedChangesets = [];

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");
    const pkgMatch = normalized.match(/^packages\/([^/]+)\//);
    if (pkgMatch && PUBLISHED_PACKAGE_DIRS.has(pkgMatch[1])) {
      touchedPackages.add(`@md-editor/${pkgMatch[1]}`);
    }
    const csMatch = normalized.match(/^\.changeset\/([^/]+\.md)$/i);
    if (csMatch && csMatch[1].toLowerCase() !== "readme.md") {
      touchedChangesets.push(csMatch[1]);
    }
  }

  return {
    needsChangeset: touchedPackages.size > 0,
    touchedPackages: Array.from(touchedPackages).toSorted(),
    hasChangeset: touchedChangesets.length > 0,
    activeChangesets: touchedChangesets.toSorted(),
  };
}

function getChangedFilesFromGit(root, baseRef = "origin/main") {
  try {
    const stdout = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
      cwd: root,
      encoding: "utf8",
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch (err) {
    console.warn(
      `[check-changeset] Notice: could not compare with base ref '${baseRef}' (${err.message.trim()}). Falling back to HEAD~1 diff.`,
    );
    try {
      const stdout = execFileSync("git", ["diff", "--name-only", "HEAD~1"], {
        cwd: root,
        encoding: "utf8",
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch (fallbackErr) {
      console.warn(
        `[check-changeset] Warning: fallback diff against HEAD~1 also failed (${fallbackErr.message.trim()}). No changed files detected.`,
      );
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
  const result = evaluateChangesetRequirement({ changedFiles });

  if (result.needsChangeset && !result.hasChangeset) {
    const msg = [
      `Notice: Changes detected in published packages (${result.touchedPackages.join(", ")}), but no changeset was found in this PR.`,
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
