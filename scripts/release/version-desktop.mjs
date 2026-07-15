import { execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const rootPackagePath = "package.json";
const desktopPackagePath = "apps/desktop/package.json";
const cargoManifestPath = "apps/desktop/src-tauri/Cargo.toml";
const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const changelogPath = "CHANGELOG.md";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }
}

function bumpVersion(currentVersion, bump) {
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

function updatePackageJson(path, version) {
  const packageJson = readJson(path);
  packageJson.version = version;
  writeJson(path, packageJson);
}

function updateTauriConfig(version) {
  const config = readJson(tauriConfigPath);
  config.version = version;
  writeJson(tauriConfigPath, config);
}

function updateCargoManifest(version) {
  const contents = fs.readFileSync(cargoManifestPath, "utf8");
  let inPackageSection = false;
  let updated = false;

  const nextContents = contents
    .split(/(?<=\n)/u)
    .map((line) => {
      const trimmedLine = line.trim();

      if (/^\[[^\]]+\]$/u.test(trimmedLine)) {
        inPackageSection = trimmedLine === "[package]";
      }

      if (!inPackageSection || updated) {
        return line;
      }

      return line.replace(/^(\s*version\s*=\s*)"[^"]*"/u, (_match, prefix) => {
        updated = true;
        return `${prefix}"${version}"`;
      });
    })
    .join("");

  if (!updated) {
    throw new Error(`Unable to find [package] version in ${cargoManifestPath}.`);
  }

  fs.writeFileSync(cargoManifestPath, nextContents);
}

function updateChangelog(version, changes) {
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const today = new Date().toISOString().split("T")[0];

  const changeList = changes.map((line) => `- ${line}`).join("\n");
  const newEntry = `## ${version} - ${today}\n\n${changeList}\n\n`;

  // 在第一个 ## 之前插入新条目
  const firstVersionIndex = changelog.indexOf("## ");
  if (firstVersionIndex === -1) {
    // 如果没有找到版本条目，在 "# Changelog" 后插入
    const headerEnd = changelog.indexOf("\n") + 1;
    const updated = changelog.slice(0, headerEnd) + "\n" + newEntry + changelog.slice(headerEnd);
    fs.writeFileSync(changelogPath, updated);
  } else {
    const updated =
      changelog.slice(0, firstVersionIndex) + newEntry + changelog.slice(firstVersionIndex);
    fs.writeFileSync(changelogPath, updated);
  }
}

// 交互式选择版本类型
async function selectVersionType(currentVersion) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const options = ["patch", "minor", "major", "beta", "custom"];
  let selectedIndex = 0;

  // 计算预览版本
  const previewVersions = options.map((opt) => {
    if (opt === "custom") return "x.y.z";
    return bumpVersion(currentVersion, opt);
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

// 主流程
async function main() {
  const currentVersion = readJson(tauriConfigPath).version;

  // 1. 选择版本类型
  const versionType = await selectVersionType(currentVersion);

  // 2. 如果选择 custom，输入自定义版本号
  const nextVersion =
    versionType === "custom"
      ? bumpVersion(currentVersion, await inputCustomVersion())
      : bumpVersion(currentVersion, versionType);

  // 3. 输入更新内容
  const changes = await inputChangelogEntries();

  // 4. 确认信息
  console.log("\n=== 发布信息确认 ===");
  console.log(`版本: ${currentVersion} -> ${nextVersion}`);
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

  // 5. 执行更新
  console.log("\n开始更新版本...");

  execFileSync(
    "cargo",
    ["metadata", "--manifest-path", cargoManifestPath, "--no-deps", "--format-version", "1"],
    {
      stdio: "ignore",
    },
  );

  updatePackageJson(rootPackagePath, nextVersion);
  updatePackageJson(desktopPackagePath, nextVersion);
  updateTauriConfig(nextVersion);
  updateCargoManifest(nextVersion);
  updateChangelog(nextVersion, changes);

  execFileSync("cargo", ["update", "--manifest-path", cargoManifestPath, "-w"], {
    stdio: "inherit",
  });

  console.log(`\n✅ 版本更新完成: ${currentVersion} -> ${nextVersion}`);
  console.log(`✅ CHANGELOG.md 已更新`);
  console.log(`\n下一步:`);
  console.log(`  1. 检查更改: git diff`);
  console.log(`  2. 提交更改: git add . && git commit -m "chore: release v${nextVersion}"`);
  console.log(`  3. 推送到远程: git push origin main`);
  console.log(`  4. 打标签: git tag v${nextVersion} && git push origin v${nextVersion}`);
}

main().catch((error) => {
  console.error("\n❌ 错误:", error.message);
  process.exit(1);
});
