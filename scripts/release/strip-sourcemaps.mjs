#!/usr/bin/env node
/**
 * @fileoverview 删除构建产物中的 source map。
 *
 * 没有 `SENTRY_AUTH_TOKEN` 时上传步骤不会运行（Vite 插件不挂载），
 * 这里仍然删除 map 并打印明确日志，构建不因此失败。
 *
 * 用法（路径相对当前工作目录）：
 *   node scripts/release/strip-sourcemaps.mjs dist
 *   node scripts/release/strip-sourcemaps.mjs apps/desktop/dist
 */

import path from "node:path";
import { stripSourcemaps } from "./sourcemaps.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/release/strip-sourcemaps.mjs <dist-dir> [more-dirs...]");
  process.exit(1);
}

const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
if (token) {
  console.log(
    "[sentry] SENTRY_AUTH_TOKEN is set; sourcemap upload runs in the Vite build (release inkpoint@<version>, no dist). Removing local sourcemaps so they are not shipped.",
  );
} else {
  console.log(
    "[sentry] SENTRY_AUTH_TOKEN is not set; skipping Sentry sourcemap upload. Sourcemaps are still removed so they are not shipped.",
  );
}

let mapFilesRemoved = 0;
let filesRewritten = 0;
for (const arg of args) {
  const root = path.resolve(process.cwd(), arg);
  const result = stripSourcemaps(root);
  mapFilesRemoved += result.mapFilesRemoved;
  filesRewritten += result.filesRewritten;
  console.log(
    `[sentry] Cleaned ${root}: removed ${result.mapFilesRemoved} sourcemap file(s), stripped sourceMappingURL from ${result.filesRewritten} file(s).`,
  );
}

console.log(
  `[sentry] Sourcemap cleanup finished: removed ${mapFilesRemoved} sourcemap file(s), stripped sourceMappingURL from ${filesRewritten} file(s).`,
);
