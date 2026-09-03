import { describe, expect, it, vi } from "vitest";
import {
  distillDocumentProgressive,
  DocumentContextManager,
  extractDeterministicDocContext,
  simpleTextHash,
  splitMarkdownSections,
} from "../src/document-context.ts";
import type { AiSettings } from "../src/types.ts";

describe("document-context: 确定性 AST 提取、智能分块与滚动提炼流水线", () => {
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

  it("distillDocumentProgressive: 单次直投模式 (短文档)", async () => {
    const settings: AiSettings = {
      enabled: true,
      provider: "local",
      features: { continuation: true, editing: true },
      openAiCompatible: { baseUrl: "", model: "", apiKey: "" },
      localModel: {
        enabled: true,
        modelId: "md-editor-writer-lite",
        version: "1.0.0",
        status: "available",
        downloadedBytes: 0,
        totalBytes: 0,
        error: null,
      },
    };

    const mockInvoke = vi.fn().mockResolvedValue("主题：介绍 Tauri 2.0 本地模型集成架构与优化。");

    const result = await distillDocumentProgressive({
      settings,
      markdown: sampleMarkdown,
      localInvokeImpl: mockInvoke,
    });

    expect(result.isDistilled).toBe(true);
    expect(result.topic).toBe("主题：介绍 Tauri 2.0 本地模型集成架构与优化。");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("DocumentContextManager: 内存缓存、命中与 LRU 机制", () => {
    const manager = new DocumentContextManager();
    const filePath = "/path/to/test.md";

    const extracted = manager.getOrExtract(filePath, sampleMarkdown);
    expect(extracted.title).toBe("Tauri 2.0 深度实操指南");

    // 第二次直接从内存缓存获取
    const cached = manager.get(filePath);
    expect(cached).toBe(extracted);

    // simpleTextHash 计算一致
    expect(simpleTextHash("abc")).toBe(simpleTextHash("abc"));
    expect(simpleTextHash("abc")).not.toBe(simpleTextHash("def"));
  });

  it("DocumentContextManager: 取消与打断机制", async () => {
    const manager = new DocumentContextManager();
    const filePath = "/path/to/test2.md";

    const settings: AiSettings = {
      enabled: true,
      provider: "local",
      features: { continuation: true, editing: true },
      openAiCompatible: { baseUrl: "", model: "", apiKey: "" },
      localModel: {
        enabled: true,
        modelId: "md-editor-writer-lite",
        version: "1.0.0",
        status: "available",
        downloadedBytes: 0,
        totalBytes: 0,
        error: null,
      },
    };

    const mockInvoke = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("主题：完成提炼"), 50);
        }),
    );

    const promise = manager.scheduleDistillation(filePath, sampleMarkdown, {
      settings,
      localInvokeImpl: mockInvoke,
    });

    // 立即取消
    manager.cancelDistillation(filePath);
    const result = await promise;
    // 取消后依然优雅返回保底 AST 上下文
    expect(result.title).toBe("Tauri 2.0 深度实操指南");
  });

  it("scheduleDistillation: 并发相同内容的提炼请求共享进行中的 Promise，杜绝重复调用底层模型", async () => {
    const manager = new DocumentContextManager();
    const filePath = "test/doc.md";
    const settings: AiSettings = {
      enabled: true,
      provider: "local",
      features: { continuation: true, editing: true },
      openAiCompatible: { baseUrl: "", model: "", apiKey: "" },
      localModel: {
        enabled: true,
        modelId: "md-editor-writer-lite",
        version: "1.0.0",
        status: "available",
        downloadedBytes: 0,
        totalBytes: 0,
        error: null,
      },
    };

    const mockInvoke = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("主题：完成并发提炼"), 30);
        }),
    );

    // 模拟 React StrictMode 或多处生命周期同时触发调度
    const p1 = manager.scheduleDistillation(filePath, sampleMarkdown, {
      settings,
      localInvokeImpl: mockInvoke,
    });
    const p2 = manager.scheduleDistillation(filePath, sampleMarkdown, {
      settings,
      localInvokeImpl: mockInvoke,
    });

    expect(p1).toBe(p2); // 引用严格相同

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.topic).toBe("主题：完成并发提炼");
    expect(res2.topic).toBe("主题：完成并发提炼");
    // 底层 LLM 推理只被真正触发了 1 次！
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
