import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import packageJson from "./package.json" with { type: "json" };
import {
  resolveSentrySourcemapTarget,
  sentryViteReleaseOptions,
  shouldUploadDesktopSourcemaps,
  warnSentryUploadFailure,
} from "./src/app/error-reporting/sentry-release.ts";

/**
 * 工作区包（`@md-editor/*`）不在此声明 Vite alias：
 * 它们经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * 别名只是重复的第二份入口描述，会随包增删漂移（历史上 desktop 就缺 file-system/shared/i18n）。
 * 解析契约回归测试见 `tests/vite-workspace-resolution.test.ts`。
 *
 * Source map：只在发版生产构建且存在 `SENTRY_AUTH_TOKEN` 时生成 hidden map。
 * 插件上传后用 `filesToDeleteAfterUpload` 删除 `.map`。没有 token 时不挂插件，
 * 也不生成 map。`package.json` 的 `build` 脚本仍会再扫一遍 dist，
 * Tauri 的 `frontendDist` 是 `../dist`，`bundle.resources` 为空，安装包不会带上映射。
 */
const sentryTarget = resolveSentrySourcemapTarget(process.env, packageJson.version);
const uploadSourcemaps = shouldUploadDesktopSourcemaps(
  process.env,
  process.argv,
  packageJson.version,
);

if (uploadSourcemaps) {
  console.log(
    `[sentry] Uploading sourcemaps to ${sentryTarget.org}/${sentryTarget.project} as ${sentryTarget.releaseName} with no dist.`,
  );
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // 必须放在其它插件之后，Debug ID 才能打进最终产物。
    // 没有 token 时不挂载插件，上传整个跳过。
    ...(uploadSourcemaps
      ? sentryVitePlugin({
          org: sentryTarget.org,
          project: sentryTarget.project,
          authToken: sentryTarget.authToken,
          telemetry: false,
          // token 失效或 Sentry 不可用时只警告，不让 vite build 失败。
          errorHandler: warnSentryUploadFailure,
          release: sentryViteReleaseOptions(packageJson.version),
          sourcemaps: {
            assets: "./dist/**",
            // 上传结束后删除 map。插件在 writeBundle 的 finally 里执行，上传失败也会删。
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
        })
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // hidden：写出 .map 供上传，但不在 JS/CSS 里留 sourceMappingURL。
    // 没有 token 时为 false，vite build 的 dist 里不会出现 .map。
    sourcemap: uploadSourcemaps ? "hidden" : false,
  },
  server: {
    port: 7273,
    strictPort: true,
  },
  clearScreen: false,
});
