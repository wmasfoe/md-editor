import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * 从 `.changeset/config.json` 读取 `ignore` 列表。
 *
 * `@changesets/cli` 在 `changeset version` 阶段会**直接失败**：
 * "Mixed changesets that contain both ignored and not ignored packages are not allowed"。
 * 那条错误只在发版 CI（合并到 main 之后）才暴露，PR 阶段的校验若不复刻这个规则，
 * 就会把"合并即失败"的 changeset 放进去（PR #292 已实际踩到）。
 */
export function readIgnoredPackages(root) {
  let raw;
  try {
    raw = readFileSync(resolve(root, ".changeset/config.json"), "utf8");
  } catch (error) {
    // 只有"配置文件不存在"才能安全降级为空集合（本仓库一定有，缺失说明跑错目录）。
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
  // 解析失败必须硬失败：静默返回空集合会让 mixed 校验**失效**，
  // 而 `changeset version` 面对同一个坏文件照样会失败——门禁就先骗了我们一次。
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[check-changeset] .changeset/config.json is not valid JSON: ${error.message}`,
      { cause: error },
    );
  }
  // 注意：这里按**精确包名**匹配。changesets 的 `ignore` 还支持 glob
  // （如 `@md-editor/app-*`）；本仓库当前全是精确名，若将来改成通配符，
  // 这里的匹配逻辑需要同步升级，否则会漏判。
  return new Set(Array.isArray(parsed.ignore) ? parsed.ignore : []);
}

/**
 * Given a list of changed file paths, determine which published packages were touched
 * and whether any new/modified changeset files accompany them in the same changeset diff.
 */
export function evaluateChangesetRequirement({
  changedFiles,
  changesetContents = {},
  ignoredPackages = new Set(),
}) {
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

  // Changesets frontmatter maps package names to semver bump levels.
  const covered = new Set();
  let noRelease = false;
  for (const file of touchedChangesets) {
    const content = changesetContents[file] ?? "";
    // An empty changeset explicitly allows packages without a release.
    if (/^---[ \t]*\r?\n(?:[ \t]*\r?\n)*---[ \t]*(?:\r?\n|$)/.test(content)) {
      noRelease = true;
      continue;
    }
    const frontmatter = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter) continue;
    for (const line of frontmatter.split(/\r?\n/)) {
      const entry = line.match(
        /^\s*["']?(@md-editor\/[^"':\s]+)["']?\s*:\s*(patch|minor|major)\s*$/,
      );
      if (entry) covered.add(entry[1]);
    }
  }
  const missingPackages = noRelease
    ? []
    : [...touchedPackages].filter((name) => !covered.has(name)).toSorted();

  /**
   * 一个 changeset 同时列出 ignore 与非 ignore 包 → `changeset version` 必然失败。
   * 逐个 changeset 单独判定（不是看整个 PR 的并集）。
   */
  const mixedChangesets = [];
  for (const file of touchedChangesets) {
    const content = changesetContents[file] ?? "";
    const frontmatter = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter) continue;
    const listed = new Set();
    for (const line of frontmatter.split(/\r?\n/)) {
      const entry = line.match(
        /^\s*["']?(@md-editor\/[^"':\s]+)["']?\s*:\s*(patch|minor|major)\s*$/,
      );
      if (entry) listed.add(entry[1]);
    }
    const ignored = [...listed].filter((name) => ignoredPackages.has(name));
    const released = [...listed].filter((name) => !ignoredPackages.has(name));
    if (ignored.length > 0 && released.length > 0) {
      mixedChangesets.push({ file, ignored: ignored.toSorted(), released: released.toSorted() });
    }
  }

  return {
    mixedChangesets,
    missingPackages,
    noRelease,
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
      throw new Error("[check-changeset] Cannot determine changed files", { cause: fallbackErr });
    }
  }
}

function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/main";

  const changedFiles = getChangedFilesFromGit(root, baseRef);
  const changesetContents = {};
  for (const file of changedFiles.filter((name) => /^\.changeset\/[^/]+\.md$/i.test(name))) {
    try {
      changesetContents[file.slice(".changeset/".length)] = readFileSync(
        resolve(root, file),
        "utf8",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error; // Deleted changesets do not cover this PR.
    }
  }
  const result = evaluateChangesetRequirement({
    changedFiles,
    changesetContents,
    ignoredPackages: readIgnoredPackages(root),
  });

  if (result.mixedChangesets.length > 0) {
    // 这条是**硬错误**，不是警告：`changeset version` 一定会失败，
    // 放行等于把"合并即红"的 changeset 合进 main。
    for (const mixed of result.mixedChangesets) {
      console.error(
        [
          `❌ Mixed changeset ${mixed.file}: it lists both ignored and released packages.`,
          `   ignored (in .changeset/config.json "ignore"): ${mixed.ignored.join(", ")}`,
          `   released: ${mixed.released.join(", ")}`,
          "   @changesets/cli rejects this at `changeset version` time.",
          `   Fix: remove the ignored packages (${mixed.ignored.join(", ")}) from this changeset.`,
          "        Ignored packages are never published, so they must not appear in a changeset.",
        ].join("\n"),
      );
    }
    process.exit(1);
  }

  if (result.missingPackages.length > 0) {
    const msg = [
      `Notice: Changes detected in published packages (${result.missingPackages.join(", ")}), but no matching changeset was found in this PR.`,
      "If this PR should trigger a release or update documentation, please run 'pnpm changeset' to add a changeset fragment.",
    ].join(" ");

    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=Missing Changeset::${msg}`);
    }
    console.warn(`\n⚠️  ${msg}\n`);

    if (process.argv.includes("--strict")) {
      process.exit(1);
    }
  } else if (result.noRelease && result.needsChangeset) {
    console.log("✅ Empty changeset explicitly allows packages without a release.");
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
