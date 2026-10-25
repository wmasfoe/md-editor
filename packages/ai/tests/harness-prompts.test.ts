import { describe, expect, it } from "vitest";
import {
  buildCloudContinuationModelContext,
  buildCloudGecModelContext,
  buildDistillModelContext,
  buildDocumentContextPrefix,
  buildLocalContinuationModelContext,
  buildLocalGecModelContext,
  buildUserStyleProfilePrefix,
  FIM_END,
  FIM_MIDDLE,
  FIM_PREFIX,
  FIM_SUFFIX,
  isLiteLocalModel,
  LITE_LOCAL_MODEL_ID,
  LOCAL_CONTINUATION_SYSTEM_PROMPT,
  LOCAL_GEC_SYSTEM_PROMPT,
  RFC002_TUPLE_GBNF_GRAMMAR,
  STANDARD_LOCAL_MODEL_ID,
  type AiContextSnapshot,
} from "../src/index.ts";

describe("harness-prompts: RFC-004 双档位与云端多协议 Prompt 构建", () => {
  const snapshot: AiContextSnapshot = {
    before: "React 是一个用于构建 Web 客户端",
    after: "的 JavaScript 库。",
    selectedText: "",
    mode: "wysiwyg",
    document: {
      title: "React 实战",
      filePath: "/docs/react.md",
    },
    documentContext: {
      title: "React 实战",
      outline: ["1. 架构", "2. 组件"],
      topic: "React 19 全新特性解析",
    },
  };

  it("isLiteLocalModel 准确识别 Lite 档位模型标识符", () => {
    expect(isLiteLocalModel(LITE_LOCAL_MODEL_ID)).toBe(true);
    expect(isLiteLocalModel("md-editor-writer-lite-v1.4.0")).toBe(true);
    expect(isLiteLocalModel("qwen3-0.6b-base")).toBe(true);
    expect(isLiteLocalModel(STANDARD_LOCAL_MODEL_ID)).toBe(false);
  });

  it("buildLocalGecModelContext 遵循 RFC-004 §2.1：纯文本 User Prompt + GBNF 物理围栏", () => {
    const targetText = "今天我们因该去公园散步。";
    const ctx = buildLocalGecModelContext(targetText);

    expect(ctx.instruction).toBe(LOCAL_GEC_SYSTEM_PROMPT);
    expect(ctx.prompt).toBe(targetText); // 纯待检文本，严禁加前缀！
    expect(ctx.temperature).toBe(0.0);
    expect(ctx.maxTokens).toBe(128);
    expect(ctx.task).toBe("gec");
    expect(ctx.outputFormat).toEqual({
      kind: "gbnf-grammar",
      grammar: RFC002_TUPLE_GBNF_GRAMMAR,
    });
  });

  it("buildLocalContinuationModelContext - Lite 档位：原生 FIM 裸补全载荷", () => {
    const ctx = buildLocalContinuationModelContext(snapshot, LITE_LOCAL_MODEL_ID, {
      isGhostText: true,
    });

    expect(ctx.rawCompletion).toBeDefined();
    expect(ctx.rawCompletion?.prompt).toBe(
      `${FIM_PREFIX}${snapshot.before}${FIM_SUFFIX}${snapshot.after}${FIM_MIDDLE}`,
    );
    expect(ctx.stopSequences).toContain("\n");
    expect(ctx.stopSequences).toContain(FIM_END);
    expect(ctx.maxTokens).toBe(64);
    expect(ctx.task).toBe("completion");
  });

  it("buildLocalContinuationModelContext - Standard 档位：标准 ChatML 对话续写", () => {
    const ctx = buildLocalContinuationModelContext(snapshot, STANDARD_LOCAL_MODEL_ID, {
      isGhostText: true,
    });

    expect(ctx.rawCompletion).toBeUndefined();
    expect(ctx.instruction).toContain(LOCAL_CONTINUATION_SYSTEM_PROMPT);
    expect(ctx.instruction).toContain("[Document Context]");
    expect(ctx.instruction).toContain("- Title: React 实战");
    expect(ctx.prompt).toBe(`【光标前文】\n${snapshot.before}\n【光标后文】\n${snapshot.after}`);
    expect(ctx.stopSequences).toEqual(["\n"]);
    expect(ctx.maxTokens).toBe(64);
  });

  it("buildDistillModelContext 遵循 RFC-004 §2.3：Single-Pass 与 Rolling-Refine", () => {
    // 1. Single-Pass
    const single = buildDistillModelContext({
      title: "文档标题",
      outline: ["1. 架构", "2. 落地"],
      content: "正文内容...",
    });
    expect(single.prompt).toContain("【文档标题】文档标题");
    expect(single.prompt).toContain("【章节大纲】1. 架构 > 2. 落地");
    expect(single.prompt).toContain("【正文内容】\n正文内容...");

    // 2. Rolling-Refine
    const rolling = buildDistillModelContext({
      title: "文档标题",
      outline: ["1. 架构", "2. 落地"],
      content: "新增章节...",
      previousSummary: "前文概要...",
    });
    expect(rolling.prompt).toContain("【前文提炼要点】\n前文概要...");
    expect(rolling.prompt).toContain("【当前新增章节内容】\n新增章节...");
  });

  it("buildCloudGecModelContext 与 buildCloudContinuationModelContext 构造协议中立上下文", () => {
    const cloudGec = buildCloudGecModelContext("测试文本", {
      documentContext: snapshot.documentContext,
    });
    expect(cloudGec.task).toBe("gec");
    expect(cloudGec.temperature).toBe(0.0);
    expect(cloudGec.prompt).toBe("测试文本");
    expect(cloudGec.instruction).toContain("你是严谨的 Markdown 语法、拼写与标点纠错器。");

    const cloudCont = buildCloudContinuationModelContext(snapshot, {
      isGhostText: true,
    });
    expect(cloudCont.task).toBe("completion");
    expect(cloudCont.temperature).toBe(0.4);
    expect(cloudCont.stopSequences).toEqual(["\n"]);
    expect(cloudCont.instruction).toContain("当前为行内幽灵续写模式");
    expect(cloudCont.prompt).toContain("【光标前文】");
  });

  it("前缀构建器保证字典序稳定以保护 KV Cache", () => {
    const style1 = buildUserStyleProfilePrefix({
      preferredTerms: ["React", "Markdown", "Antigravity"],
    });
    const style2 = buildUserStyleProfilePrefix({
      preferredTerms: ["Antigravity", "React", "Markdown"],
    });
    expect(style1).toBe(style2);
    expect(style1).toContain("- Preferred: Antigravity, Markdown, React");

    const docPrefix = buildDocumentContextPrefix({
      title: "Title",
      tags: ["z", "a"],
    });
    expect(docPrefix).toContain("- Tags: a, z");
  });
});
