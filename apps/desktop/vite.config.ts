import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json" with { type: "json" };

/**
 * 工作区包（`@md-editor/*`）不在此声明 Vite alias：
 * 它们经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * 别名只是重复的第二份入口描述，会随包增删漂移（历史上 desktop 就缺 file-system/shared/i18n）。
 * 解析契约回归测试见 `tests/vite-workspace-resolution.test.ts`。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    port: 7273,
    strictPort: true,
  },
  clearScreen: false,
});
