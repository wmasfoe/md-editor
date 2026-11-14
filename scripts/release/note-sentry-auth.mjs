#!/usr/bin/env node
/**
 * @fileoverview 发版打包前说明 Sentry source map 会不会上传。
 *
 * 没有 `SENTRY_AUTH_TOKEN` 时只警告，退出码仍是 0，构建继续。
 * 绝不打印 token 本身。
 */

const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
const inActions = process.env.GITHUB_ACTIONS === "true";

if (token) {
  console.log(
    "[sentry] SENTRY_AUTH_TOKEN is set. Desktop sourcemaps will upload as inkpoint@<version> with no dist.",
  );
  process.exit(0);
}

const detail =
  "SENTRY_AUTH_TOKEN is not set. Skipping Sentry sourcemap upload. Add the repository Actions secret with scopes project:releases and org:read (https://docs.sentry.io/api/permissions/).";

if (inActions) {
  console.log(`::warning::${detail}`);
} else {
  console.log(`[sentry] ${detail}`);
}
