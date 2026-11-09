/**
 * @file style-learning-coordinator.ts
 * @description
 * 桌面端风格学习的触发与协调（不依赖 React，便于单测）。
 *
 * 负责“什么时候学”，不负责“怎么学”（后者由 `@md-editor/ai/style` 的学习引擎完成）：
 * - 只在风格学习开启、本地 Standard 已就绪、当前打开了工作区时运行；
 * - 只在空闲时运行：编辑器 2 分钟无输入、当前文档已保存、窗口可见；
 * - 不切换正在使用的本地模型：写作模型为热 Lite 时等待 runtime 变冷；
 * - 一次只运行一轮；用户请求通过共享调度器抢占正在进行的分类；
 * - 只在有待处理的变化时运行：打开工作区、保存文档、文件夹变化、开关或模型变化，
 *   或上一轮被抢占、本地模型忙、出错、刚更新了样本（还可能需要继续）。空闲本身不会触发重复扫描。
 */
import { STANDARD_LOCAL_MODEL_ID, type AiSettings } from "@md-editor/ai";
import { captureStyleLearningError } from "../../error-reporting/sentry";
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
  /** 调度器计量（PRD §2.6：用户请求排队等待、独占任务被抢占次数） */
  readonly schedulerMetrics?: () => {
    readonly urgentWaitMs: { readonly count: number; readonly max: number; readonly p95: number };
    readonly exclusivePreemptions: number;
  };
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
  /** 是否有尚未处理的变化；为 false 时不安排新的学习 */
  private pending = true;
  /** 连续失败次数，用于退避，避免同一错误每分钟触发一次全量扫描 */
  private consecutiveFailures = 0;
  /** 本轮计量（每次运行重置）：抢占次数、模型切换次数；仅 dev 日志使用 */
  private roundMetrics = { preemptions: 0, modelSwitches: 0 };
  /** 按天统计的可学习窗口数（PRD §2.6 计量） */
  private readonly windowsByDay = new Map<string, number>();
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
    this.pending = true;
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

  /** 计量快照（dev 日志与测试使用） */
  public getMetrics(): {
    readonly preemptions: number;
    readonly modelSwitches: number;
    readonly learnableWindowsToday: number;
  } {
    return {
      ...this.roundMetrics,
      learnableWindowsToday: this.windowsByDay.get(dayKey(this.env.now())) ?? 0,
    };
  }

  /** 窗口重新可见时调用：只重新安排已有的待处理工作，不制造新的扫描 */
  public noteVisibilityChanged(): void {
    this.schedule();
  }

  /** 文档保存、文件夹内容变化等可能产生新样本时调用 */
  public noteWorkspaceChanged(): void {
    this.pending = true;
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
    if (this.disposed || !this.canLearn() || this.running || !this.pending) return;
    const now = this.env.now();
    const readyAt = Math.max(
      this.lastInputAt + STYLE_LEARNING_IDLE_MS,
      // 连续失败时按 1、2、4…分钟退避，最长 1 小时。
      this.lastAttemptAt +
        Math.min(STYLE_LEARNING_RETRY_MS * 2 ** this.consecutiveFailures, 60 * 60 * 1000),
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
    // 先消耗本次变化；运行期间新到的变化会把它重新置为 true。
    this.pending = false;
    this.roundMetrics = { preemptions: 0, modelSwitches: 0 };
    const today = dayKey(this.env.now());
    this.windowsByDay.set(today, (this.windowsByDay.get(today) ?? 0) + 1);
    // 只保留最近 7 天，避免长期运行时无限增长。
    const cutoff = dayKey(this.env.now() - 7 * 24 * 60 * 60 * 1000);
    for (const day of this.windowsByDay.keys()) {
      if (day < cutoff) this.windowsByDay.delete(day);
    }
    if (
      conditions.settings.provider === "local" &&
      conditions.settings.localModel.modelId !== STANDARD_LOCAL_MODEL_ID
    ) {
      // 为学习从 Lite 切到 Standard：记录切换次数，用于评估学习机会与代价。
      this.roundMetrics.modelSwitches += 1;
    }
    try {
      const outcome = await this.runner.run({
        rootPath: conditions.rootPath!,
        autoRelink: conditions.settings.styleLearning.autoRelink,
        signal: controller.signal,
      });
      if (outcome.status === "preempted") this.roundMetrics.preemptions += 1;
      // 引擎把失败转成状态返回；这里补上带 feature 标签的上报，beforeSend 才会去掉路径（O-3）。
      if (outcome.status === "failed" && outcome.error) {
        void captureStyleLearningError(new Error(outcome.error));
      }
      if (controller.signal.aborted) return;
      // 被抢占、模型忙、失败或刚更新了样本（可能还需继续分类）时稍后再试；学完或无变化时等下一个变化。
      if (outcome.status !== "idle" && outcome.status !== "learned") this.pending = true;
      this.consecutiveFailures = outcome.status === "failed" ? this.consecutiveFailures + 1 : 0;
      // 只把真正写入磁盘的文档交给宿主；被丢弃或被抢占的轮次不能覆盖内存中的最新数据。
      if (outcome.document) {
        this.callbacks.onDocumentChanged?.(outcome.document);
      }
      if (outcome.relinked) {
        this.callbacks.onRelinked?.({
          fromRoot: outcome.relinked.previousRoot,
          toRoot: conditions.rootPath!,
        });
      }
      if (import.meta.env?.DEV) {
        const workspace = outcome.document?.workspaces.find(
          (candidate) => candidate.rootPath === conditions.rootPath,
        );
        console.debug("[Style Learning] round finished", {
          status: outcome.status,
          workspaces: outcome.document?.workspaces.length ?? null,
          samples: workspace?.samples.length ?? 0,
          observations:
            workspace?.rules.reduce((total, rule) => total + rule.rounds.length, 0) ?? 0,
          activeRules: workspace?.rules.filter((rule) => rule.status === "active").length ?? 0,
          retiredRules: workspace?.rules.filter((rule) => rule.status === "retired").length ?? 0,
          ...this.getMetrics(),
          ...this.callbacks.schedulerMetrics?.(),
        });
      }
    } catch (error) {
      this.pending = true;
      this.consecutiveFailures += 1;
      // 失败对用户保持静默；错误上报带 feature 标签，由 beforeSend 去掉路径（O-3）。
      void captureStyleLearningError(error);
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

/** 本地日期的 YYYY-MM-DD，用于按天统计 */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
