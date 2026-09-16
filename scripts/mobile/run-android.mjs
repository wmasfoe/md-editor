#!/usr/bin/env node

/**
 * @file run-android.mjs
 * @description 一键编译前端离线资源并构建/安装/启动 Android 模拟器或真机。
 *
 * 用法:
 *   pnpm run android                  # 自动构建并在连接的 Android 设备/模拟器上安装启动
 *   pnpm run android -- --open        # 在 Android Studio 中打开工程
 *   pnpm run android -- --test        # 运行 Android 契约与单元测试
 *   pnpm run android -- --build-only  # 仅构建 Debug APK，不启动设备
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");
const ANDROID_DIR = path.join(ROOT_DIR, "apps/mobile/android");
const PACKAGE_NAME = "com.inkpoint.editor";
const ACTIVITY_NAME = ".MainActivity";

function log(msg) {
  console.log(`\x1b[36m[run-android]\x1b[0m ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m[run-android] ✓\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[run-android] ⚠\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[run-android] ✗\x1b[0m ${msg}`);
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

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  // 扫描 macOS 常见 JDK 安装路径与 Android Studio 内置 JBR
  const candidateDirs = [
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  ];

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) return dir;
  }

  // 扫描 /Library/Java/JavaVirtualMachines
  const jvmRoot = "/Library/Java/JavaVirtualMachines";
  if (fs.existsSync(jvmRoot)) {
    const entries = fs.readdirSync(jvmRoot);
    for (const entry of entries) {
      const homePath = path.join(jvmRoot, entry, "Contents/Home");
      if (fs.existsSync(homePath)) return homePath;
    }
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldOpenStudio = args.includes("--open");
  const shouldRunTests = args.includes("--test");
  const buildOnly = args.includes("--build-only");
  const skipSync = args.includes("--no-sync");

  log("🤖 准备启动 Inkpoint Android 端...");

  // 1. 同步与构建前端离线资源
  if (!skipSync) {
    log("构建前端移动端离线资源包并同步至各原生工程...");
    runCommand("pnpm run build:mobile");
  }

  // 2. 如果指定了 --open，调用系统 open 打开 Android Studio
  if (shouldOpenStudio) {
    log(`正在尝试在 Android Studio 中打开工程: ${path.relative(ROOT_DIR, ANDROID_DIR)}`);
    const openRes = spawnSync("open", ["-a", "Android Studio", ANDROID_DIR]);
    if (openRes.status === 0) {
      success("已在 Android Studio 中打开工程！");
    } else {
      spawnSync("open", [ANDROID_DIR]);
      success("已打开 Android 工程目录！");
    }
    return;
  }

  // 3. 检测 JDK 环境
  const javaHome = findJavaHome();
  const env = { ...process.env };
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, "bin")}:${env.PATH}`;
  }

  const javaCheck = spawnSync("java", ["-version"], { env, encoding: "utf8" });
  const hasRealJava = javaCheck.status === 0;

  if (!hasRealJava) {
    warn("未在系统中检测到可用的 Java Runtime (JDK 17+)");
    console.log("\x1b[33m建议通过 Homebrew 一键安装 JDK 17：\x1b[0m");
    console.log("    brew install openjdk@17");
    console.log(
      "    sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk",
    );
    console.log("\n或者直接在 Android Studio 中打开工程运行：");
    console.log("    pnpm run android -- --open\n");

    log("正在尝试为您打开 Android Studio 或工程目录...");
    const openRes = spawnSync("open", ["-a", "Android Studio", ANDROID_DIR]);
    if (openRes.status !== 0) {
      spawnSync("open", [ANDROID_DIR]);
    }
    return;
  }

  // 4. 检查是否有 gradlew 脚本，并确保其可执行权限
  const gradlewPath = path.join(ANDROID_DIR, "gradlew");
  if (fs.existsSync(gradlewPath)) {
    try {
      fs.chmodSync(gradlewPath, "755");
    } catch {}
  }

  // 5. 如果指定了 --test，运行单元测试
  if (shouldRunTests) {
    log("运行 Android 契约与单元测试...");
    runCommand("./gradlew testDebugUnitTest", { cwd: ANDROID_DIR, env });
    success("Android 单元测试全部通过！");
    return;
  }

  // 6. 检测 ADB 设备连接状态
  const adbPath = getCommandOutput("which adb", { env });
  let connectedDevices = [];
  if (adbPath) {
    const devicesOutput = getCommandOutput("adb devices", { env });
    if (devicesOutput) {
      const lines = devicesOutput.split("\n").slice(1);
      connectedDevices = lines
        .map((l) => l.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && parts[1] === "device")
        .map((parts) => parts[0]);
    }
  }

  // 7. 如果没有连接设备且未指定仅构建，检查是否有可用的 AVD 模拟器
  if (connectedDevices.length === 0 && !buildOnly) {
    log("未检测到已连接的 Android 物理设备或运行中的模拟器。");
    const emulatorPath = getCommandOutput("which emulator", { env });
    let avdList = [];
    if (emulatorPath) {
      const avdsOutput = getCommandOutput("emulator -list-avds", { env });
      if (avdsOutput) {
        avdList = avdsOutput
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    if (avdList.length > 0) {
      const avdName = avdList[0];
      log(`发现本地 AVD 模拟器: ${avdName}，正在启动...`);
      spawnSync("emulator", ["-avd", avdName], { detached: true, stdio: "ignore" });
      log("等待模拟器启动就绪 (adb wait-for-device)...");
      runCommand("adb wait-for-device", { env });
      connectedDevices = [avdName];
    } else {
      warn("未找到已连接设备或本地 AVD 模拟器，将仅构建 Debug APK 产物。");
      log("提示：可连接 Android 手机并开启 USB 调试，或在 Android Studio 中创建并启动一个 AVD。");
    }
  }

  // 8. 构建并安装
  if (connectedDevices.length > 0 && !buildOnly) {
    log(`正在将应用构建并安装至目标设备: ${connectedDevices[0]}...`);
    runCommand("./gradlew installDebug", { cwd: ANDROID_DIR, env });

    log(`正在启动应用 (${PACKAGE_NAME}/${ACTIVITY_NAME})...`);
    runCommand(`adb shell am start -n ${PACKAGE_NAME}/${ACTIVITY_NAME}`, { env });

    success(`Inkpoint 已在 Android 设备 (${connectedDevices[0]}) 上成功启动！`);
  } else {
    log("正在构建 Android Debug APK...");
    runCommand("./gradlew assembleDebug", { cwd: ANDROID_DIR, env });
    const apkPath = path.join(ANDROID_DIR, "app/build/outputs/apk/debug/app-debug.apk");
    if (fs.existsSync(apkPath)) {
      success(`APK 构建成功！输出位置: ${path.relative(ROOT_DIR, apkPath)}`);
    } else {
      success("APK 构建完成！");
    }
  }
}

main().catch((err) => {
  error(`执行出错: ${err.message}`);
  process.exit(1);
});
