import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 回归：`useStyleLearning` 挂在 DesktopEditorActionsContext 的 Provider 之上，
 * 不能从 context 读 actions（读到 null 会让主窗口崩溃），必须由调用方显式传入。
 */
describe("style learning hook position", () => {
  const appSource = readFileSync(new URL("../../../src/app/App.tsx", import.meta.url), "utf8");
  const hookSource = readFileSync(
    new URL("../../../src/app/ai/style-learning/use-style-learning.ts", import.meta.url),
    "utf8",
  );

  it("passes actions explicitly instead of reading the context", () => {
    expect(appSource).toContain("useStyleLearning(actions)");
    expect(hookSource).not.toContain("useDesktopEditorActions()");
    expect(hookSource).toContain("actions: Pick<DesktopEditorActions");
  });

  it("invokes the hook above the provider that supplies actions", () => {
    const hookIndex = appSource.indexOf("useStyleLearning(actions)");
    const providerIndex = appSource.indexOf("<DesktopEditorActionsContext value={actions}>");
    expect(hookIndex).toBeGreaterThan(-1);
    expect(providerIndex).toBeGreaterThan(-1);
    // Provider 在 return 里、hook 在函数体前部：hook 一定在 Provider 之外。
    expect(hookIndex).toBeLessThan(providerIndex);
  });
});
