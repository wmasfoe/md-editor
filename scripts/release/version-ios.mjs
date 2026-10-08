import fs from "node:fs";
import readline from "node:readline";
import { updateChangelogFile } from "./changelog.mjs";

export const iosProjectPath = "apps/mobile/ios/Inkpoint.xcodeproj/project.pbxproj";
export const iosAppInfoPlistPath = "apps/mobile/ios/Inkpoint/Info.plist";
export const iosChangelogPath = "apps/mobile/ios/CHANGELOG.md";
export const iosChangelogEnPath = "apps/mobile/ios/CHANGELOG_EN.md";

/**
 * 读取 iOS 工程版本。
 * Xcode 工程里 MARKETING_VERSION / CURRENT_PROJECT_VERSION 在 Debug/Release 各出现一次，
 * 发版时必须成对更新，否则两个配置会漂移。
 */
export function readIosVersion(projectPath = iosProjectPath) {
  if (!fs.existsSync(projectPath)) {
    throw new Error(`iOS project file not found: ${projectPath}`);
  }
  const contents = fs.readFileSync(projectPath, "utf8");
  const nameMatch = contents.match(/MARKETING_VERSION\s*=\s*([^;]+);/u);
  const codeMatch = contents.match(/CURRENT_PROJECT_VERSION\s*=\s*(\d+);/u);

  if (!nameMatch) {
    throw new Error(`Unable to find MARKETING_VERSION in ${projectPath}`);
  }
  if (!codeMatch) {
    throw new Error(`Unable to find CURRENT_PROJECT_VERSION in ${projectPath}`);
  }

  return {
    version: nameMatch[1].trim(),
    buildNumber: Number.parseInt(codeMatch[1], 10),
  };
}

export function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }
}

export function bumpIosVersion(currentVersion, bump) {
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

/**
 * 校验 App 的 Info.plist 用 $(MARKETING_VERSION) / $(CURRENT_PROJECT_VERSION) 动态取值。
 *
 * 历史教训：Info.plist 里写死 0.1.0 时，发版脚本只升 MARKETING_VERSION，
 * 结果「文件名与清单是 0.2.1、包内 CFBundleShortVersionString 还是 0.1.0」——
 * 用户装完在系统里看到的版本号与官网不一致。因此这里 fail-closed。
 */
export function assertDynamicBundleVersion(plistPath = iosAppInfoPlistPath) {
  if (!fs.existsSync(plistPath)) {
    return;
  }
  const contents = fs.readFileSync(plistPath, "utf8");
  const fields = [
    ["CFBundleShortVersionString", "$(MARKETING_VERSION)"],
    ["CFBundleVersion", "$(CURRENT_PROJECT_VERSION)"],
  ];
  for (const [key, expected] of fields) {
    const match = contents.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u"));
    if (match && !match[1].includes("$(")) {
      throw new Error(
        `${plistPath} 的 ${key} 是写死的 "${match[1]}"，必须写成 ${expected}，` +
          "否则包内版本号不会随发版更新（会出现文件名与包内版本不一致）。",
      );
    }
  }
}

/** 更新工程里的 MARKETING_VERSION（全部配置）与 CURRENT_PROJECT_VERSION */
export function updateIosProject(nextVersion, nextBuild, projectPath = iosProjectPath) {
  const contents = fs.readFileSync(projectPath, "utf8");
  const updated = contents
    .replace(/MARKETING_VERSION\s*=\s*[^;]+;/gu, `MARKETING_VERSION = ${nextVersion};`)
    .replace(/CURRENT_PROJECT_VERSION\s*=\s*\d+;/gu, `CURRENT_PROJECT_VERSION = ${nextBuild};`);

  if (updated === contents) {
    throw new Error(`Failed to update version fields in ${projectPath}.`);
  }

  fs.writeFileSync(projectPath, updated);

  // 单一收口点：任何发版入口（version-ios / publish-ios）都会经过这里
  assertDynamicBundleVersion();
}

async function selectVersionType(currentVersion) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const options = ["patch", "minor", "major", "beta", "custom"];
  let selectedIndex = 0;
  const previewVersions = options.map((opt) =>
    opt === "custom" ? "x.y.z" : bumpIosVersion(currentVersion, opt),
  );

  const renderMenu = () => {
    console.clear();
    console.log(`\n当前 iOS 端版本: ${currentVersion}\n`);
    console.log("请选择版本类型 (使用 ↑/↓ 方向键选择, Enter 确认):\n");
    options.forEach((option, index) => {
      const prefix = index === selectedIndex ? "→" : " ";
      console.log(`  ${prefix} ${option.padEnd(10)} (${previewVersions[index]})`);
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
      rl.question("- ", (line) => {
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

  const { version: currentVersion, buildNumber: currentBuild } = readIosVersion();

  let nextVersion;
  if (versionArg) {
    nextVersion = bumpIosVersion(currentVersion, versionArg);
  } else if (!process.stdin.isTTY) {
    nextVersion = bumpIosVersion(currentVersion, "patch");
  } else {
    const versionType = await selectVersionType(currentVersion);
    nextVersion =
      versionType === "custom"
        ? await inputCustomVersion()
        : bumpIosVersion(currentVersion, versionType);
  }

  const nextBuild = currentBuild + 1;

  let changes;
  if (notesArg) {
    changes = [notesArg];
  } else if (!process.stdin.isTTY) {
    changes = ["优化 iOS 移动端使用体验与稳定性"];
  } else {
    changes = await inputChangelogEntries();
  }

  const pr = prArg ?? (process.stdin.isTTY ? await inputPr() : undefined);

  console.log(
    `\n开始更新 iOS 版本: ${currentVersion} (build: ${currentBuild}) -> ${nextVersion} (build: ${nextBuild})...`,
  );
  updateIosProject(nextVersion, nextBuild);

  updateChangelogFile({
    path: iosChangelogPath,
    version: nextVersion,
    notes: changes.join("\n"),
    pr,
  });

  if (fs.existsSync(iosChangelogEnPath)) {
    updateChangelogFile({
      path: iosChangelogEnPath,
      version: nextVersion,
      notes: changes.join("\n"),
      pr,
    });
  }

  console.log(
    `✅ Xcode 工程已更新: MARKETING_VERSION=${nextVersion}, CURRENT_PROJECT_VERSION=${nextBuild}`,
  );
  console.log("✅ apps/mobile/ios/CHANGELOG.md 已更新");
  console.log(`\n可执行 git diff 检查变更`);
}

if (process.argv[1] && process.argv[1].endsWith("version-ios.mjs")) {
  main().catch((error) => {
    console.error("\n❌ 错误:", error.message);
    process.exit(1);
  });
}
