#!/usr/bin/env node
/**
 * @fileoverview 构建失败条件：产物里仍有 .map 或 sourceMappingURL。
 *
 * 扫描前端输出目录，以及 Tauri 打包目录（含 .app、以及 tar/zip/deb 成员名）。
 * 压缩安装包内部若已压缩，明文扫描可能看不见 map；真正的闸门是打包前的
 * `frontendDist`（apps/desktop/dist），Tauri 嵌入的就是这份目录。
 *
 * 用法：
 *   node scripts/release/assert-no-sourcemaps.mjs apps/desktop/dist apps/desktop/src-tauri/target/release/bundle
 */

import path from "node:path";
import { findShippedSourcemaps } from "./sourcemaps.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/release/assert-no-sourcemaps.mjs <dist-or-bundle> [more-paths...]",
  );
  process.exit(1);
}

const roots = args.map((arg) => path.resolve(process.cwd(), arg));
const violations = findShippedSourcemaps(roots);
if (violations.length > 0) {
  console.error("[sentry] Sourcemap guard failed. Built output still ships sourcemaps:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`[sentry] No .map files or sourceMappingURL comments in ${roots.join(", ")}.`);
