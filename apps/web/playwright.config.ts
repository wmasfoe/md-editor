import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/plugin-preview",
  use: { baseURL: "http://127.0.0.1:5174", browserName: "chromium", locale: "zh-CN" },
  webServer: {
    command: "pnpm exec vite preview --host 127.0.0.1 --port 5174",
    port: 5174,
    reuseExistingServer: true,
  },
});
