import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 工作区包（`@md-editor/*`）不在此声明 Vite alias：
 * 它们经 pnpm workspace link + `package.json#exports`（指向 `./src/index.ts`）解析到源码，
 * 别名只是重复的第二份入口描述，会随包增删漂移。
 * 解析契约回归测试见 `tests/vite-workspace-resolution.test.ts`。
 */
export default defineConfig({
  // Web 应用作为子路由挂载在官网的 /playground 路径下
  base: process.env.VITE_BASE_PATH || "/playground/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
  },
  clearScreen: false,
});
