/**
 * @file style-learning-coordinator.ts
 * @description
 * 桌面端风格学习的触发与协调（不依赖 React，便于单测）。
 *
 * 负责“什么时候学”，不负责“怎么学”（后者由 `@md-editor/ai/style` 的学习引擎完成）：
 * - 只在风格学习开启、本地 Standard 已就绪、当前打开了工作区时运行；
 * - 只在空闲时运行：编辑器 2 分钟无输入、当前文档已保存、窗口可见；
 * - 不切换正在使用的本地模型：写作模型为热 Lite 时等待 runtime 变冷；
 * - 一次只运行一轮；用户请求通过共享调度器抢占正在进行的分类。
 */
import { STANDARD_LOCAL_MODEL_ID, type AiSettings } from "@md-editor/ai";
import {
  hashStyleText,
  renameStyleRelPath,
  splitStyleSentences,
  type StyleProfileDocument,
} from "@md-editor/ai/style";
import type { StyleLearningOutcome } from "@md-editor/ai/style-engine";

/** 编辑器无输入多久后视为空闲 */
export const STYLE_LEARNING_IDLE_MS = 2 * 60 * 1000;
/** 本地 runtime 空闲多久后会被关闭（与 Rust `LOCAL_AI_IDLE_TIMEOUT` 一致） */
export const LOCAL_RUNTIME_COLD_MS = 5 * 60 * 1000;
/** 两次学习尝试之间的最短间隔 */
export const STYLE_LEARNING_RETRY_MS = 60 * 1000;

export interface StyleLearningEnvironment {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  /** 当前文档是否有未保存修改 */
  readonly isDocumentDirty: () => boolean;
  readonly isWindowVisible: () => boolean;
}

export interface StyleLearningRunner {
  /** 对当前工作区执行一轮学习 */
  run(input: {
    readonly rootPath: string;
    readonly autoRelink: boolean;
    readonly signal: AbortSignal;
  }): Promise<StyleLearningOutcome>;
}

export interface StyleLearningCallbacks {
  /** 自动找回成功时通知用户（唯一会提示用户的学习结果） */
  readonly onRelinked?: (info: { readonly fromRoot: string; readonly toRoot: string }) => void;
  /** 画像文档有变化时通知（设置页刷新） */
  readonly onDocumentChanged?: (document: StyleProfileDocument) => void;
}

/** 学习是否可能运行（不含空闲条件） */
export interface StyleLearningConditions {
  readonly settings: AiSettings;
  /** 本地 Standard 是否已下载可用 */
  readonly standardModelReady: boolean;
  readonly rootPath: string | null;
}

export class StyleLearningCoordinator {
  private conditions: StyleLearningConditions | null = null;
  private lastInputAt: number;
  private lastLocalAiUseAt = Number.NEGATIVE_INFINITY;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private running: AbortController | null = null;
  private disposed = false;

  public constructor(
    private readonly env: StyleLearningEnvironment,
    private readonly runner: StyleLearningRunner,
    private readonly callbacks: StyleLearningCallbacks = {},
  ) {
    this.lastInputAt = env.now();
  }

  /** 设置、模型状态或工作区变化时调用 */
  public update(conditions: StyleLearningConditions): void {
    const previousRoot = this.conditions?.rootPath;
    this.conditions = conditions;
    if (!this.canLearn() || previousRoot !== conditions.rootPath) {
      // 关闭开关或切换工作区时立即停止进行中的学习。
      this.cancelRunning();
    }
    this.schedule();
  }

  /** 用户在编辑器中输入时调用 */
  public noteUserInput(): void {
    this.lastInputAt = this.env.now();
    this.schedule();
  }

  /** 任何本地模型请求（续写、纠错）发出时调用，用于判断 runtime 是否仍热 */
  public noteLocalAiUse(): void {
    this.lastLocalAiUseAt = this.env.now();
  }

  /** 文档保存、文件夹内容变化等可能产生新样本时调用 */
  public noteWorkspaceChanged(): void {
    this.schedule();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelRunning();
    this.clearTimer();
  }

  /** 是否满足学习前提（开关、模型、工作区） */
  public canLearn(): boolean {
    const conditions = this.conditions;
    return Boolean(
      conditions &&
      conditions.settings.styleLearning.enabled &&
      conditions.standardModelReady &&
      conditions.rootPath,
    );
  }

  /**
   * 不能为了学习而切换掉正在使用的本地模型：写作模型就是 Standard、使用云端，
   * 或本地 runtime 已经变冷时才允许学习。
   */
  public runtimeAllowsLearning(): boolean {
    const settings = this.conditions?.settings;
    if (!settings) return false;
    if (settings.provider !== "local") return true;
    if (settings.localModel.modelId === STANDARD_LOCAL_MODEL_ID) return true;
    return this.env.now() - this.lastLocalAiUseAt >= LOCAL_RUNTIME_COLD_MS;
  }

  private isIdle(): boolean {
    return (
      this.env.now() - this.lastInputAt >= STYLE_LEARNING_IDLE_MS &&
      !this.env.isDocumentDirty() &&
      this.env.isWindowVisible()
    );
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.canLearn() || this.running) return;
    const now = this.env.now();
    const readyAt = Math.max(
      this.lastInputAt + STYLE_LEARNING_IDLE_MS,
      this.lastAttemptAt + STYLE_LEARNING_RETRY_MS,
      this.conditions?.settings.provider === "local" &&
        this.conditions.settings.localModel.modelId !== STANDARD_LOCAL_MODEL_ID
        ? this.lastLocalAiUseAt + LOCAL_RUNTIME_COLD_MS
        : Number.NEGATIVE_INFINITY,
    );
    this.timer = this.env.setTimer(() => void this.tryRun(), Math.max(0, readyAt - now));
  }

  private async tryRun(): Promise<void> {
    this.timer = null;
    if (this.disposed || !this.canLearn() || this.running) return;
    if (!this.isIdle() || !this.runtimeAllowsLearning()) {
      // 窗口不可见或文档未保存时，过一会儿再检查。
      this.lastAttemptAt = this.env.now();
      this.schedule();
      return;
    }
    const conditions = this.conditions!;
    const controller = new AbortController();
    this.running = controller;
    this.lastAttemptAt = this.env.now();
    try {
      const outcome = await this.runner.run({
        rootPath: conditions.rootPath!,
        autoRelink: conditions.settings.styleLearning.autoRelink,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (outcome.status !== "idle") {
        this.callbacks.onDocumentChanged?.(outcome.document);
      }
      if (outcome.relinked) {
        this.callbacks.onRelinked?.({
          fromRoot: outcome.relinked.previousRoot,
          toRoot: conditions.rootPath!,
        });
      }
      if (import.meta.env?.DEV) {
        console.debug("[Style Learning] round finished", {
          status: outcome.status,
          workspaces: outcome.document.workspaces.length,
        });
      }
    } catch (error) {
      // 学习失败保持静默，只在 dev 日志中记录（不含正文）。
      if (import.meta.env?.DEV) {
        console.debug("[Style Learning] round failed", (error as Error)?.name);
      }
    } finally {
      if (this.running === controller) {
        this.running = null;
      }
      this.schedule();
    }
  }

  private cancelRunning(): void {
    this.running?.abort();
    this.running = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

/** 记录用户采纳的 AI 文本：把插入文本切句后求 hash，不保存原文 */
export function recordAcceptedAiText(
  document: StyleProfileDocument,
  workspaceId: string,
  relPath: string,
  text: string,
  limitPerFile = 500,
): StyleProfileDocument {
  const hashes = splitStyleSentences(text).map(hashStyleText);
  if (hashes.length === 0) return document;
  const workspaceSegments = document.aiSegments[workspaceId] ?? {};
  const existing = workspaceSegments[relPath] ?? [];
  const merged = [...new Set([...existing, ...hashes])].slice(-limitPerFile);
  return {
    ...document,
    aiSegments: {
      ...document.aiSegments,
      [workspaceId]: { ...workspaceSegments, [relPath]: merged },
    },
  };
}

/** 应用内重命名或移动后同步样本路径与采纳记录 */
export function renameInStyleDocument(
  document: StyleProfileDocument,
  rootPath: string,
  from: string,
  to: string,
): StyleProfileDocument {
  const workspace = document.workspaces.find(
    (candidate) => candidate.rootPath === rootPath && candidate.linkState === "linked",
  );
  if (!workspace) return document;
  const segments = document.aiSegments[workspace.id] ?? {};
  return {
    ...document,
    workspaces: document.workspaces.map((candidate) =>
      candidate.id === workspace.id
        ? {
            ...candidate,
            samples: candidate.samples.map((sample) => ({
              ...sample,
              relPath: renameStyleRelPath(sample.relPath, from, to),
            })),
          }
        : candidate,
    ),
    aiSegments: {
      ...document.aiSegments,
      [workspace.id]: Object.fromEntries(
        Object.entries(segments).map(([relPath, hashes]) => [
          renameStyleRelPath(relPath, from, to),
          hashes,
        ]),
      ),
    },
  };
}

/** 应用内重命名后同步排除列表 */
export function renameExclusions(excluded: readonly string[], from: string, to: string): string[] {
  return excluded.map((entry) => renameStyleRelPath(entry, from, to));
}
