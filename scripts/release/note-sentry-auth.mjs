#!/usr/bin/env node
/**
 * @fileoverview 发版打包前说明 Sentry source map 会不会上传。
 *
 * 默认没有 `SENTRY_AUTH_TOKEN` 时只警告，退出码仍是 0，构建继续。
 * `--require` 时 token 缺失或只有空白则退出码 1。正式版工作流用它挡住无 map 的发布；
 * beta 不传该参数。绝不打印 token 本身。
 */

const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
const inActions = process.env.GITHUB_ACTIONS === "true";
const requireToken = process.argv.includes("--require");

if (token) {
  console.log(
    "[sentry] SENTRY_AUTH_TOKEN is set. Desktop sourcemaps will upload as inkpoint@<version> with no dist.",
  );
  process.exit(0);
}

const scopes =
  "Add the repository Actions secret with scopes project:releases and org:read (https://docs.sentry.io/api/permissions/).";
const detail = requireToken
  ? `SENTRY_AUTH_TOKEN is not set. Refusing the stable desktop release so it cannot ship without a Sentry sourcemap upload. ${scopes}`
  : `SENTRY_AUTH_TOKEN is not set. Skipping Sentry sourcemap upload. ${scopes}`;

if (requireToken) {
  // Workflow commands are only recognized on stdout.
  if (inActions) {
    console.log(`::error::${detail}`);
  } else {
    console.error(`[sentry] ${detail}`);
  }
  process.exit(1);
}

if (inActions) {
  console.log(`::warning::${detail}`);
} else {
  console.log(`[sentry] ${detail}`);
}
