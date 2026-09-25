import { execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { updateChangelogFile } from "./changelog.mjs";
import {
  androidChangelogEnPath,
  androidChangelogPath,
  androidGradlePath,
  bumpAndroidVersion,
  readAndroidVersion,
  updateAndroidGradle,
} from "./version-android.mjs";

const releaseBranchDefault = "main";
const releaseFiles = [androidGradlePath, androidChangelogPath, androidChangelogEnPath];

function run(command, args = [], options = {}) {
  const result = execFileSync(command, args, {
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    ...options,
  });
  return options.capture ? result.trim() : "";
}

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
      options.branch = argv[index + 1];
      index += 1;
    } else if (arg === "--notes") {
      options.notes = argv[index + 1];
      index += 1;
    } else if (arg === "--pr") {
      options.pr = argv[index + 1];
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

function printHelp() {
  console.log(`
发布 Android 客户端 (Inkpoint Android)

用法:
  pnpm release:android [patch|minor|major|beta|x.y.z] [--notes "..."] [--pr N] [--dry-run] [--yes]

选项:
  --notes "..."        指定更新日志内容
  --pr N               关联的 GitHub PR 编号
  --dry-run            仅打印即将执行的操作，不修改任何文件
  --yes, -y            跳过确认提示
  --no-push            打 tag 但不执行 git push
  --allow-any-branch   允许在非 main 分支发版
  --resume             恢复中断的发版流程
`);
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  console.log("\n🚀 Inkpoint Android 客户端发布流程\n");

  // 1. 检查 Git 状态
  const currentBranch = run("git", ["branch", "--show-current"], { capture: true });
  if (!options.allowAnyBranch && currentBranch !== options.branch) {
    throw new Error(
      `当前处于分支 "${currentBranch}"，必须在 "${options.branch}" 分支执行发版（或使用 --allow-any-branch）。`,
    );
  }

  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status && !options.resume) {
    throw new Error("Git 工作区存在未提交的更改，发版前必须保证 working tree clean。");
  }

  const { version: currentVersion, versionCode: currentCode } = readAndroidVersion();
  const nextVersion = bumpAndroidVersion(currentVersion, options.kind || "patch");
  const nextCode = currentCode + 1;
  const tag = `android-v${nextVersion}`;

  console.log(`当前版本: ${currentVersion} (code: ${currentCode})`);
  console.log(`目标版本: ${nextVersion} (code: ${nextCode})`);
  console.log(`发布 Tag: ${tag}\n`);

  let notes = options.notes;
  if (!notes) {
    if (process.stdin.isTTY && !options.yes) {
      const rl = readline.createInterface({ input, output });
      notes = await new Promise((resolve) => {
        rl.question("请输入本次版本更新内容说明: ", (answer) => {
          rl.close();
          resolve(answer.trim() || "优化移动端编辑器体验与稳定性");
        });
      });
    } else {
      notes = "优化移动端编辑器体验与稳定性";
    }
  }

  if (options.dryRun) {
    console.log("🔍 [Dry Run] 即将更新 Android 版本与 CHANGELOG:");
    console.log(
      `  - ${androidGradlePath}: versionName = "${nextVersion}", versionCode = ${nextCode}`,
    );
    console.log(`  - ${androidChangelogPath}: 添加 ${nextVersion}`);
    console.log(`  - Commit: chore(android): release ${tag}`);
    console.log(`  - Tag: ${tag}`);
    return;
  }

  if (!options.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    const confirmed = await new Promise((resolve) => {
      rl.question(`确认发布 ${tag}? (y/N): `, (ans) => {
        rl.close();
        resolve(ans.toLowerCase() === "y" || ans.toLowerCase() === "yes");
      });
    });
    if (!confirmed) {
      console.log("已取消发版。");
      return;
    }
  }

  // 2. 执行更新
  updateAndroidGradle(nextVersion, nextCode);
  updateChangelogFile({
    path: androidChangelogPath,
    version: nextVersion,
    notes,
    pr: options.pr,
  });

  if (fs.existsSync(androidChangelogEnPath)) {
    updateChangelogFile({
      path: androidChangelogEnPath,
      version: nextVersion,
      notes,
      pr: options.pr,
    });
  }

  // 3. Git 提交与打 Tag
  run("git", ["add", ...releaseFiles]);
  run("git", ["commit", "-m", `chore(android): release ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

  console.log(`\n✅ 已创建本地提交与 Tag: ${tag}`);

  // 4. 推送到远程
  if (options.noPush) {
    console.log(`ℹ️ [no-push] 跳过推送，请稍后手动执行:`);
    console.log(`  git push origin ${currentBranch} && git push origin ${tag}`);
    return;
  }

  console.log("⬆️ 正在推送到远程并触发 GitHub Actions 构建...");
  run("git", ["push", "origin", currentBranch]);
  run("git", ["push", "origin", tag]);

  console.log(`\n🎉 Android 发版成功触发！`);
  console.log(
    `CI 工作流: https://github.com/wmasfoe/md-editor/actions/workflows/release-mobile.yml`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("publish-android.mjs")) {
  main().catch((error) => {
    console.error("\n❌ 发版失败:", error.message);
    process.exit(1);
  });
}
