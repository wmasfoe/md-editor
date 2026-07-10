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

    expect(settingsControllerSource).toContain(
      "checkForUpdate, downloadUpdate, applyDownloadedUpdate",
    );
    expect(settingsControllerSource).toContain("await checkForUpdate()");
    expect(settingsControllerSource).not.toContain("checkForInstallableUpdate");
    expect(settingsControllerSource).not.toContain("installPendingUpdate");
  });
});
