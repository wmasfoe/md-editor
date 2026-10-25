/**
 * @file app/document-context.ts
 * @module @md-editor/ai
 * @description
 * 文档宏观上下文管理（Dependency-Inverted）：
 * 1. 0ms 纯确定性 Markdown 骨架提取（标题、H1~H4 编号大纲、Frontmatter 标签、代码语言领域）；
 * 2. Markdown 章节智能分块（不截断代码围栏）；
 * 3. 基于抽象 `ModelClient` 的后台异步滚动提炼（Single-Pass / Rolling-Refine）与内存 LRU 缓存。
 */

import type { ModelClient } from "../domain/model-client.ts";
import type { AiDocumentContext, MarkdownSectionChunk } from "../domain/types.ts";
import { stripThinkingTags } from "./harness-guardrails.ts";
import { buildDistillModelContext } from "./harness-prompts.ts";

/**
 * 轻量计算文本简易哈希（用于文档变更感知与重复提炼短路）。
 */
export function simpleTextHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * 确定性提取文档结构化上下文（纯同步、<1ms 零网络开销）。
 */
export function extractDeterministicDocContext(
  markdown: string,
  title?: string,
  filePath?: string,
): AiDocumentContext {
  const trimmed = markdown.trim();
  if (!trimmed) {
    const fallbackTitle =
      title || (filePath ? filePath.split("/").pop()?.replace(/\.md$/iu, "") : "未命名文档");
    return {
      title: fallbackTitle,
      outline: [],
      isDistilled: false,
    };
  }

  const fmMeta = parseFrontmatterMetadata(markdown);
  const headings: Array<{ level: number; text: string }> = [];
  const codeLanguages = new Set<string>();

  const lines = markdown.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        const lang = trimmedLine.slice(3).trim().toLowerCase();
        if (lang) {
          codeLanguages.add(lang);
        }
      }
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/u);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2]
        .trim()
        .replace(/[#*`_]/gu, "")
        .trim();
      if (headingText) {
        headings.push({ level, text: headingText });
      }
    }
  }

  let effectiveTitle = title || fmMeta.title;
  if (!effectiveTitle) {
    const firstH1 = headings.find((h) => h.level === 1);
    if (firstH1) {
      effectiveTitle = firstH1.text;
    } else if (filePath) {
      effectiveTitle = filePath.split("/").pop()?.replace(/\.md$/iu, "");
    } else {
      effectiveTitle = "未命名文档";
    }
  }

  const outline: string[] = [];
  const levelCounters = [0, 0, 0, 0];

  for (const h of headings) {
    const depth = h.level - 1;
    if (depth >= 0 && depth < levelCounters.length) {
      levelCounters[depth] = (levelCounters[depth] ?? 0) + 1;
      for (let i = depth + 1; i < levelCounters.length; i++) {
        levelCounters[i] = 0;
      }
      const prefix = levelCounters
        .slice(0, depth + 1)
        .filter((n) => n > 0)
        .join(".");
      outline.push(`${prefix} ${h.text}`);
    } else {
      outline.push(h.text);
    }
  }

  const domain =
    codeLanguages.size > 0
      ? `技术开发 (${Array.from(codeLanguages).slice(0, 3).join("/")})`
      : undefined;

  return {
    title: effectiveTitle,
    outline,
    domain,
    tags: fmMeta.tags,
    isDistilled: false,
  };
}

/**
 * 按 Markdown 章节边界自适应切分与合并片段（保护代码围栏完整性）。
 */
export function splitMarkdownSections(
  markdown: string,
  targetChunkChars = 1_500,
): MarkdownSectionChunk[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return [];
  }

  const lines = markdown.split("\n");
  const rawSections: Array<{ heading?: string; level: number; lines: string[] }> = [];
  let currentSection: { heading?: string; level: number; lines: string[] } = {
    heading: undefined,
    level: 0,
    lines: [],
  };

  let inCodeBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/u);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        if (currentSection.lines.length > 0) {
          rawSections.push(currentSection);
        }
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          lines: [line],
        };
        continue;
      }
    }

    currentSection.lines.push(line);
  }

  if (currentSection.lines.length > 0) {
    rawSections.push(currentSection);
  }

  const balancedChunks: MarkdownSectionChunk[] = [];
  let accumulator: { heading?: string; level: number; content: string } = {
    heading: rawSections[0]?.heading,
    level: rawSections[0]?.level || 0,
    content: "",
  };

  for (const sec of rawSections) {
    const secText = sec.lines.join("\n");
    if (
      accumulator.content.length > 0 &&
      accumulator.content.length + secText.length > targetChunkChars
    ) {
      const chunkText = accumulator.content.trim();
      balancedChunks.push({
        heading: accumulator.heading,
        level: accumulator.level,
        content: chunkText,
        charCount: chunkText.length,
      });
      accumulator = {
        heading: sec.heading,
        level: sec.level,
        content: secText,
      };
    } else {
      if (!accumulator.heading && sec.heading) {
        accumulator.heading = sec.heading;
        accumulator.level = sec.level;
      }
      accumulator.content += (accumulator.content ? "\n\n" : "") + secText;
    }
  }

  if (accumulator.content.trim().length > 0) {
    const chunkText = accumulator.content.trim();
    balancedChunks.push({
      heading: accumulator.heading,
      level: accumulator.level,
      content: chunkText,
      charCount: chunkText.length,
    });
  }

  return balancedChunks;
}

/**
 * 基于 `ModelClient` 抽象接口的渐进式文档提炼流水线（与具体云端/本地协议彻底解耦）。
 */
export async function distillDocumentProgressive(options: {
  readonly client: ModelClient;
  readonly markdown: string;
  readonly title?: string;
  readonly filePath?: string;
  readonly onProgress?: (context: AiDocumentContext) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<AiDocumentContext> {
  const { client, markdown, title, filePath, onProgress, signal, timeoutMs } = options;
  const baseContext = extractDeterministicDocContext(markdown, title, filePath);

  if (markdown.trim().length < 50) {
    return baseContext;
  }

  const chunks = splitMarkdownSections(markdown);
  if (chunks.length === 0) {
    return baseContext;
  }

  let accumulatedSummary = "";

  try {
    if (chunks.length === 1 || markdown.length <= 2_000) {
      if (signal?.aborted) {
        return baseContext;
      }

      const modelCtx = buildDistillModelContext({
        title: baseContext.title || "未命名文档",
        outline: baseContext.outline,
        content: chunks[0]?.content || markdown.slice(0, 2_000),
        signal,
        timeoutMs,
      });

      const response = await client.generate(modelCtx);
      const topicOutput = stripThinkingTags(response.text).trim();
      if (topicOutput) {
        accumulatedSummary = topicOutput;
      }
    } else {
      for (const chunk of chunks) {
        if (signal?.aborted) {
          break;
        }

        const modelCtx = buildDistillModelContext({
          title: baseContext.title || "未命名文档",
          outline: baseContext.outline,
          content: chunk.content,
          previousSummary: accumulatedSummary || undefined,
          signal,
          timeoutMs,
        });

        const response = await client.generate(modelCtx);
        const stepTopic = stripThinkingTags(response.text).trim();
        if (stepTopic) {
          accumulatedSummary = stepTopic;
          const interimContext: AiDocumentContext = {
            ...baseContext,
            topic: accumulatedSummary,
            isDistilled: true,
          };
          onProgress?.(interimContext);
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      return baseContext;
    }
    throw error;
  }

  return {
    ...baseContext,
    topic: accumulatedSummary || baseContext.topic,
    isDistilled: Boolean(accumulatedSummary),
  };
}

/**
 * 文档宏观上下文内存管理器（LRU 缓存 + 同内容并发合并 + 自动取消）。
 */
export class DocumentContextManager {
  private readonly cache = new Map<string, { context: AiDocumentContext; contentHash: string }>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly inFlightDistillations = new Map<
    string,
    { readonly contentHash: string; readonly promise: Promise<AiDocumentContext> }
  >();
  private readonly maxCacheEntries = 50;

  public get(key: string): AiDocumentContext | undefined {
    return this.cache.get(key)?.context;
  }

  public set(key: string, context: AiDocumentContext, contentHash?: string): void {
    if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      context,
      contentHash: contentHash || simpleTextHash(context.topic || ""),
    });
  }

  public getOrExtract(filePath: string, markdown: string, title?: string): AiDocumentContext {
    const currentHash = simpleTextHash(markdown);
    const cached = this.cache.get(filePath);
    if (cached && cached.contentHash === currentHash) {
      return cached.context;
    }
    const extracted = extractDeterministicDocContext(markdown, title, filePath);
    const result: AiDocumentContext = {
      ...extracted,
      ...(cached?.context.topic ? { topic: cached.context.topic } : {}),
      ...(cached?.context.isDistilled ? { isDistilled: cached.context.isDistilled } : {}),
    };
    this.set(filePath, result, currentHash);
    return result;
  }

  public scheduleDistillation(
    filePath: string,
    markdown: string,
    options: {
      readonly client: ModelClient;
      readonly title?: string;
      readonly onUpdate?: (context: AiDocumentContext) => void;
      readonly timeoutMs?: number;
    },
  ): Promise<AiDocumentContext> {
    const currentHash = simpleTextHash(markdown);
    const cached = this.cache.get(filePath);

    if (cached && cached.contentHash === currentHash && cached.context.isDistilled) {
      return Promise.resolve(cached.context);
    }

    const active = this.inFlightDistillations.get(filePath);
    if (active && active.contentHash === currentHash) {
      return active.promise;
    }

    this.cancelDistillation(filePath);

    const abortController = new AbortController();
    this.abortControllers.set(filePath, abortController);

    const taskPromise = (async () => {
      try {
        const distilled = await distillDocumentProgressive({
          client: options.client,
          markdown,
          title: options.title,
          filePath,
          signal: abortController.signal,
          timeoutMs: options.timeoutMs,
          onProgress: (interim) => {
            this.set(filePath, interim, currentHash);
            options.onUpdate?.(interim);
          },
        });

        if (!abortController.signal.aborted) {
          this.set(filePath, distilled, currentHash);
          options.onUpdate?.(distilled);
        }

        return distilled;
      } catch (error) {
        if (abortController.signal.aborted) {
          return this.getOrExtract(filePath, markdown, options.title);
        }
        throw error;
      } finally {
        if (this.abortControllers.get(filePath) === abortController) {
          this.abortControllers.delete(filePath);
        }
        const currentActive = this.inFlightDistillations.get(filePath);
        if (currentActive?.contentHash === currentHash) {
          this.inFlightDistillations.delete(filePath);
        }
      }
    })();

    this.inFlightDistillations.set(filePath, {
      contentHash: currentHash,
      promise: taskPromise,
    });

    return taskPromise;
  }

  public cancelDistillation(filePath: string): void {
    const controller = this.abortControllers.get(filePath);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(filePath);
    }
    this.inFlightDistillations.delete(filePath);
  }

  public clear(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.inFlightDistillations.clear();
    this.cache.clear();
  }
}

/** 默认共享文档上下文管理器实例 */
export const documentContextManager = new DocumentContextManager();

function parseFrontmatterMetadata(markdown: string): { title?: string; tags?: string[] } {
  if (!markdown.startsWith("---")) {
    return {};
  }
  const endIndex = markdown.indexOf("\n---", 3);
  if (endIndex === -1) {
    return {};
  }
  const rawFm = markdown.slice(3, endIndex);
  let title: string | undefined;
  const tags: string[] = [];

  for (const line of rawFm.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("title:")) {
      title = trimmed
        .slice(6)
        .trim()
        .replace(/^["']|["']$/gu, "");
    } else if (trimmed.startsWith("tags:") || trimmed.startsWith("keywords:")) {
      const rawTags = trimmed.replace(/^(tags|keywords):\s*/u, "").replace(/^\[|\]$/gu, "");
      const splitTags = rawTags
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/gu, ""))
        .filter(Boolean);
      tags.push(...splitTags);
    }
  }

  return { title, tags: tags.length > 0 ? tags : undefined };
}
