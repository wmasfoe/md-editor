import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalInferenceRequest } from "@md-editor/ai";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { desktopLocalAiBridge } from "../src/app/ai/local-ai-model";
import requests from "./fixtures/local-ai-inference-requests.json";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

describe("local AI bridge contract shared with Rust", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(requests)(
    "forwards $options.modelId / $options.task without editor context",
    async ({ options }) => {
      vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
      vi.spyOn(console, "group").mockImplementation(() => {});
      vi.spyOn(console, "groupEnd").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "debug").mockImplementation(() => {});
      vi.mocked(invoke).mockResolvedValueOnce("模型正文");

      expect(await desktopLocalAiBridge(options as LocalInferenceRequest)).toBe("模型正文");
      expect(invoke).toHaveBeenLastCalledWith("request_local_ai_continuation", {
        options: expect.objectContaining({
          ...options,
          requestId: expect.any(String),
        }),
      });
    },
  );

  it("triggers cancel_local_ai_request IPC when signal aborts during in-flight inference", async () => {
    let resolveInference!: (value: string) => void;
    const pendingInference = new Promise<string>((resolve) => {
      resolveInference = resolve;
    });

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "request_local_ai_continuation") {
        return pendingInference;
      }
      return null;
    });

    const abortController = new AbortController();
    const bridgePromise = desktopLocalAiBridge(requests[0]!.options as LocalInferenceRequest, {
      signal: abortController.signal,
    });

    // 模拟用户在打字期间触发了 abort
    abortController.abort();

    expect(invoke).toHaveBeenCalledWith("cancel_local_ai_request", {
      requestId: expect.stringMatching(/^local-/),
    });

    resolveInference("done");
    await bridgePromise;
  });

  it("O-4: never prints style-analysis prompts or outputs in dev logs", async () => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "group").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.mocked(invoke).mockResolvedValueOnce("私人模型输出");

    await desktopLocalAiBridge({
      modelId: "md-editor-writer-standard",
      task: "style-analysis",
      messages: [{ role: "user", content: "私人文章正文" }],
      maxTokens: 16,
    } as LocalInferenceRequest);

    // 本测试运行在 DEV 下，日志分支确实执行过。
    expect(log).toHaveBeenCalled();
    for (const call of [...log.mock.calls, ...debug.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("私人");
    }
  });

  it("O-4: keeps logging content for ordinary tasks", async () => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "group").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.mocked(invoke).mockResolvedValueOnce("普通输出");

    await desktopLocalAiBridge(requests[0]!.options as LocalInferenceRequest);

    expect(log.mock.calls.some((call) => JSON.stringify(call).includes("普通输出"))).toBe(true);
  });

  it("rejects browser preview before invoking native inference", async () => {
    vi.mocked(isTauri).mockReturnValueOnce(false);
    const callsBefore = vi.mocked(invoke).mock.calls.length;
    await expect(
      desktopLocalAiBridge(requests[0]!.options as LocalInferenceRequest),
    ).rejects.toThrow("Web 预览模式不支持本地模型推理");
    expect(invoke).toHaveBeenCalledTimes(callsBefore);
  });
});
