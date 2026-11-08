#!/usr/bin/env node

/**
 * @file build-android-apk.mjs
 * @description 编出 Android 的 Debug APK（Debug 签名，可直接装到真机或模拟器）。
 *
 * 用法:
 *   pnpm build:android                      # 同步前端资源后编出 dist-mobile/Inkpoint_<version>.apk
 *   pnpm build:android -- --no-sync         # 跳过前端资源同步（已手动执行过 pnpm build:mobile 时）
 *   pnpm build:android -- --version 0.3.0   # 覆盖 APK 文件名里的版本号，默认取 build.gradle.kts 的 versionName
 *
 * 前置: JDK 17 与 Android SDK（API 34）。SDK 位置由 ANDROID_HOME 或 apps/mobile/android/local.properties 指定。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const ANDROID_DIR = path.join(ROOT_DIR, "apps/mobile/android");
const GRADLE_FILE = path.join(ANDROID_DIR, "app/build.gradle.kts");
const APK_DIR = path.join(ANDROID_DIR, "app/build/outputs/apk/debug");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist-mobile");

function log(msg) {
  console.log(`\x1b[36m[build-android-apk]\x1b[0m ${msg}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT_DIR, ...opts });
}

/** 从 build.gradle.kts 读取 versionName。 */
export function readVersionName(gradleSource) {
  const match = /versionName\s*=\s*"([^"]+)"/u.exec(gradleSource);
  return match?.[1] ?? null;
}

/** 解析命令行参数；版本号只允许 semver，避免拼出带路径分隔符的文件名。 */
export function parseArgs(argv) {
  const options = { sync: true, version: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      // pnpm 会把 `pnpm build:xxx -- --flag` 里的分隔符原样传进来
      continue;
    } else if (arg === "--no-sync") {
      options.sync = false;
    } else if (arg === "--version") {
      options.version = argv[(i += 1)] ?? "";
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(options.version)) {
        throw new Error(`--version 需要形如 0.3.0 的版本号，收到: ${options.version || "(空)"}`);
      }
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

/** 优先用 JAVA_HOME；没有时尝试 Homebrew 的 openjdk@17。 */
function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const brewHome = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
  return fs.existsSync(brewHome) ? brewHome : null;
}

/** Gradle 找不到 SDK 时的报错很长，先检查并给出可以直接照做的提示。 */
function assertAndroidSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return;
  const localProps = path.join(ANDROID_DIR, "local.properties");
  if (fs.existsSync(localProps) && /^sdk\.dir\s*=/mu.test(fs.readFileSync(localProps, "utf8"))) {
    return;
  }
  throw new Error(
    "找不到 Android SDK。请安装 Android Studio（或 command-line tools），然后设置 ANDROID_HOME，\n" +
      `或在 ${path.relative(ROOT_DIR, localProps)} 里写入 sdk.dir=<SDK 路径>。`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const version = options.version ?? readVersionName(fs.readFileSync(GRADLE_FILE, "utf8"));
  if (!version) {
    throw new Error("读不到 build.gradle.kts 的 versionName，请用 --version 指定。");
  }

  assertAndroidSdk();

  // 编辑器 Web 资源是构建产物（被 .gitignore 忽略），不先同步的话 App 里没有界面。
  if (options.sync) {
    log("构建前端离线资源并同步到原生工程...");
    run("pnpm", ["run", "build:mobile"]);
  }

  const env = { ...process.env };
  const javaHome = resolveJavaHome();
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${env.PATH}`;
  }

  log("编译 Debug APK...");
  run("./gradlew", ["assembleDebug"], { cwd: ANDROID_DIR, env });

  const apkName = fs.readdirSync(APK_DIR).find((name) => name.endsWith(".apk"));
  if (!apkName) {
    throw new Error(`在 ${APK_DIR} 里找不到 .apk 产物`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const target = path.join(OUTPUT_DIR, `Inkpoint_${version}.apk`);
  fs.copyFileSync(path.join(APK_DIR, apkName), target);
  log(`完成: ${path.relative(ROOT_DIR, target)}`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`\x1b[31m[build-android-apk] ✗\x1b[0m ${error.message}`);
    process.exit(1);
  }
}
