import { describe, expect, it } from "vitest";
import {
  buildSlmPrompt,
  getSlmStopTokens,
  resolveGecTaskToken,
  TASK_GEC_EN,
  TASK_GEC_ZH,
} from "../src/slm-protocol.ts";
import type { AiContextSnapshot } from "../src/types.ts";

describe("slm-protocol: Prompt 拼装与 Token 映射", () => {
  const mockContext: AiContextSnapshot = {
    before: "React 是一个用于构建 Web 客户端",
    after: "的 JavaScript 库。",
    selectedText: "",
    mode: "wysiwyg",
    document: { language: "zh" },
  };

  it("正确识别多语种 GEC Task Tokens", () => {
    expect(resolveGecTaskToken("zh")).toBe(TASK_GEC_ZH);
    expect(resolveGecTaskToken("en")).toBe(TASK_GEC_EN);
    expect(resolveGecTaskToken("english")).toBe(TASK_GEC_EN);
    expect(resolveGecTaskToken("unknown")).toBe(TASK_GEC_ZH);
  });

  it("拼装结构 A 的 FIM 续写 Prompt", () => {
    const prompt = buildSlmPrompt(mockContext, "continuation");
    expect(prompt).toContain("<|im_start|>user\n");
    expect(prompt).toContain("[User Style Profile]");
    expect(prompt).toContain(
      "<|fim_prefix|>React 是一个用于构建 Web 客户端<|fim_suffix|>的 JavaScript 库。<|fim_middle|>",
    );
    expect(prompt).toContain("<|im_end|>\n<|im_start|>assistant\n");
  });

  it("拼装语法纠错 Prompt", () => {
    const editContext: AiContextSnapshot = {
      ...mockContext,
      selectedText: "今天天气很好，但是我想出去玩。",
    };
    const prompt = buildSlmPrompt(editContext, "editing", { language: "zh" });
    expect(prompt).toBe(
      "<|im_start|>user\n<|task_gec_zh|>今天天气很好，但是我想出去玩。<|im_end|>\n<|im_start|>assistant\n",
    );
  });

  it("根据任务动态返回 Stop Tokens", () => {
    // 行内极速 Ghost Text 必须包含 \n
    expect(getSlmStopTokens("continuation", { isGhostText: true })).toContain("\n");
    // 主动段落续写允许换行
    expect(getSlmStopTokens("continuation", { isGhostText: false })).not.toContain("\n");
    // 语法纠错必须遇到换行立即终止
    expect(getSlmStopTokens("editing")).toContain("\n");
  });
});
