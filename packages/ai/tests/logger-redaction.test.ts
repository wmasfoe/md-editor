import { afterEach, describe, expect, it, vi } from "vitest";

import * as logger from "../src/adapters/logger.ts";
import { LocalSlmClient, mayLogTaskContent, redactLlmLogDetails } from "../src/index.ts";

describe("LLM log redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("O-1: style-analysis previews are replaced by their lengths", () => {
    const redacted = redactLlmLogDetails({
      task: "style-analysis",
      promptPreview: "我在日记里写过的一段话",
      textPreview: "formal",
      latencyMs: 12,
    });

    expect(redacted).toEqual({
      task: "style-analysis",
      latencyMs: 12,
      promptLength: 11,
      textLength: 6,
      contentRedacted: true,
    });
    expect(JSON.stringify(redacted)).not.toContain("日记");
  });

  it("O-1: other tasks keep their previews", () => {
    const details = { task: "gec", promptPreview: "今天天气很好", textPreview: "[]" };
    expect(redactLlmLogDetails(details)).toBe(details);
    expect(mayLogTaskContent(undefined)).toBe(true);
    expect(mayLogTaskContent("completion")).toBe(true);
    expect(mayLogTaskContent("style-analysis")).toBe(false);
  });

  it("O-1: logLlmRequest and logLlmSuccess never print style-analysis content in dev", () => {
    vi.spyOn(logger, "isDevEnvironment").mockReturnValue(true);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    logger.logLlmRequest("LocalSLM", "standard", {
      task: "style-analysis",
      promptPreview: "私人文章正文",
    });
    logger.logLlmSuccess("LocalSLM", "standard", {
      task: "style-analysis",
      textPreview: "私人模型输出",
    });

    // logger 内部经 isDevEnvironment 判断；无论是否命中 dev 分支，正文都不能出现在任何参数里。
    for (const call of debug.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("私人");
    }
  });

  it("O-2: LocalSlmClient tags success logs with the task so redaction applies", async () => {
    const success = vi.spyOn(logger, "logLlmSuccess");
    const request = vi.spyOn(logger, "logLlmRequest");
    const client = new LocalSlmClient("md-editor-writer-standard", async () => "formal");

    await client.generate({
      instruction: "classify",
      prompt: "私人文章正文",
      task: "style-analysis",
    });

    expect(request.mock.calls[0]?.[2]).toMatchObject({ task: "style-analysis" });
    expect(success.mock.calls[0]?.[2]).toMatchObject({ task: "style-analysis" });
    for (const call of [...request.mock.calls, ...success.mock.calls]) {
      expect(JSON.stringify(redactLlmLogDetails(call[2]))).not.toContain("私人");
    }
  });
});
