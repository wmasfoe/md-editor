import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsContextSource = readFileSync(
  new URL("../src/app/settings-context.tsx", import.meta.url),
  "utf8",
);

const settingsControllerSource = readFileSync(
  new URL("../src/app/controller/useSettingsController.ts", import.meta.url),
  "utf8",
);

describe("update check wiring", () => {
  it("keeps update checks flowing through shared settings context state", () => {
    expect(settingsContextSource).toContain("readonly checkForUpdate: () => Promise<UpdateStatus>");
    expect(settingsContextSource).toContain("setUpdateStatus(checkingStatus)");
    expect(settingsContextSource).toContain("setUpdateStatus(next)");
    expect(settingsContextSource).toContain(
      "downloadAvailableUpdate: settings.update.automaticDownload",
    );

    expect(settingsControllerSource).toMatch(
      /checkForUpdate,\s+downloadUpdate,\s+applyDownloadedUpdate,/u,
    );
    expect(settingsControllerSource).toContain("await checkForUpdate()");
    expect(settingsControllerSource).not.toContain("checkForInstallableUpdate");
    expect(settingsControllerSource).not.toContain("installPendingUpdate");
  });
});

describe("startup update check wiring", () => {
  it("checks for updates immediately once settings and prompt state are loaded", () => {
    // 启动检查不再有 30s 延迟：设置与提示簿记就绪后立刻执行一次。
    expect(settingsContextSource).not.toContain("AUTO_UPDATE_INITIAL_CHECK_DELAY_MS");

    const effectStart = settingsContextSource.indexOf(
      "// 自动更新：设置与提示簿记就绪后立即检查一次",
    );
    expect(effectStart).toBeGreaterThan(-1);

    const effectBody = settingsContextSource.slice(effectStart, effectStart + 1400);
    expect(effectBody).toContain("hasLoadedPromptState");
    expect(effectBody).toContain("void runAutomaticUpdateCheck();");
    expect(effectBody).toContain("AUTO_UPDATE_CHECK_INTERVAL_MS");
  });

  it("gates the modal on the first painted frame", () => {
    expect(settingsContextSource).toContain("requestAnimationFrame");
    expect(settingsContextSource).toContain("hasPaintedFirstFrame");
    expect(settingsContextSource).toContain("selectUpdatePresentation");
  });

  it("defers automatic download while the release-notes notice is still pending", () => {
    expect(settingsContextSource).toContain("shouldPresentUpdateNotice");
    expect(settingsContextSource).toContain("willPresentNotice");
  });

  it("records notified/skipped versions through the prompt state store", () => {
    expect(settingsContextSource).toContain("saveUpdatePromptState");
    expect(settingsContextSource).toContain("skippedVersion");
  });
});
