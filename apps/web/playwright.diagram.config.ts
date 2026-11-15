import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/components",
  outputDir: "./test-results/diagram-e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174/playground/",
    browserName: "chromium",
    locale: "zh-CN",
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174/playground/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  timeout: 60_000,
});
