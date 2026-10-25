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
      expect(invoke).toHaveBeenLastCalledWith("request_local_ai_continuation", { options });
    },
  );

  it("rejects browser preview before invoking native inference", async () => {
    vi.mocked(isTauri).mockReturnValueOnce(false);
    const callsBefore = vi.mocked(invoke).mock.calls.length;
    await expect(
      desktopLocalAiBridge(requests[0]!.options as LocalInferenceRequest),
    ).rejects.toThrow("Web 预览模式不支持本地模型推理");
    expect(invoke).toHaveBeenCalledTimes(callsBefore);
  });
});
