#!/usr/bin/env node

/**
 * @file build-ios-ipa.mjs
 * @description 在 macOS 上编出未签名的 iOS device 版 IPA，供自行签名安装。
 *
 * 未签名包不带证书和描述文件，需要用 Sideloadly、AltStore 等工具重签后才能装到真机。
 *
 * 用法:
 *   pnpm build:ios                        # 同步前端资源后编出 dist-mobile/Inkpoint-<version>-unsigned.ipa
 *   pnpm build:ios -- --no-sync           # 跳过前端资源同步（已手动执行过 pnpm build:mobile 时）
 *   pnpm build:ios -- --version 0.3.0     # 覆盖 IPA 文件名里的版本号，默认取工程的 MARKETING_VERSION
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const IOS_DIR = path.join(ROOT_DIR, "apps/mobile/ios");
const XCODE_PROJ = path.join(IOS_DIR, "Inkpoint.xcodeproj");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist-mobile");

function log(msg) {
  console.log(`\x1b[36m[build-ios-ipa]\x1b[0m ${msg}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT_DIR, ...opts });
}

/** 从 Xcode 工程读取 MARKETING_VERSION；Debug 与 Release 配置的取值一致，取第一处即可。 */
export function readMarketingVersion(pbxprojSource) {
  const match = /MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/u.exec(pbxprojSource);
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

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (process.platform !== "darwin") {
    throw new Error("编译 iOS 需要 macOS 与完整的 Xcode。");
  }

  const version =
    options.version ??
    readMarketingVersion(fs.readFileSync(path.join(XCODE_PROJ, "project.pbxproj"), "utf8"));
  if (!version) {
    throw new Error("读不到工程的 MARKETING_VERSION，请用 --version 指定。");
  }

  // 编辑器 Web 资源是构建产物（被 .gitignore 忽略），不先同步的话 App 里没有界面。
  if (options.sync) {
    log("构建前端离线资源并同步到原生工程...");
    run("pnpm", ["run", "build:mobile"]);
  }

  const derivedData = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-ios-"));
  try {
    // 关掉签名才能得到可重签的包；同时清空 entitlements，避免工程里残留的权限声明要求证书。
    log("编译 Release（device，未签名）...");
    run("xcodebuild", [
      "-project",
      XCODE_PROJ,
      "-scheme",
      "Inkpoint",
      "-configuration",
      "Release",
      "-sdk",
      "iphoneos",
      "-destination",
      "generic/platform=iOS",
      "-derivedDataPath",
      derivedData,
      "clean",
      "build",
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=",
      "CODE_SIGN_ENTITLEMENTS=",
      "PROVISIONING_PROFILE_SPECIFIER=",
    ]);

    const productsDir = path.join(derivedData, "Build/Products/Release-iphoneos");
    const appName = fs.readdirSync(productsDir).find((name) => name.endsWith(".app"));
    if (!appName) {
      throw new Error(`在 ${productsDir} 里找不到 .app 产物`);
    }
    const appPath = path.join(productsDir, appName);
    if (!fs.existsSync(path.join(appPath, "editor/index.html"))) {
      throw new Error("产物里缺少 editor/index.html，请去掉 --no-sync 重新执行。");
    }

    // IPA 就是把 .app 放进 Payload/ 后打成 zip。
    const staging = path.join(derivedData, "ipa-staging");
    fs.mkdirSync(path.join(staging, "Payload"), { recursive: true });
    fs.cpSync(appPath, path.join(staging, "Payload", appName), { recursive: true });

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const ipaPath = path.join(OUTPUT_DIR, `Inkpoint-${version}-unsigned.ipa`);
    fs.rmSync(ipaPath, { force: true });
    run("zip", ["-qry", ipaPath, "Payload"], { cwd: staging });

    log(`完成: ${path.relative(ROOT_DIR, ipaPath)}`);
  } finally {
    fs.rmSync(derivedData, { recursive: true, force: true });
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`\x1b[31m[build-ios-ipa] ✗\x1b[0m ${error.message}`);
    process.exit(1);
  }
}
