/**
 * @file app/writing-service.ts
 * @module @md-editor/ai
 * @description
 * 三端（Desktop / Web / uTools）统一复用的 AI 写作编排服务（App Harness 核心门面）。
 *
 * 严格遵循依赖倒置原则：
 * - `AiWritingService` 仅依赖 `domain/` 层的 `ModelClient` 抽象接口与同层 Harness 组件，不直接依赖任何具体 HTTP/Tauri 适配器；
 * - 统一收口四大写作能力：
 *   1. `continueWriting`（行内幽灵续写 & 主动段落续写）
 *   2. `fixGrammar`（局部语法、错别字与标点修复 GEC）
 *   3. `distillDocument` / `scheduleDistillation`（后台宏观大纲与主题提炼）
 *   4. `testConnection`（设置面板一键协议连通性测试）
 */

import type { ModelClient } from "../domain/model-client.ts";
import { getAiCompletionReadiness } from "../domain/settings.ts";
import type {
  AiConnectionTestResult,
  AiContextSnapshot,
  AiDocumentContext,
  AiSettings,
  AiWritingSuggestion,
  UserStyleProfile,
} from "../domain/types.ts";
import {
  type DocumentContextManager,
  distillDocumentProgressive,
  documentContextManager,
} from "./document-context.ts";
import {
  buildEditSuggestionFromDiffs,
  parseAiWritingSuggestion,
  parseTupleDiffOutput,
  resolveTripleDefenseDiffs,
  sanitizeContinuationOutput,
} from "./harness-guardrails.ts";
import {
  buildCloudContinuationModelContext,
  buildCloudGecModelContext,
  buildLocalContinuationModelContext,
  buildLocalGecModelContext,
} from "./harness-prompts.ts";
import { AiRequestScheduler } from "./request-scheduler.ts";

export interface AiWritingServiceDeps {
  /** 由组合根注入的 `ModelClient` 解析函数 */
  readonly resolveClient: (
    settings: AiSettings,
    overrides?: { readonly fetchImpl?: typeof fetch },
  ) => ModelClient;
  /** 当前宿主平台是否支持离线本地模型（默认 true；Web 与 uTools 传 false） */
  readonly allowLocal?: boolean;
  /** 可选自定义请求调度器 */
  readonly scheduler?: AiRequestScheduler;
  /** 可选自定义文档上下文管理器 */
  readonly documentContext?: DocumentContextManager;
}

export interface AiContinuationOptions {
  /** 是否为单行幽灵文本（默认 true；快捷键主动续写可设为 false 以允许多行段落） */
  readonly isGhostText?: boolean;
  readonly profile?: UserStyleProfile;
  readonly documentContext?: AiDocumentContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AiGrammarFixOptions {
  readonly documentContext?: AiDocumentContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class AiWritingService {
  public readonly scheduler: AiRequestScheduler;
  public readonly documentContext: DocumentContextManager;
  private readonly resolveClient: AiWritingServiceDeps["resolveClient"];
  private readonly allowLocal: boolean;

  public constructor(deps: AiWritingServiceDeps) {
    this.resolveClient = deps.resolveClient;
    this.allowLocal = deps.allowLocal !== false;
    this.scheduler = deps.scheduler ?? new AiRequestScheduler(2);
    this.documentContext = deps.documentContext ?? documentContextManager;
  }

  /**
   * 检查当前配置是否满足指定任务的发起前置条件。
   */
  public checkReadiness(
    settings: AiSettings,
    intent: "continuation" | "editing" | "both" | "distill" = "both",
  ): string | null {
    return getAiCompletionReadiness(settings, intent, { allowLocal: this.allowLocal });
  }

  /**
   * 发起光标处续写（Pre-Model 上下文切片 -> ModelClient.generate -> Post-Model 重叠消除与思维链剥离）。
   */
  public async continueWriting(
    settings: AiSettings,
    snapshot: AiContextSnapshot,
    options: AiContinuationOptions = {},
  ): Promise<AiWritingSuggestion> {
    const readiness = this.checkReadiness(settings, "continuation");
    if (readiness) {
      throw new Error(readiness);
    }

    const isGhostText = options.isGhostText !== false;
    const client = this.resolveClient(settings, { fetchImpl: options.fetchImpl });

    const modelContext =
      settings.provider === "local"
        ? buildLocalContinuationModelContext(snapshot, settings.localModel.modelId, {
            isGhostText,
            profile: options.profile,
            documentContext: options.documentContext,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          })
        : buildCloudContinuationModelContext(snapshot, {
            isGhostText,
            profile: options.profile,
            documentContext: options.documentContext,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          });

    const response = await client.generate(modelContext);
    const continuation = sanitizeContinuationOutput(response.text, {
      before: snapshot.before,
      after: snapshot.after,
      isGhostText,
    });

    if (!continuation) {
      return {
        hasContinuation: false,
        hasEdit: false,
        edit: null,
      };
    }

    return {
      hasContinuation: true,
      continuation,
      hasEdit: false,
      edit: null,
    };
  }

  /**
   * 发起局部语法、错别字与标点修复（Pre-Model 纯文本构造 -> ModelClient.generate -> Post-Model 四重锚点定位校验）。
   */
  public async fixGrammar(
    settings: AiSettings,
    snapshot: AiContextSnapshot,
    options: AiGrammarFixOptions = {},
  ): Promise<AiWritingSuggestion> {
    const readiness = this.checkReadiness(settings, "editing");
    if (readiness) {
      throw new Error(readiness);
    }

    const targetText = snapshot.selectedText || snapshot.before;
    if (!targetText.trim()) {
      return {
        hasContinuation: false,
        hasEdit: false,
        edit: null,
      };
    }

    const client = this.resolveClient(settings, { fetchImpl: options.fetchImpl });

    const modelContext =
      settings.provider === "local"
        ? buildLocalGecModelContext(targetText, {
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          })
        : buildCloudGecModelContext(targetText, {
            documentContext: options.documentContext ?? snapshot.documentContext,
            document: snapshot.document,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          });

    const response = await client.generate(modelContext);

    // 优先按紧凑元组 [[start, end, orig, repl]] 解析并经四重防御锚点校验
    const tupleDiffs = parseTupleDiffOutput(response.text);
    if (tupleDiffs.length > 0) {
      const validated = resolveTripleDefenseDiffs(targetText, tupleDiffs);
      return buildEditSuggestionFromDiffs(validated);
    }

    // 若返回明确空数组 []，代表无错负样本通过，直接返回无修改
    if (response.text.trim() === "[]") {
      return {
        hasContinuation: false,
        hasEdit: false,
        edit: null,
      };
    }

    // 兼容部分云端模型偶发返回 JSON 对象格式 { edit: { original, replacement, reason } }
    if (settings.provider !== "local") {
      const fallbackParsed = parseAiWritingSuggestion(response.text, targetText);
      if (fallbackParsed.hasEdit && fallbackParsed.edit) {
        return {
          hasContinuation: false,
          hasEdit: true,
          edit: fallbackParsed.edit,
        };
      }
    }

    return {
      hasContinuation: false,
      hasEdit: false,
      edit: null,
    };
  }

  /**
   * 执行单次全篇或渐进式文档宏观提炼。
   */
  public async distillDocument(
    settings: AiSettings,
    options: {
      readonly markdown: string;
      readonly title?: string;
      readonly filePath?: string;
      readonly onProgress?: (context: AiDocumentContext) => void;
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
      readonly fetchImpl?: typeof fetch;
    },
  ): Promise<AiDocumentContext> {
    const readiness = this.checkReadiness(settings, "distill");
    if (readiness) {
      throw new Error(readiness);
    }

    const client = this.resolveClient(settings, { fetchImpl: options.fetchImpl });
    return distillDocumentProgressive({
      client,
      markdown: options.markdown,
      title: options.title,
      filePath: options.filePath,
      onProgress: options.onProgress,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * 调度带内容哈希去重与旧任务抢占取消的后台文档提炼。
   */
  public scheduleDistillation(
    filePath: string,
    markdown: string,
    options: {
      readonly settings: AiSettings;
      readonly title?: string;
      readonly onUpdate?: (context: AiDocumentContext) => void;
      readonly timeoutMs?: number;
      readonly fetchImpl?: typeof fetch;
    },
  ): Promise<AiDocumentContext> {
    const readiness = this.checkReadiness(options.settings, "distill");
    if (readiness) {
      return Promise.resolve(this.documentContext.getOrExtract(filePath, markdown, options.title));
    }

    const client = this.resolveClient(options.settings, { fetchImpl: options.fetchImpl });
    return this.documentContext.scheduleDistillation(filePath, markdown, {
      client,
      title: options.title,
      onUpdate: options.onUpdate,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * 测试当前激活协议端点或本地模型的真实连通性（用于设置弹窗「测试连接」按钮）。
   */
  public async testConnection(
    settings: AiSettings,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
      readonly fetchImpl?: typeof fetch;
    } = {},
  ): Promise<AiConnectionTestResult> {
    // 连通性测试不要求用户先打开某个具体子特性开关，直接验证端点凭据或本地模型状态
    const probeSettings: AiSettings = {
      ...settings,
      enabled: true,
      features: {
        continuation: true,
        editing: true,
      },
    };
    const readiness = this.checkReadiness(probeSettings, "distill");
    if (readiness) {
      return {
        ok: false,
        message: readiness,
      };
    }

    const startTime = Date.now();
    try {
      const client = this.resolveClient(probeSettings, { fetchImpl: options.fetchImpl });
      const response = await client.generate({
        instruction: "Reply with OK only.",
        prompt: "ping",
        maxTokens: 16,
        temperature: 0,
        task: "distill",
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 12_000,
      });

      const latencyMs = response.latencyMs ?? Date.now() - startTime;
      return {
        ok: true,
        message: `连接成功 (${latencyMs} ms)`,
        latencyMs,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "连接失败，请检查 Base URL、模型名称与 API Key。";
      return {
        ok: false,
        message,
        latencyMs: Date.now() - startTime,
      };
    }
  }
}
