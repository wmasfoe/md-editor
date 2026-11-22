import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry, createDocumentState } from "../src/index.ts";

/**
 * L-1 / L-1b：命令派发的控制台契约。
 *
 * - 成功路径**不产生**任何 `console.*`：`@md-editor/core` 是发布给宿主的库，
 *   不应污染宿主控制台（此前每次 dispatch 打 3 行 log）。
 * - 失败路径必须**保留可观察诊断**：`dispatch` 的 `boolean` 返回值在生产调用点
 *   被丢弃（如 `useDesktopEditorController.ts:165`），若同时删掉 warn，
 *   "命令 id 不存在"就变成完全静默的 no-op。
 */
const context = () => ({ document: createDocumentState({ markdown: "" }) });

describe("命令派发的控制台契约", () => {
  it("成功派发不产生 console.log / console.warn / console.error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const commands = createCommandRegistry();
      const run = vi.fn();
      commands.register({ id: "probe.ok", title: "Probe", run });
      await expect(commands.dispatch("probe.ok", context())).resolves.toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("未注册的命令仍返回 false，并且留下可观察诊断", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const commands = createCommandRegistry();
      await expect(commands.dispatch("probe.missing", context())).resolves.toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      // id 是 warn 的第二个实参（不是拼进首参），断言两者都带上。
      expect(warn.mock.calls[0]?.join(" ")).toContain("probe.missing");
    } finally {
      warn.mockRestore();
    }
  });
});
