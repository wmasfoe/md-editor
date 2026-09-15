#!/usr/bin/env node

/**
 * @file run-ios.mjs
 * @description 一键编译前端离线资源并启动 iOS 模拟器或在 Xcode 中打开工程。
 *
 * 用法:
 *   pnpm run ios                  # 自动构建并启动 iOS 模拟器运行
 *   pnpm run ios -- --open        # 在 Xcode 中打开工程
 *   pnpm run ios -- --test        # 运行 Swift 契约测试套件
 *   pnpm run ios -- --device "iPhone 16" # 指定特定模拟器设备
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");
const IOS_DIR = path.join(ROOT_DIR, "apps/mobile/ios");
const XCODE_PROJ = path.join(IOS_DIR, "Inkpoint.xcodeproj");
const BUNDLE_ID = "com.inkpoint.editor";

function log(msg) {
  console.log(`\x1b[36m[run-ios]\x1b[0m ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m[run-ios] ✓\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[run-ios] ⚠\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[run-ios] ✗\x1b[0m ${msg}`);
}

function runCommand(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", cwd: ROOT_DIR, ...opts });
}

function getCommandOutput(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: ROOT_DIR,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldOpenXcode = args.includes("--open");
  const shouldRunTests = args.includes("--test");
  const skipSync = args.includes("--no-sync");
  const deviceIndex = args.indexOf("--device");
  const specifiedDevice = deviceIndex !== -1 ? args[deviceIndex + 1] : null;

  log("🚀 准备启动 Inkpoint iOS 端...");

  // 1. 同步与构建前端离线资源
  if (!skipSync) {
    const distHtml = path.join(ROOT_DIR, "apps/mobile/core/dist/index.html");
    if (!fs.existsSync(distHtml)) {
      log("构建前端移动端离线资源包...");
      runCommand("pnpm run build:mobile");
    } else {
      log("同步前端移动端静态产物到 iOS Resources...");
      runCommand("node scripts/mobile/sync-mobile-web.mjs");
    }
  }

  // 2. 如果指定了 --test，直接运行 Swift 契约测试
  if (shouldRunTests) {
    log("运行 Swift 原生通信协议与数据模型测试套件...");
    runCommand("swift run InkpointContractTests", { cwd: IOS_DIR });
    success("Swift 契约测试全部通过！");
    return;
  }

  // 3. 如果指定了 --open，直接调用系统 open 打开 Xcode
  if (shouldOpenXcode) {
    log(`正在 Xcode 中打开工程: ${path.relative(ROOT_DIR, XCODE_PROJ)}`);
    spawnSync("open", [XCODE_PROJ]);
    success("已在 Xcode 中打开工程！");
    return;
  }

  // 4. 检测 Xcode 与 xcodebuild 工具链
  const xcodeSelectPath = getCommandOutput("xcode-select -p");
  const hasXcodebuild = getCommandOutput("which xcodebuild");

  if (!hasXcodebuild || (xcodeSelectPath && xcodeSelectPath.includes("CommandLineTools"))) {
    warn("检测到当前命令行环境未配置完整 Xcode.app (当前为 CommandLineTools)");

    const xcodeAppPath = "/Applications/Xcode.app";
    if (fs.existsSync(xcodeAppPath)) {
      log(`发现 ${xcodeAppPath}，请在终端执行以下命令将命令行工具指向完整 Xcode：`);
      console.log(
        `\x1b[33m    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\x1b[0m\n`,
      );
    }

    log("正在尝试在系统关联的 Xcode 中打开工程...");
    const openResult = spawnSync("open", [XCODE_PROJ]);
    if (openResult.status === 0) {
      success("已为您唤起 Xcode，可在界面中选择模拟器或真机并点击 ▶ Run 运行！");
    } else {
      error(`无法自动打开 ${XCODE_PROJ}，请安装 Xcode 并在其中打开工程。`);
    }
    return;
  }

  // 5. 查询可用的 iOS 模拟器
  log("正在查询可用的 iOS 模拟器设备...");
  const simListJson = getCommandOutput("xcrun simctl list devices available -j");
  if (!simListJson) {
    warn("无法通过 simctl 查询模拟器，尝试直接在 Xcode 中打开工程...");
    spawnSync("open", [XCODE_PROJ]);
    return;
  }

  let devicesData;
  try {
    devicesData = JSON.parse(simListJson).devices;
  } catch {
    devicesData = {};
  }

  let targetDevice = null;
  let isAlreadyBooted = false;

  // 1. 如果用户显式指定了设备名称或 UDID
  if (specifiedDevice) {
    const searchKey = specifiedDevice.toLowerCase();
    for (const runtime of Object.keys(devicesData)) {
      if (!runtime.includes("iOS")) continue;
      const found = devicesData[runtime]?.find(
        (dev) =>
          dev.isAvailable &&
          (dev.name.toLowerCase().includes(searchKey) || dev.udid.toLowerCase() === searchKey),
      );
      if (found) {
        targetDevice = found;
        isAlreadyBooted = found.state === "Booted";
        break;
      }
    }
  }

  // 2. 如果未指定设备，优先寻找当前已处于 Booted 状态的 iPhone 模拟器
  if (!targetDevice) {
    for (const runtime of Object.keys(devicesData)) {
      if (!runtime.includes("iOS")) continue;
      const bootedDev = devicesData[runtime]?.find(
        (dev) => dev.isAvailable && dev.name.includes("iPhone") && dev.state === "Booted",
      );
      if (bootedDev) {
        targetDevice = bootedDev;
        isAlreadyBooted = true;
        break;
      }
    }
  }

  // 3. 如果没有任何模拟器已启动，寻找任意可用的 iPhone 模拟器
  if (!targetDevice) {
    for (const runtime of Object.keys(devicesData)) {
      if (!runtime.includes("iOS")) continue;
      const availableDev = devicesData[runtime]?.find(
        (dev) => dev.isAvailable && dev.name.includes("iPhone"),
      );
      if (availableDev) {
        targetDevice = availableDev;
        isAlreadyBooted = availableDev.state === "Booted";
        break;
      }
    }
  }

  if (!targetDevice) {
    warn("未检测到可用的 iOS 模拟器，正在唤起 Xcode...");
    spawnSync("open", [XCODE_PROJ]);
    return;
  }

  log(`选定目标模拟器: ${targetDevice.name} (${targetDevice.udid})`);

  // 6. 健壮启动模拟器与会话连接
  // 先通过 open -a Simulator 挂载图形环境会话，避免纯后台 simctl boot 触发 launchd_sim session 绑定失败
  spawnSync("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", targetDevice.udid]);

  if (!isAlreadyBooted) {
    log(`正在启动模拟器: ${targetDevice.name}...`);
    try {
      execSync(`xcrun simctl boot "${targetDevice.udid}"`, { stdio: "ignore" });
    } catch (bootErr) {
      // 忽略已启动或由 Simulator.app 托管中的竞争错误 (例如 exit code 149)
      const errMsg = String(bootErr?.stderr || bootErr?.message || "");
      if (!errMsg.includes("Booted") && !errMsg.includes("current state: Booted")) {
        // 如果遇到 launchd 绑定冲突，尝试 shutdown 后重试一次
        try {
          execSync(`xcrun simctl shutdown "${targetDevice.udid}"`, { stdio: "ignore" });
          execSync(`xcrun simctl boot "${targetDevice.udid}"`, { stdio: "ignore" });
        } catch {
          // 继续向下等待 bootstatus 判定就绪
        }
      }
    }

    log(`等待模拟器系统完全就绪 (${targetDevice.name})...`);
    try {
      execSync(`xcrun simctl bootstatus "${targetDevice.udid}" -b`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // 降级保护：继续执行
    }
  }

  // 7. 编译 iOS 原生 App
  log("正在构建 Inkpoint iOS Debug 产物...");
  const buildDir = path.join(ROOT_DIR, "build/ios-sim-build");
  fs.mkdirSync(buildDir, { recursive: true });

  const buildCmd = [
    "xcodebuild",
    "-project",
    `"${XCODE_PROJ}"`,
    "-scheme",
    "Inkpoint",
    "-destination",
    `"id=${targetDevice.udid}"`,
    "-configuration",
    "Debug",
    "-derivedDataPath",
    `"${buildDir}"`,
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ].join(" ");

  try {
    runCommand(buildCmd);
  } catch {
    error("xcodebuild 编译失败，正在尝试在 Xcode 中打开工程排查...");
    spawnSync("open", [XCODE_PROJ]);
    return;
  }

  // 8. 查找生成的 .app 产物
  const appPath = path.join(buildDir, "Build/Products/Debug-iphonesimulator/Inkpoint.app");
  if (!fs.existsSync(appPath)) {
    error(`未找到编译产物: ${appPath}`);
    return;
  }

  // 9. 安装并启动
  log(`正在将 Inkpoint.app 安装至模拟器 (${targetDevice.name})...`);
  runCommand(`xcrun simctl install "${targetDevice.udid}" "${appPath}"`);

  log(`正在启动应用 (${BUNDLE_ID})...`);
  const launchOutput = getCommandOutput(
    `xcrun simctl launch "${targetDevice.udid}" "${BUNDLE_ID}"`,
  );

  success(
    `Inkpoint 已成功在 ${targetDevice.name} 模拟器中启动！${launchOutput ? `(PID: ${launchOutput})` : ""}`,
  );
}

main().catch((err) => {
  error(`执行出错: ${err.message}`);
  process.exit(1);
});
