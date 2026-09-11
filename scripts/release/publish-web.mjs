import { execFileSync } from "node:child_process";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { updateChangelogFile } from "./changelog.mjs";
import { bumpWebVersion, readWebVersion } from "./version-web.mjs";

const defaultNotes = "修复了一些已知问题，优化了 Web 端编辑体验";
const releaseBranchDefault = "main";
const webPackagePath = "apps/web/package.json";
const webChangelogPath = "apps/web/CHANGELOG.md";
const releaseFiles = [webPackagePath, webChangelogPath];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    resume: false,
    yes: false,
    noPush: false,
    allowAnyBranch: false,
    branch: releaseBranchDefault,
    notes: undefined,
    pr: undefined,
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
    } else if (arg === "--pr") {
      options.pr = readOptionValue(argv, index, arg);
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
  pnpm release:web [patch|minor|major|x.y.z] [--notes "..."] [--dry-run] [--yes]

Examples:
  pnpm release:web
  pnpm release:web patch
  pnpm release:web minor --notes "上线 MDX 组件沙盒"
  pnpm release:web 0.2.0

Options:
  --branch <name>       Require the current branch to match this name. Default: main.
  --allow-any-branch   Skip the release branch check.
  --dry-run            Print the release plan without changing files.
  --resume             Continue after release:web:version already changed version files.
  --no-push            Commit and tag locally, but do not push.
  --notes <text>       Release notes used in the commit and annotated tag.
  --pr <number>        Associated Pull Request number for the release changelog.
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
    throw new Error("No web release version file changes found to resume.");
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
    `chore(web): release ${tag}`,
    `Release notes: ${notes}`,
    "Constraint: GitHub Actions release workflow triggers from pushed web-v* tags.",
    "Scope: apps/web",
  ];
}

async function promptForRelease(options, currentVersion) {
  const kind = options.kind ?? (input.isTTY ? await selectVersionType(currentVersion) : "patch");
  const nextVersion = bumpWebVersion(currentVersion, kind);
  const notes = options.notes ?? (input.isTTY ? await promptNotes() : defaultNotes);
  const pr = options.pr ?? (input.isTTY ? await promptPr() : undefined);

  return { kind, nextVersion, notes, pr };
}

async function selectVersionType(currentVersion) {
  const options = ["patch", "minor", "major"];
  let selectedIndex = 0;

  const previewVersions = options.map((opt) => bumpWebVersion(currentVersion, opt));

  const renderMenu = () => {
    console.clear();
    console.log(`\n当前 Web 端版本: ${currentVersion}\n`);
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
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener("keypress", onKeypress);
        resolve(options[selectedIndex]);
      } else if (key.ctrl && key.name === "c") {
        process.exit(0);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", onKeypress);
  });
}

async function promptNotes() {
  const rl = readline.createInterface({ input, output });
  console.log("\n请输入本次 Web 端更新内容 (每行一条，空行结束):\n");
  const changes = [];

  return new Promise((resolve) => {
    const promptLine = () => {
      rl.question(`${changes.length + 1}. `, (answer) => {
        const trimmed = answer.trim();
        if (trimmed === "") {
          rl.close();
          resolve(changes.length > 0 ? changes.join("\n- ") : defaultNotes);
        } else {
          changes.push(trimmed);
          promptLine();
        }
      });
    };
    promptLine();
  });
}

async function promptPr() {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question("\n请输入关联 PR 编号 (留空跳过): ", (answer) => {
      rl.close();
      const trimmed = answer?.trim();
      resolve(trimmed ? trimmed.replace(/^#/u, "") : undefined);
    });
  });
}

async function confirmRelease(options, plan) {
  if (options.yes || options.dryRun) {
    return;
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output });
    rl.question(`确认创建 ${plan.tag} 并推送触发 GitHub Actions? [y/N]: `, (answer) => {
      rl.close();
      if (!answer || !/^y(?:es)?$/iu.test(answer.trim())) {
        reject(new Error("Release cancelled."));
      } else {
        resolve();
      }
    });
  });
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

  const currentVersion = readWebVersion();
  const release = await promptForRelease(options, currentVersion);
  const tag = `web-v${release.nextVersion}`;
  const plan = { ...release, tag, branch };

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version:    ${plan.nextVersion}`);
  console.log(`Tag:             ${plan.tag}`);
  console.log(`Branch:          ${plan.branch}`);
  console.log(`Notes:           ${plan.notes}`);
  if (plan.pr) {
    console.log(`PR:              #${plan.pr}`);
  }

  await confirmRelease(options, plan);

  if (!options.dryRun) {
    assertTagAvailable(plan.tag);
  }

  if (!options.resume) {
    run("pnpm", ["release:web:version", plan.nextVersion], {
      dryRun: options.dryRun,
      stdio: "inherit",
    });
  }

  const changelogResult = updateChangelogFile({
    path: webChangelogPath,
    version: plan.nextVersion,
    notes: plan.notes,
    pr: plan.pr,
    mode: options.resume ? "resume" : "normal",
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    const action = changelogResult.changed ? "would update" : "would reuse";
    console.log(`${action} ${webChangelogPath} for ${plan.nextVersion}`);
  }

  // 验证 Web 端编译
  console.log("\n正在验证 Web 应用构建...");
  run("pnpm", ["build:web"], { dryRun: options.dryRun, stdio: "inherit" });

  if (options.dryRun) {
    run("git", ["add", ...releaseFiles], { dryRun: true });
    run(
      "git",
      ["commit", ...commitMessage(plan.tag, plan.notes).flatMap((message) => ["-m", message])],
      { dryRun: true },
    );
    run("git", ["tag", "-a", plan.tag, "-m", `Release ${plan.tag}`, "-m", plan.notes], {
      dryRun: true,
    });
  } else {
    run("git", ["add", ...releaseFiles], { stdio: "inherit" });
    run(
      "git",
      ["commit", ...commitMessage(plan.tag, plan.notes).flatMap((message) => ["-m", message])],
      { stdio: "inherit" },
    );
    run("git", ["tag", "-a", plan.tag, "-m", `Release ${plan.tag}`, "-m", plan.notes], {
      stdio: "inherit",
    });
  }

  if (options.noPush) {
    console.log(`\nCreated local release commit and tag ${plan.tag}. Push manually when ready.`);
    return;
  }

  run("git", ["push", "origin", plan.branch], { dryRun: options.dryRun, stdio: "inherit" });
  run("git", ["push", "origin", plan.tag], { dryRun: options.dryRun, stdio: "inherit" });

  if (options.dryRun) {
    console.log("\nDry run complete. No files were changed and nothing was pushed.");
    return;
  }

  console.log(
    `\nRelease tag ${plan.tag} pushed. GitHub Actions will run the Web release workflow.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
