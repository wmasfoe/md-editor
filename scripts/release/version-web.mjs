import fs from "node:fs";
import readline from "node:readline";
import { updateChangelogFile } from "./changelog.mjs";

const webPackagePath = "apps/web/package.json";
const webChangelogPath = "apps/web/CHANGELOG.md";

export function readWebVersion() {
  const pkg = JSON.parse(fs.readFileSync(webPackagePath, "utf8"));
  return pkg.version;
}

export function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }
}

export function bumpWebVersion(currentVersion, bump) {
  if (!["major", "minor", "patch", "beta"].includes(bump)) {
    assertSemver(bump);
    return bump;
  }

  const [major, minor, patch] = currentVersion.split(".").map((part) => Number.parseInt(part, 10));

  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Cannot ${bump} bump non-numeric version "${currentVersion}".`);
  }

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (bump === "beta") {
    return `${major}.${minor}.${patch + 1}-beta.1`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

export function updateWebPackageJson(version) {
  const contents = fs.readFileSync(webPackagePath, "utf8");
  const nextContents = contents.replace(/^(\s{2}"version"\s*:\s*)"[^"]*"/mu, `$1"${version}"`);

  if (nextContents === contents) {
    throw new Error(`Unable to find top-level version in ${webPackagePath}.`);
  }

  fs.writeFileSync(webPackagePath, nextContents);
}

// 交互式选择版本类型
async function selectVersionType(currentVersion) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const options = ["patch", "minor", "major", "beta", "custom"];
  let selectedIndex = 0;

  const previewVersions = options.map((opt) => {
    if (opt === "custom") return "x.y.z";
    return bumpWebVersion(currentVersion, opt);
  });

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
        rl.close();
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

// 输入自定义版本号
async function inputCustomVersion() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\n请输入自定义版本号 (格式: x.y.z): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 输入多行更新内容
async function inputChangelogEntries() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n请输入本次 Web 端更新内容 (每行一条，空行结束):\n");

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

// 输入关联 PR 编号
async function inputPr() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\n请输入关联 PR 编号 (例如 49，留空跳过): ", (answer) => {
      rl.close();
      const trimmed = answer?.trim();
      resolve(trimmed ? trimmed.replace(/^#/u, "") : undefined);
    });
  });
}

// 主流程
async function main() {
  const currentVersion = readWebVersion();
  const prArgIndex = process.argv.indexOf("--pr");
  const prArg = prArgIndex !== -1 ? process.argv[prArgIndex + 1] : undefined;
  const argTarget = process.argv[2] && process.argv[2] !== "--pr" ? process.argv[2] : undefined;

  if (argTarget) {
    const nextVersion = bumpWebVersion(currentVersion, argTarget);
    updateWebPackageJson(nextVersion);
    console.log(`\n✅ Web 版本文件更新完成: ${currentVersion} -> ${nextVersion}`);
    return;
  }

  // 1. 选择版本类型
  const versionType = await selectVersionType(currentVersion);

  // 2. 如果选择 custom，输入自定义版本号
  const nextVersion =
    versionType === "custom"
      ? bumpWebVersion(currentVersion, await inputCustomVersion())
      : bumpWebVersion(currentVersion, versionType);

  // 3. 输入更新内容
  const changes = await inputChangelogEntries();

  // 4. 输入关联 PR
  const pr = prArg ?? (await inputPr());

  // 5. 确认信息
  console.log("\n=== Web 发布信息确认 ===");
  console.log(`版本: ${currentVersion} -> ${nextVersion}`);
  if (pr) {
    console.log(`关联 PR: #${pr}`);
  }
  console.log(`更新内容:`);
  changes.forEach((change, index) => {
    console.log(`  ${index + 1}. ${change}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const confirmed = await new Promise((resolve) => {
    rl.question("\n确认发布? (y/N): ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });

  if (!confirmed) {
    console.log("\n已取消发布");
    process.exit(0);
  }

  // 6. 执行更新
  console.log("\n开始更新 Web 版本...");
  updateWebPackageJson(nextVersion);
  updateChangelogFile({
    path: webChangelogPath,
    version: nextVersion,
    notes: changes.join("\n"),
    pr,
  });

  console.log(`\n✅ Web 版本更新完成: ${currentVersion} -> ${nextVersion}`);
  console.log(`✅ apps/web/CHANGELOG.md 已更新`);
  console.log(`\n下一步:`);
  console.log(`  1. 检查更改: git diff`);
  console.log(
    `  2. 提交更改: git add . && git commit -m "chore(web): release web-v${nextVersion}"`,
  );
  console.log(`  3. 推送到远程: git push origin main`);
  console.log(`  4. 打标签: git tag web-v${nextVersion} && git push origin web-v${nextVersion}`);
}

if (process.argv[1] && process.argv[1].endsWith("version-web.mjs")) {
  main().catch((error) => {
    console.error("\n❌ 错误:", error.message);
    process.exit(1);
  });
}
