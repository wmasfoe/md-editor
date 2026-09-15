#!/usr/bin/env node

/**
 * @file sync-mobile-web.mjs
 * @description 自动将 apps/mobile/core/dist 离线单页静态产物同步注入至 iOS 与 Android 原生工程目录中。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");

const SOURCE_DIST = path.join(ROOT_DIR, "apps/mobile/core/dist");
const TARGETS = [
  path.join(ROOT_DIR, "apps/mobile/ios/Inkpoint/Resources/editor"),
  path.join(ROOT_DIR, "apps/mobile/android/app/src/main/assets/editor"),
];

function syncDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[sync-mobile-web] Error: Source dist directory not found at: ${src}`);
    console.error(
      `[sync-mobile-web] Please run 'pnpm --filter @md-editor/mobile-core build' first.`,
    );
    process.exit(1);
  }

  // 确保父目录存在
  fs.mkdirSync(dest, { recursive: true });

  // 清理目标旧文件
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  // 递归复制产物
  fs.cpSync(src, dest, { recursive: true });

  console.log(`[sync-mobile-web] ✓ Successfully synced dist -> ${path.relative(ROOT_DIR, dest)}`);
}

function main() {
  console.log("[sync-mobile-web] Starting mobile web bundle distribution...");
  for (const target of TARGETS) {
    syncDirectory(SOURCE_DIST, target);
  }
  console.log("[sync-mobile-web] All mobile target directories synchronized successfully!");
}

main();
