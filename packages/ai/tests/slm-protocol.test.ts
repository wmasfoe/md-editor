import { describe, expect, it } from "vitest";
import {
  buildDocumentContextPrefix,
  buildSlmPrompt,
  detectGecTaskToken,
  getSlmStopTokens,
  resolveCapabilityProfile,
  resolveGecTaskToken,
  TASK_DISTILL,
  TASK_GEC_EN,
  TASK_GEC_MIXED,
  TASK_GEC_ZH,
} from "../src/slm-protocol.ts";
import type { AiContextSnapshot, AiDocumentContext } from "../src/types.ts";

describe("slm-protocol: Prompt 拼装与 Token 映射", () => {
  const mockContext: AiContextSnapshot = {
    before: "React 是一个用于构建 Web 客户端",
    after: "的 JavaScript 库。",
    selectedText: "",
    mode: "wysiwyg",
    document: { language: "zh" },
  };

  it("正确识别多语种与三态 GEC Task Tokens", () => {
    expect(resolveGecTaskToken("zh")).toBe(TASK_GEC_ZH);
    expect(resolveGecTaskToken("en")).toBe(TASK_GEC_EN);
    expect(resolveGecTaskToken("english")).toBe(TASK_GEC_EN);
    expect(resolveGecTaskToken("unknown")).toBe(TASK_GEC_ZH);

    // 三态动态识别
    expect(detectGecTaskToken("今天天气很好，但是我想出去玩。")).toBe(TASK_GEC_ZH);
    expect(detectGecTaskToken("The quick brown fox jumps over the lazy dog.")).toBe(TASK_GEC_EN);
    expect(detectGecTaskToken("今天学习了 this is a apple，并调用了 Tauri invoke")).toBe(
      TASK_GEC_MIXED,
    );
  });

  it("构造结构化的 [Document Context] 前缀", () => {
    const docContext: AiDocumentContext = {
      title: "Rust 异步运行时实战",
      outline: ["1. 核心概念", "2. 调度器实现"],
      topic: "解析 Rust 异步运行时调度原理与高并发调优实践",
      domain: "系统编程 / 技术实战",
      tags: ["rust", "async", "runtime"],
    };

    const prefix = buildDocumentContextPrefix(docContext);
    expect(prefix).toContain("[Document Context]");
    expect(prefix).toContain("- Title: Rust 异步运行时实战");
    expect(prefix).toContain("- Outline: 1. 核心概念 > 2. 调度器实现");
    expect(prefix).toContain("- Topic: 解析 Rust 异步运行时调度原理与高并发调优实践");
    expect(prefix).toContain("- Domain: 系统编程 / 技术实战");
    expect(prefix).toContain("- Tags: async, runtime, rust");
  });

  it("拼装结构 A+B 的 FIM 续写 Prompt (System Prompt 注入)", () => {
    const docContext: AiDocumentContext = {
      title: "React 实战",
      outline: ["1. 组件", "2. Hooks"],
      topic: "React 19 Hooks 深度解析",
    };
    const prompt = buildSlmPrompt(mockContext, "continuation", { documentContext: docContext });

    expect(prompt).toContain("<|im_start|>system\n");
    expect(prompt).toContain("[User Style Profile]");
    expect(prompt).toContain("[Document Context]");
    expect(prompt).toContain("- Title: React 实战");
    expect(prompt).toContain("- Topic: React 19 Hooks 深度解析");
    expect(prompt).toContain("<|im_end|>\n");
    expect(prompt).toContain("<|im_start|>user\n");
    expect(prompt).toContain(
      "<|fim_prefix|>React 是一个用于构建 Web 客户端<|fim_suffix|>的 JavaScript 库。<|fim_middle|>",
    );
    expect(prompt).toContain("<|im_end|>\n<|im_start|>assistant\n");
  });

  it("拼装中英文混排专项纠错 Prompt", () => {
    const editContext: AiContextSnapshot = {
      ...mockContext,
      selectedText: "今天学习了 this is a apple，并调用了 Tauri 的 inovke 方法",
    };
    const prompt = buildSlmPrompt(editContext, "editing");
    // GEC 训练数据集严格不包含 system prompt，避免小模型发生目标漂移
    expect(prompt).not.toContain("<|im_start|>system\n");
    expect(prompt).toBe(
      `<|im_start|>user\n${TASK_GEC_MIXED}今天学习了 this is a apple，并调用了 Tauri 的 inovke 方法<|im_end|>\n<|im_start|>assistant\n`,
    );
  });

  it("拼装文档提炼 Prompt (Single-Pass 与 Rolling Refine)", () => {
    const docContext: AiDocumentContext = {
      title: "架构设计",
      outline: ["1. 架构", "2. 落地"],
    };

    // 1. Single-Pass
    const singlePrompt = buildSlmPrompt(
      { ...mockContext, selectedText: "本文介绍架构..." },
      "distill",
      { documentContext: docContext },
    );
    expect(singlePrompt).toContain(TASK_DISTILL);
    expect(singlePrompt).toContain("【文档标题】架构设计");
    expect(singlePrompt).toContain("【正文内容】\n本文介绍架构...");

    // 2. Rolling Refine
    const refinePrompt = buildSlmPrompt(
      { ...mockContext, selectedText: "新增第二章细节..." },
      "distill",
      {
        documentContext: docContext,
        previousSummary: "第一章已解析了核心概念。",
      },
    );
    expect(refinePrompt).toContain(TASK_DISTILL);
    expect(refinePrompt).toContain("【前文提炼要点】\n第一章已解析了核心概念。");
    expect(refinePrompt).toContain("【当前新增章节内容】\n新增第二章细节...");
  });

  it("根据任务动态返回 Stop Tokens", () => {
    // 提炼任务允许多行
    expect(getSlmStopTokens("distill")).toEqual(["<|im_end|>", "<|endoftext|>"]);
    // 续写任务包含结束符与 completion 任务标记，允许思维链标签顺利闭合后在业务层截断
    expect(getSlmStopTokens("continuation")).toContain("<|task_completion|>");
    expect(getSlmStopTokens("continuation")).toContain("<|im_end|>");
    expect(getSlmStopTokens("continuation")).not.toContain("\n");
    expect(getSlmStopTokens("continuation")).not.toContain("<think>");
    // 语法纠错必须遇到结束符立即终止
    expect(getSlmStopTokens("editing")).toContain("<|im_end|>");
    expect(getSlmStopTokens("editing")).not.toContain("<think>");
  });

  it("P1: 静态前缀稳定化与字典序排序保证 KV Cache 确定性命中", () => {
    // 乱序 preferredTerms 应被规范化排序
    const prefix1 = buildDocumentContextPrefix({
      tags: ["zebra", "alpha", "middle"],
      title: "Doc",
    });
    const prefix2 = buildDocumentContextPrefix({
      tags: ["alpha", "middle", "zebra"],
      title: "Doc",
    });
    expect(prefix1).toBe(prefix2);
    expect(prefix1).toContain("- Tags: alpha, middle, zebra");
  });

  it("P2: 统一 Capability Profile 契约生成与参数收敛", () => {
    // 1. GEC Editing Profile
    const gecProfile = resolveCapabilityProfile(mockContext, "editing");
    expect(gecProfile.task).toBe("editing");
    expect(gecProfile.adapterTask).toBe("gec");
    expect(gecProfile.grammar).toBeDefined();
    expect(gecProfile.temperature).toBe(0.0);
    expect(gecProfile.maxTokens).toBe(220);
    expect(gecProfile.cachePrompt).toBe(true);
    expect(gecProfile.affinityKey).toBe("gec");

    // 2. Continuation Profile
    const contProfile = resolveCapabilityProfile(mockContext, "continuation", {
      isGhostText: true,
    });
    expect(contProfile.task).toBe("continuation");
    expect(contProfile.adapterTask).toBe("completion");
    expect(contProfile.grammar).toBeUndefined();
    expect(contProfile.temperature).toBe(0.3);
    expect(contProfile.maxTokens).toBe(64);
    expect(contProfile.stop).toContain("<|task_completion|>");
    expect(contProfile.stop).not.toContain("\n");

    // 3. Distill Profile
    const distillProfile = resolveCapabilityProfile(mockContext, "distill");
    expect(distillProfile.task).toBe("distill");
    expect(distillProfile.adapterTask).toBe("distill");
    expect(distillProfile.grammar).toBeUndefined();
    expect(distillProfile.temperature).toBe(0.2);
    expect(distillProfile.maxTokens).toBe(180);
    expect(distillProfile.stop).not.toContain("\n");
  });
});
