import { describe, expect, it, vi } from "vitest";
import {
  distillDocumentProgressive,
  DocumentContextManager,
  extractDeterministicDocContext,
  simpleTextHash,
  splitMarkdownSections,
  type ModelClient,
} from "../src/index.ts";

function createMockClient(impl: () => Promise<string>): {
  readonly client: ModelClient;
  readonly generateSpy: ReturnType<typeof vi.fn>;
} {
  const generateSpy = vi.fn().mockImplementation(async () => ({
    text: await impl(),
  }));
  return {
    client: {
      providerId: "local",
      modelId: "md-editor-writer-standard",
      generate: generateSpy,
    },
    generateSpy,
  };
}

describe("document-context: 确定性 AST 提取、智能分块与解耦滚动提炼", () => {
  const sampleMarkdown = `---
title: "Tauri 2.0 深度实操指南"
tags: [tauri, rust, react]
---

# Tauri 2.0 深度实操指南

本文介绍如何在 Tauri 2.0 中集成本地小模型。

## 1. 核心架构设计

我们设计了双层解耦流水线。

\`\`\`rust
fn main() {
    println!("Hello Tauri");
}
\`\`\`

## 2. 进程通信与内存优化

### 2.1 IPC 性能调优

采用共享内存与无锁队列。

### 2.2 内存释放策略

定期释放未使用的 KV Cache。
`;

  it("extractDeterministicDocContext: 0ms 提取大纲、标题、标签与语言", () => {
    const context = extractDeterministicDocContext(sampleMarkdown);

    expect(context.title).toBe("Tauri 2.0 深度实操指南");
    expect(context.tags).toEqual(["tauri", "rust", "react"]);
    expect(context.domain).toBe("技术开发 (rust)");
    expect(context.isDistilled).toBe(false);

    expect(context.outline).toEqual([
      "1 Tauri 2.0 深度实操指南",
      "1.1 1. 核心架构设计",
      "1.2 2. 进程通信与内存优化",
      "1.2.1 2.1 IPC 性能调优",
      "1.2.2 2.2 内存释放策略",
    ]);
  });

  it("extractDeterministicDocContext: 代码块内的 # 不被误认为标题", () => {
    const mdWithCodeComments = `# 真实标题

\`\`\`python
# 这是 Python 注释，不是 H1 标题
def add(a, b):
    return a + b
\`\`\`
`;
    const context = extractDeterministicDocContext(mdWithCodeComments);
    expect(context.outline).toEqual(["1 真实标题"]);
    expect(context.domain).toBe("技术开发 (python)");
  });

  it("splitMarkdownSections: 智能按章节切分并自适应合并", () => {
    const chunks = splitMarkdownSections(sampleMarkdown, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.content).toContain("Tauri 2.0 深度实操指南");
  });

  it("distillDocumentProgressive: 通过抽象 ModelClient 执行单次直投提炼", async () => {
    const { client, generateSpy } = createMockClient(
      async () => "主题：介绍 Tauri 2.0 本地模型集成架构与优化。",
    );

    const result = await distillDocumentProgressive({
      client,
      markdown: sampleMarkdown,
    });

    expect(result.isDistilled).toBe(true);
    expect(result.topic).toBe("主题：介绍 Tauri 2.0 本地模型集成架构与优化。");
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0]?.[0]).toMatchObject({
      task: "distill",
      temperature: 0.2,
      maxTokens: 180,
    });
  });

  it("DocumentContextManager: 内存缓存、命中与 LRU 机制", () => {
    const manager = new DocumentContextManager();
    const filePath = "/path/to/test.md";

    const extracted = manager.getOrExtract(filePath, sampleMarkdown);
    expect(extracted.title).toBe("Tauri 2.0 深度实操指南");
    expect(manager.get(filePath)).toBe(extracted);
    expect(simpleTextHash("abc")).toBe(simpleTextHash("abc"));
    expect(simpleTextHash("abc")).not.toBe(simpleTextHash("def"));
  });

  it("DocumentContextManager: 取消与打断机制", async () => {
    const manager = new DocumentContextManager();
    const filePath = "/path/to/cancel.md";
    const slow = createMockClient(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("主题：不应覆盖"), 60);
        }),
    );

    const pending = manager.scheduleDistillation(filePath, sampleMarkdown, {
      client: slow.client,
    });
    manager.cancelDistillation(filePath);
    const fallback = await pending;
    expect(fallback.title).toBe("Tauri 2.0 深度实操指南");
  });

  it("scheduleDistillation: 并发相同内容的提炼请求共享进行中的 Promise，杜绝重复调用底层模型", async () => {
    const manager = new DocumentContextManager();
    const filePath = "test/doc.md";
    const { client, generateSpy } = createMockClient(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("主题：完成并发提炼"), 25);
        }),
    );

    const p1 = manager.scheduleDistillation(filePath, sampleMarkdown, { client });
    const p2 = manager.scheduleDistillation(filePath, sampleMarkdown, { client });
    expect(p1).toBe(p2);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.topic).toBe("主题：完成并发提炼");
    expect(res2.topic).toBe("主题：完成并发提炼");
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});
