import fs from "node:fs";
import readline from "node:readline";
import { updateChangelogFile } from "./changelog.mjs";

export const androidGradlePath = "apps/mobile/android/app/build.gradle.kts";
export const androidChangelogPath = "apps/mobile/android/CHANGELOG.md";
export const androidChangelogEnPath = "apps/mobile/android/CHANGELOG_EN.md";

export function readAndroidVersion(gradlePath = androidGradlePath) {
  if (!fs.existsSync(gradlePath)) {
    throw new Error(`Android Gradle file not found: ${gradlePath}`);
  }
  const contents = fs.readFileSync(gradlePath, "utf8");
  const nameMatch = contents.match(/versionName\s*=\s*"([^"]+)"/u);
  const codeMatch = contents.match(/versionCode\s*=\s*(\d+)/u);

  if (!nameMatch) {
    throw new Error(`Unable to find versionName in ${gradlePath}`);
  }
  if (!codeMatch) {
    throw new Error(`Unable to find versionCode in ${gradlePath}`);
  }

  return {
    version: nameMatch[1],
    versionCode: Number.parseInt(codeMatch[1], 10),
  };
}

export function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }
}

export function bumpAndroidVersion(currentVersion, bump) {
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

export function updateAndroidGradle(nextVersion, nextCode, gradlePath = androidGradlePath) {
  const contents = fs.readFileSync(gradlePath, "utf8");
  let updated = contents.replace(/versionName\s*=\s*"[^"]+"/u, `versionName = "${nextVersion}"`);
  if (nextCode !== undefined) {
    updated = updated.replace(/versionCode\s*=\s*\d+/u, `versionCode = ${nextCode}`);
  }

  if (updated === contents) {
    throw new Error(`Failed to update version fields in ${gradlePath}.`);
  }

  fs.writeFileSync(gradlePath, updated);
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
    return bumpAndroidVersion(currentVersion, opt);
  });

  const renderMenu = () => {
    console.clear();
    console.log(`\n当前 Android 端版本: ${currentVersion}\n`);
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
        process.stdin.removeListener("keypress", onKeypress);
        process.stdin.setRawMode(false);
        rl.close();
        console.log(`\n已选择: ${options[selectedIndex]}\n`);
        resolve(options[selectedIndex]);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", onKeypress);
  });
}

async function inputCustomVersion() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("请输入自定义版本号 (例如 0.2.1): ", (answer) => {
      rl.close();
      const version = answer.trim();
      assertSemver(version);
      resolve(version);
    });
  });
}

async function inputChangelogEntries() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const entries = [];
  console.log("请输入更新内容 (每行一条，输入空行结束):");

  return new Promise((resolve) => {
    const askNext = () => {
      rl.question(`- `, (line) => {
        const trimmed = line.trim();
        if (trimmed) {
          entries.push(trimmed);
          askNext();
        } else if (entries.length === 0) {
          console.log("至少需要输入一条更新内容！");
          askNext();
        } else {
          rl.close();
          resolve(entries);
        }
      });
    };
    askNext();
  });
}

async function inputPr() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("关联 PR 编号 (例如 82，可跳过直接回车): ", (answer) => {
      rl.close();
      const trimmed = answer.trim().replace(/^#/u, "");
      resolve(trimmed ? Number.parseInt(trimmed, 10) : undefined);
    });
  });
}

export async function main() {
  const args = process.argv.slice(2);
  const versionArg = args.find((arg) => !arg.startsWith("--") && !arg.startsWith("-"));
  const notesIndex = args.indexOf("--notes");
  const notesArg = notesIndex !== -1 ? args[notesIndex + 1] : undefined;
  const prIndex = args.indexOf("--pr");
  const prArg = prIndex !== -1 ? Number.parseInt(args[prIndex + 1], 10) : undefined;

  const { version: currentVersion, versionCode: currentCode } = readAndroidVersion();

  // 1. 确定目标版本
  let nextVersion;
  if (versionArg) {
    nextVersion = bumpAndroidVersion(currentVersion, versionArg);
  } else if (!process.stdin.isTTY) {
    nextVersion = bumpAndroidVersion(currentVersion, "patch");
  } else {
    const versionType = await selectVersionType(currentVersion);
    nextVersion =
      versionType === "custom"
        ? await inputCustomVersion()
        : bumpAndroidVersion(currentVersion, versionType);
  }

  const nextCode = currentCode + 1;

  // 2. 收集变更日志
  let changes;
  if (notesArg) {
    changes = [notesArg];
  } else if (!process.stdin.isTTY) {
    changes = ["优化 Android 移动端使用体验与稳定性"];
  } else {
    changes = await inputChangelogEntries();
  }

  const pr = prArg ?? (process.stdin.isTTY ? await inputPr() : undefined);

  // 3. 执行更新
  console.log(
    `\n开始更新 Android 版本: ${currentVersion} (code: ${currentCode}) -> ${nextVersion} (code: ${nextCode})...`,
  );
  updateAndroidGradle(nextVersion, nextCode);

  updateChangelogFile({
    path: androidChangelogPath,
    version: nextVersion,
    notes: changes.join("\n"),
    pr,
  });

  if (fs.existsSync(androidChangelogEnPath)) {
    updateChangelogFile({
      path: androidChangelogEnPath,
      version: nextVersion,
      notes: changes.join("\n"),
      pr,
    });
  }

  console.log(`✅ Android Gradle 已更新: versionName="${nextVersion}", versionCode=${nextCode}`);
  console.log(`✅ apps/mobile/android/CHANGELOG.md 已更新`);
  console.log(`\n可执行 git diff 检查变更`);
}

if (process.argv[1] && process.argv[1].endsWith("version-android.mjs")) {
  main().catch((error) => {
    console.error("\n❌ 错误:", error.message);
    process.exit(1);
  });
}
