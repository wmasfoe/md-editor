import { execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { updateChangelogFile } from "./changelog.mjs";

const defaultNotes = "修复了一些已知问题，添加了一些新功能";
const releaseBranchDefault = "main";
const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const changelogPath = "CHANGELOG.md";
const releaseFiles = [
  changelogPath,
  "package.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    resume: false,
    yes: false,
    noPush: false,
    allowAnyBranch: false,
    branch: releaseBranchDefault,
    notes: undefined,
    kind: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--no-push") {
      options.noPush = true;
    } else if (arg === "--allow-any-branch") {
      options.allowAnyBranch = true;
    } else if (arg === "--branch") {
      options.branch = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--notes") {
      options.notes = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!options.kind) {
      options.kind = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected a value after ${optionName}.`);
  }
  return value;
}

function usage() {
  return `Usage:
  pnpm release [patch|minor|major|beta|x.y.z[-beta.n]] [--notes "..."] [--dry-run] [--yes]

Examples:
  pnpm release
  pnpm release patch
  pnpm release beta
  pnpm release 0.3.0-beta.1 --notes "测试新版编辑器"

Options:
  --branch <name>       Require the current branch to match this name. Default: main.
  --allow-any-branch   Skip the release branch check.
  --dry-run            Print the release plan without changing files.
  --resume             Continue after release:version already changed version files.
  --no-push            Commit and tag locally, but do not push.
  --notes <text>       Release notes used in the commit and annotated tag.
  --yes, -y            Skip the final interactive confirmation.`;
}

function run(command, args, options = {}) {
  if (options.dryRun) {
    console.log(formatCommand(command, args));
    return "";
  }

  const result = execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

  return typeof result === "string" ? result.trim() : "";
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}

function readCurrentVersion() {
  return JSON.parse(fs.readFileSync(tauriConfigPath, "utf8")).version;
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  };
}

function resolveNextVersion(currentVersion, kind) {
  const parsed = parseSemver(currentVersion);

  if (kind === "patch") {
    // From a prerelease, patch means promoting the prerelease base to stable.
    return parsed.prerelease
      ? `${parsed.major}.${parsed.minor}.${parsed.patch}`
      : `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }

  if (kind === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  if (kind === "major") {
    return `${parsed.major + 1}.0.0`;
  }

  if (kind === "beta") {
    const betaMatch = parsed.prerelease?.match(/^beta\.(\d+)$/u);
    if (betaMatch) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}-beta.${Number.parseInt(betaMatch[1], 10) + 1}`;
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-beta.1`;
  }

  parseSemver(kind);
  return kind;
}

// 交互式选择版本类型（使用方向键）
async function selectVersionType(currentVersion) {
  if (!input.isTTY) {
    return "patch";
  }

  const options = ["patch", "minor", "major", "beta", "custom"];
  let selectedIndex = 0;

  // 计算预览版本
  const previewVersions = options.map((opt) => {
    if (opt === "custom") return "x.y.z";
    try {
      return resolveNextVersion(currentVersion, opt);
    } catch {
      return "x.y.z";
    }
  });

  const renderMenu = () => {
    console.clear();
    console.log(`\n当前版本: ${currentVersion}\n`);
    console.log("请选择版本类型 (使用 ↑/↓ 方向键选择, Enter 确认):\n");

    options.forEach((option, index) => {
      const prefix = index === selectedIndex ? "→" : " ";
      const preview = previewVersions[index];
      console.log(`  ${prefix} ${option.padEnd(10)} (${preview})`);
    });
  };

  return new Promise((resolve) => {
    renderMenu();

    const onKeypress = (str, key) => {
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderMenu();
      } else if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderMenu();
      } else if (key.name === "return") {
        readline.emitKeypressEvents(input);
        if (input.isTTY) {
          input.setRawMode(false);
        }
        input.removeListener("keypress", onKeypress);
        resolve(options[selectedIndex]);
      } else if (key.ctrl && key.name === "c") {
        process.exit(0);
      }
    };

    readline.emitKeypressEvents(input);
    if (input.isTTY) {
      input.setRawMode(true);
    }
    input.on("keypress", onKeypress);
  });
}

// 输入自定义版本号
async function inputCustomVersion() {
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    rl.question("\n请输入自定义版本号 (格式: x.y.z): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 输入多行更新内容
async function inputChangelogEntries() {
  const rl = readline.createInterface({ input, output });

  console.log("\n请输入本次更新内容 (每行一条，空行结束):\n");

  const changes = [];

  return new Promise((resolve) => {
    const promptLine = () => {
      rl.question(`${changes.length + 1}. `, (answer) => {
        const trimmed = answer.trim();

        if (trimmed === "") {
          rl.close();
          if (changes.length === 0) {
            console.log("\n错误: 至少需要输入一条更新内容");
            process.exit(1);
          }
          resolve(changes);
        } else {
          changes.push(trimmed);
          promptLine();
        }
      });
    };

    promptLine();
  });
}

async function promptForRelease(options, currentVersion) {
  try {
    // 1. 选择版本类型
    const versionType = options.kind || (await selectVersionType(currentVersion));

    // 2. 如果选择 custom，输入自定义版本号
    const resolvedKind = versionType === "custom" ? await inputCustomVersion() : versionType;

    const nextVersion = resolveNextVersion(currentVersion, resolvedKind);

    // 3. 输入更新内容（多行或单行）
    const notes = await promptNotes(options);

    return { kind: resolvedKind, nextVersion, notes };
  } catch (error) {
    // 确保清理 raw mode
    if (input.isTTY) {
      input.setRawMode(false);
    }
    throw error;
  }
}

async function promptNotes(options) {
  if (options.notes !== undefined) {
    return options.notes;
  }

  if (!input.isTTY) {
    return defaultNotes;
  }

  // 多行输入模式
  const changes = await inputChangelogEntries();
  return changes.join("\n- ");
}

async function confirmRelease(options, plan) {
  if (options.yes || options.dryRun) {
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`确认创建 ${plan.tag} 并推送触发 GitHub Actions? [y/N]: `);
    if (!/^y(?:es)?$/iu.test(answer.trim())) {
      throw new Error("Release cancelled.");
    }
  } finally {
    rl.close();
  }
}

function assertCleanWorktree() {
  const status = run("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "Working tree is not clean. Commit or stash existing changes before running the release script.",
    );
  }
}

function assertReleaseFilesChangedForResume() {
  const status = run("git", ["status", "--porcelain", "--", ...releaseFiles]);
  if (!status) {
    throw new Error("No release version file changes found to resume.");
  }
}

function assertBranch(options) {
  const branch = run("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Cannot release from a detached HEAD.");
  }

  if (!options.allowAnyBranch && branch !== options.branch) {
    throw new Error(
      `Expected to release from branch "${options.branch}", but current branch is "${branch}".`,
    );
  }

  return branch;
}

function assertTagAvailable(tag) {
  try {
    run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
    throw new Error(`Local tag ${tag} already exists.`);
  } catch (error) {
    if (error.status === 0 || !("status" in error)) {
      throw error;
    }
  }

  try {
    run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`]);
    throw new Error(`Remote tag ${tag} already exists on origin.`);
  } catch (error) {
    if (error.status === 0 || !("status" in error)) {
      throw error;
    }
    if (error.status !== 2) {
      throw new Error(`Unable to check remote tag ${tag}: ${error.stderr || error.message}`, {
        cause: error,
      });
    }
  }
}

function commitMessage(tag, notes) {
  return [
    `Prepare ${tag} for distribution`,
    `Release notes: ${notes}`,
    "Constraint: GitHub Actions release workflow triggers from pushed v* tags.",
    "Rejected: Manual version, commit, tag, and push sequence | scripted orchestration prevents skipped steps.",
    "Confidence: high",
    "Scope-risk: narrow",
    "Directive: Keep release version files, git tag, GitHub Release tag, and Homebrew cask version aligned.",
    "Tested: pnpm release:version updates package, Tauri, and Cargo version files before commit.",
    "Not-tested: GitHub-hosted macOS release workflow before the tag is pushed.",
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const branch = assertBranch(options);
  if (!options.dryRun && !options.resume) {
    assertCleanWorktree();
  }
  if (!options.dryRun && options.resume) {
    assertReleaseFilesChangedForResume();
  }

  const currentVersion = readCurrentVersion();
  const release = options.resume
    ? await promptForResume(options, currentVersion)
    : await promptForRelease(options, currentVersion);
  const tag = `v${release.nextVersion}`;
  const plan = { ...release, tag, branch };

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version:    ${plan.nextVersion}`);
  console.log(`Tag:             ${plan.tag}`);
  console.log(`Branch:          ${plan.branch}`);
  console.log(`Notes:           ${plan.notes}`);

  await confirmRelease(options, plan);

  if (!options.dryRun) {
    assertTagAvailable(plan.tag);
  }

  if (!options.resume) {
    run("pnpm", ["release:version", plan.nextVersion], {
      dryRun: options.dryRun,
      stdio: "inherit",
    });
  } else if (options.dryRun) {
    console.log("resume: skip pnpm release:version because version files are already changed");
  }

  const changelogResult = updateChangelogFile({
    path: changelogPath,
    version: plan.nextVersion,
    notes: plan.notes,
    mode: options.resume ? "resume" : "normal",
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    const action = changelogResult.changed ? "would update" : "would reuse";
    console.log(`${action} ${changelogPath} for ${plan.nextVersion}`);
  }

  if (options.dryRun) {
    run("git", ["add", ...releaseFiles], { dryRun: true });
    run(
      "git",
      ["commit", ...commitMessage(plan.tag, plan.notes).flatMap((message) => ["-m", message])],
      {
        dryRun: true,
      },
    );
    run("git", ["tag", "-a", plan.tag, "-m", `Release ${plan.tag}`, "-m", plan.notes], {
      dryRun: true,
    });
  } else {
    const actualVersion = readCurrentVersion();
    if (actualVersion !== plan.nextVersion) {
      throw new Error(`Version script produced ${actualVersion}, expected ${plan.nextVersion}.`);
    }

    run("git", ["add", ...releaseFiles], { stdio: "inherit" });
    run(
      "git",
      ["commit", ...commitMessage(plan.tag, plan.notes).flatMap((message) => ["-m", message])],
      {
        stdio: "inherit",
      },
    );
    run("git", ["tag", "-a", plan.tag, "-m", `Release ${plan.tag}`, "-m", plan.notes], {
      stdio: "inherit",
    });
  }

  if (options.noPush) {
    console.log(`Created local release commit and tag ${plan.tag}. Push manually when ready.`);
    return;
  }

  run("git", ["push", "origin", plan.branch], { dryRun: options.dryRun, stdio: "inherit" });
  run("git", ["push", "origin", plan.tag], { dryRun: options.dryRun, stdio: "inherit" });

  if (options.dryRun) {
    console.log("Dry run complete. No files were changed and nothing was pushed.");
    return;
  }

  console.log(`Release tag ${plan.tag} pushed. GitHub Actions will run the release workflow.`);
}

async function promptForResume(options, currentVersion) {
  try {
    return {
      kind: "resume",
      nextVersion: currentVersion,
      notes: await promptNotes(options),
    };
  } catch (error) {
    // 确保清理 raw mode
    if (input.isTTY) {
      input.setRawMode(false);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
