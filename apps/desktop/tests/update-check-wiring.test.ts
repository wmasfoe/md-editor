import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const updatesHookSource = readFileSync(
  new URL("../src/app/updates/use-app-updates.ts", import.meta.url),
  "utf8",
);

const updaterSource = readFileSync(
  new URL("../src/app/updates/app-updater.ts", import.meta.url),
  "utf8",
);

const settingsContextSource = readFileSync(
  new URL("../src/app/settings-context.tsx", import.meta.url),
  "utf8",
);

const settingsControllerSource = readFileSync(
  new URL("../src/app/controller/useSettingsController.ts", import.meta.url),
  "utf8",
);

const desktopControllerSource = readFileSync(
  new URL("../src/app/controller/useDesktopEditorController.ts", import.meta.url),
  "utf8",
);

describe("update check wiring", () => {
  it("keeps the update state machine in one hook consumed by the settings context", () => {
    expect(settingsContextSource).toContain("useAppUpdates({");
    expect(settingsContextSource).not.toContain("checkForInstallableUpdate");
    expect(settingsControllerSource).not.toContain("checkForInstallableUpdate");
    expect(settingsControllerSource).toContain("await checkForUpdate()");
  });

  it("only lets the main window drive the updater; the settings window forwards commands", () => {
    // 插件按 webview 隔离更新包：两个窗口各自调用会各下一份、各装一次。
    expect(updatesHookSource).toContain('const isUpdateOwner = surface === "main"');
    expect(updatesHookSource).toContain('sendUpdateCommand("check")');
    expect(updatesHookSource).toContain('sendUpdateCommand("download")');
    expect(updatesHookSource).toContain("publishUpdateSnapshot(");
    expect(updatesHookSource).toContain("listenUpdateSnapshot(");
    // 「安装并重启」交给编辑器控制器，它负责未保存文档确认。
    expect(settingsControllerSource).toContain('sendUpdateCommand("apply")');
    expect(desktopControllerSource).toMatch(
      /listenUpdateCommands\(\(command\) => \{[\s\S]{0,400}runEditorUpdateActionRef\.current\(\)/u,
    );
  });

  it("treats a failed check as up to date and bounds the download time", () => {
    expect(updaterSource).not.toContain("checkForUpdates(");
    expect(updaterSource).toMatch(
      /catch \(error\) \{[\s\S]{0,200}return \{ status: upToDate, checkFailed: reason \};/u,
    );
    expect(updaterSource).toContain("timeout: DOWNLOAD_TIMEOUT_MS");
  });
});

describe("startup update check wiring", () => {
  it("checks for updates immediately once settings and prompt state are loaded", () => {
    // 启动检查不再有 30s 延迟：设置与提示簿记就绪后立刻执行一次。
    expect(updatesHookSource).not.toContain("AUTO_UPDATE_INITIAL_CHECK_DELAY_MS");

    const effectStart = updatesHookSource.indexOf("// 自动更新：设置与提示簿记就绪后立即检查一次");
    expect(effectStart).toBeGreaterThan(-1);

    const effectBody = updatesHookSource.slice(effectStart, effectStart + 1000);
    expect(effectBody).toContain("hasLoadedPromptState");
    expect(effectBody).toContain("void runUpdateCheck({ automatic: true });");
    expect(effectBody).toContain("AUTO_UPDATE_CHECK_INTERVAL_MS");
  });

  it("gates the modal on the first painted frame", () => {
    expect(updatesHookSource).toContain("requestAnimationFrame");
    expect(updatesHookSource).toContain("hasPaintedFirstFrame");
    expect(updatesHookSource).toContain("selectUpdatePresentation");
  });

  it("defers automatic download while the release-notes notice is still pending", () => {
    expect(updatesHookSource).toContain("shouldPresentUpdateNotice");
    expect(updatesHookSource).toContain("noticePending: willPresentNotice");
  });

  it("routes notice choices through the pure resolver and keeps 「稍后」 in memory", () => {
    expect(updatesHookSource).toContain("resolveUpdateNoticeChoice(choice, version");
    expect(updatesHookSource).toContain(
      "postponedVersionRef.current = resolution.postponedVersion",
    );
    expect(updatesHookSource).toContain("saveUpdatePromptState");
  });
});
