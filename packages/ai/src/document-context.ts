/**
 * @file document-context.ts
 * @description 文档全局宏观上下文管理：支持 Markdown AST 章节分块、确定性元信息提取、基于 <|task_distill|> 的累进式滚动提炼与内存缓存管理器。
 */

import { requestAiContinuation } from "./completion.ts";
import type {
  AiContextSnapshot,
  AiDocumentContext,
  AiSettings,
  MarkdownSectionChunk,
} from "./types.ts";

/**
 * 轻量计算文本简易哈希（用于变更感知与增量提炼）
 */
export function simpleTextHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * 从 Markdown 中提取 Frontmatter 标签和标题
 */
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
        .replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("tags:") || trimmed.startsWith("keywords:")) {
      const rawTags = trimmed.replace(/^(tags|keywords):\s*/, "").replace(/^\[|\]$/g, "");
      const splitTags = rawTags
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      tags.push(...splitTags);
    }
  }

  return { title, tags: tags.length > 0 ? tags : undefined };
}

/**
 * 确定性 AST 上下文提取（纯同步、< 1ms 零阻塞）
 * 从 Markdown AST 骨架中提取标题、H1~H4 层级大纲树、Frontmatter 标签及代码语言
 */
export function extractDeterministicDocContext(
  markdown: string,
  title?: string,
  filePath?: string,
): AiDocumentContext {
  const trimmed = markdown.trim();
  if (!trimmed) {
    const fallbackTitle =
      title || (filePath ? filePath.split("/").pop()?.replace(/\.md$/i, "") : "未命名文档");
    return {
      title: fallbackTitle,
      outline: [],
      isDistilled: false,
    };
  }

  const fmMeta = parseFrontmatterMetadata(markdown);
  const headings: { level: number; text: string }[] = [];
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

    // 匹配 Markdown 标题 (# Title, ## Section)
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2]
        .trim()
        .replace(/[#*`_]/g, "")
        .trim();
      if (headingText) {
        headings.push({ level, text: headingText });
      }
    }
  }

  // 确定有效标题：优先取第一个 H1，其次 Frontmatter title，其次传入 title / 文件名
  let effectiveTitle = title;
  if (!effectiveTitle && fmMeta.title) {
    effectiveTitle = fmMeta.title;
  }
  if (!effectiveTitle) {
    const firstH1 = headings.find((h) => h.level === 1);
    if (firstH1) {
      effectiveTitle = firstH1.text;
    } else if (filePath) {
      effectiveTitle = filePath.split("/").pop()?.replace(/\.md$/i, "");
    } else {
      effectiveTitle = "未命名文档";
    }
  }

  // 格式化大纲列表（例如：["1. 痛点分析", "2. 架构设计", "2.1 双层流"]）
  const outline: string[] = [];
  const levelCounters = [0, 0, 0, 0];

  for (const h of headings) {
    const depth = h.level - 1;
    if (depth >= 0 && depth < levelCounters.length) {
      levelCounters[depth] = (levelCounters[depth] ?? 0) + 1;
      // 重置子层级计数
      for (let i = depth + 1; i < levelCounters.length; i++) {
        levelCounters[i] = 0;
      }
      const prefixParts = levelCounters.slice(0, depth + 1).filter((n) => n > 0);
      const prefix = prefixParts.join(".");
      outline.push(`${prefix} ${h.text}`);
    } else {
      outline.push(h.text);
    }
  }

  // 根据编程语言识别领域
  let domain: string | undefined;
  if (codeLanguages.size > 0) {
    const langs = Array.from(codeLanguages).slice(0, 3).join("/");
    domain = `技术开发 (${langs})`;
  }

  return {
    title: effectiveTitle,
    outline,
    domain,
    tags: fmMeta.tags,
    isDistilled: false,
  };
}

/**
 * 按照 Markdown AST 章节边界智能分块
 * 将长文档自适应切分与合并为 1 ~ 4 个章节块，避免切断代码块或长句子
 */
export function splitMarkdownSections(
  markdown: string,
  targetChunkChars = 1500,
): MarkdownSectionChunk[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return [];
  }

  const lines = markdown.split("\n");
  const rawSections: { heading?: string; level: number; lines: string[] }[] = [];
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
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
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

  // 自适应合并相邻小章节，保证每个 Chunk 适度饱满（500 ~ targetChunkChars 字符）
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
      balancedChunks.push({
        heading: accumulator.heading,
        level: accumulator.level,
        content: accumulator.content.trim(),
        charCount: accumulator.content.trim().length,
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
    balancedChunks.push({
      heading: accumulator.heading,
      level: accumulator.level,
      content: accumulator.content.trim(),
      charCount: accumulator.content.trim().length,
    });
  }

  return balancedChunks;
}

/**
 * 异步全篇累进滚动提炼流水线
 * 支持 Single-Pass（短篇直投）与 Rolling-Refine（多章节滚动演进）
 */
export async function distillDocumentProgressive(options: {
  readonly settings: AiSettings;
  readonly markdown: string;
  readonly title?: string;
  readonly filePath?: string;
  readonly onProgress?: (context: AiDocumentContext) => void;
  readonly signal?: AbortSignal;
  readonly localInvokeImpl?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly fetchImpl?: typeof fetch;
}): Promise<AiDocumentContext> {
  const { settings, markdown, title, filePath, onProgress, signal, localInvokeImpl, fetchImpl } =
    options;
  const baseContext = extractDeterministicDocContext(markdown, title, filePath);

  // 若文档过短或空白，直接返回确定性上下文
  if (markdown.trim().length < 50) {
    return baseContext;
  }

  const chunks = splitMarkdownSections(markdown);
  if (chunks.length === 0) {
    return baseContext;
  }

  let accumulatedSummary = "";

  try {
    if (chunks.length === 1 || markdown.length <= 2000) {
      // 1. 单次直投模式 (Single-Pass)
      if (signal?.aborted) {
        return baseContext;
      }

      const snapshot: AiContextSnapshot = {
        before: chunks[0]?.content || markdown.slice(0, 2000),
        after: "",
        selectedText: "",
        mode: "source",
        document: { filePath, title: baseContext.title },
        documentContext: baseContext,
      };

      const result = await requestAiContinuation(settings, snapshot, {
        intent: "distill",
        signal,
        localInvokeImpl,
        fetchImpl,
        documentContext: baseContext,
      });

      const topicOutput = result.continuation?.trim();
      if (topicOutput) {
        accumulatedSummary = topicOutput;
      }
    } else {
      // 2. 长文档累进滚动提炼模式 (Rolling Refine)
      for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) {
          break;
        }

        const chunk = chunks[i];
        if (!chunk) continue;

        const snapshot: AiContextSnapshot = {
          before: chunk.content,
          after: "",
          selectedText: chunk.content,
          mode: "source",
          document: { filePath, title: baseContext.title },
          documentContext: baseContext,
        };

        const result = await requestAiContinuation(settings, snapshot, {
          intent: "distill",
          signal,
          localInvokeImpl,
          fetchImpl,
          documentContext: baseContext,
          previousSummary: accumulatedSummary || undefined,
        });

        const stepTopic = result.continuation?.trim();
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

  const finalContext: AiDocumentContext = {
    ...baseContext,
    topic: accumulatedSummary || baseContext.topic,
    isDistilled: Boolean(accumulatedSummary),
  };

  return finalContext;
}

/**
 * 文档上下文内存管理器 (LRU Cache + 增量变更调度器)
 */
export class DocumentContextManager {
  private readonly cache = new Map<string, { context: AiDocumentContext; contentHash: string }>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly inFlightDistillations = new Map<
    string,
    { readonly contentHash: string; readonly promise: Promise<AiDocumentContext> }
  >();
  private readonly maxCacheEntries = 50;

  /**
   * 获取当前缓存的文档上下文
   */
  public get(key: string): AiDocumentContext | undefined {
    return this.cache.get(key)?.context;
  }

  /**
   * 写入或更新上下文缓存
   */
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

  /**
   * 瞬时获取或基于 AST 生成确定性上下文（0ms）
   */
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

  /**
   * 异步调度后台滚动提炼（自动打断并替换该文件之前的提炼任务）
   */
  public scheduleDistillation(
    filePath: string,
    markdown: string,
    options: {
      readonly settings: AiSettings;
      readonly title?: string;
      readonly onUpdate?: (context: AiDocumentContext) => void;
      readonly localInvokeImpl?: (
        command: string,
        args?: Record<string, unknown>,
      ) => Promise<unknown>;
      readonly fetchImpl?: typeof fetch;
    },
  ): Promise<AiDocumentContext> {
    const currentHash = simpleTextHash(markdown);
    const cached = this.cache.get(filePath);

    // 1. 如果内容未发生任何改变且已经提炼过，直接返回缓存
    if (cached && cached.contentHash === currentHash && cached.context.isDistilled) {
      return Promise.resolve(cached.context);
    }

    // 2. 如果当前文件已有相同内容的提炼任务正在进行，直接复用正在进行的 Promise，避免并发重复请求
    const active = this.inFlightDistillations.get(filePath);
    if (active && active.contentHash === currentHash) {
      return active.promise;
    }

    // 3. 取消旧内容的提炼任务
    this.cancelDistillation(filePath);

    const abortController = new AbortController();
    this.abortControllers.set(filePath, abortController);

    const taskPromise = (async () => {
      try {
        const distilled = await distillDocumentProgressive({
          settings: options.settings,
          markdown,
          title: options.title,
          filePath,
          signal: abortController.signal,
          localInvokeImpl: options.localInvokeImpl,
          fetchImpl: options.fetchImpl,
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

  /**
   * 取消某个文件的在途提炼任务
   */
  public cancelDistillation(filePath: string): void {
    const controller = this.abortControllers.get(filePath);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(filePath);
    }
    this.inFlightDistillations.delete(filePath);
  }

  /**
   * 清空所有缓存与任务
   */
  public clear(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.cache.clear();
  }
}

/** 全局单例管理器 */
export const documentContextManager = new DocumentContextManager();
