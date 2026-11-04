import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import packageJson from "./package.json" with { type: "json" };
import {
  resolveSentrySourcemapTarget,
  sentryViteReleaseOptions,
  shouldEmitDesktopSourcemaps,
} from "./src/app/error-reporting/sentry-release.ts";

/**
 * 工作区包（`@md-editor/*`）不在此声明 Vite alias：
 * 它们经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * 别名只是重复的第二份入口描述，会随包增删漂移（历史上 desktop 就缺 file-system/shared/i18n）。
 * 解析契约回归测试见 `tests/vite-workspace-resolution.test.ts`。
 *
 * Source map：只在打进安装包的生产构建生成 hidden map。上传由 Sentry 插件完成，
 * 删除由 `package.json` 的 `build` 脚本在 `vite build` 之后执行，避免把 .map 打进 Tauri。
 */
const emitSourcemaps = shouldEmitDesktopSourcemaps(process.env, process.argv);
const sentryTarget = resolveSentrySourcemapTarget(process.env, packageJson.version);

if (emitSourcemaps && sentryTarget.upload) {
  console.log(
    `[sentry] Uploading sourcemaps to ${sentryTarget.org}/${sentryTarget.project} as ${sentryTarget.releaseName} with no dist.`,
  );
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // 必须放在其它插件之后，Debug ID 才能打进最终产物。
    // 没有 token 时不挂载插件：上传被跳过，后续 strip 脚本仍会删掉 map。
    ...(emitSourcemaps && sentryTarget.upload
      ? sentryVitePlugin({
          org: sentryTarget.org,
          project: sentryTarget.project,
          authToken: sentryTarget.authToken,
          telemetry: false,
          release: sentryViteReleaseOptions(packageJson.version),
          sourcemaps: {
            assets: "./dist/**",
          },
        })
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // hidden：写出 .map，但不在 JS/CSS 里留 sourceMappingURL。
    sourcemap: emitSourcemaps ? "hidden" : false,
  },
  server: {
    port: 7273,
    strictPort: true,
  },
  clearScreen: false,
});
