/**
 * @file style/engine.ts
 * @module @md-editor/ai/style
 * @description
 * 风格学习轮次引擎：比对样本变化、维护样本特征、在需要时调用本地模型分类并推进画像。
 *
 * 引擎不包含计时与触发逻辑（由 desktop 组合根决定何时调用 `run`），
 * 只通过 `StyleLearningHost` 访问文件与存储，通过 `StyleInferencePort` 独占调度本地推理。
 */

import { createLocalAffinityKey } from "../app/request-scheduler.ts";
import { STANDARD_LOCAL_MODEL_ID } from "../domain/settings.ts";
import { applyObservations, observeGlobal, observeSamples, withEditFeedback } from "./aggregate.ts";
import { recomputeWorkspaceLayers } from "./recompute.ts";
import { summarizeEditFeatures } from "./edit-feedback.ts";
import {
  buildStyleClassifyRequest,
  chunkStyleProse,
  parseStyleClassifyOutput,
  voteStyleLabels,
} from "./classify.ts";
import { extractStyleProse } from "./extraction.ts";
import { hashStyleText } from "./hash.ts";
import type { StyleInferencePort, StyleLearningHost, StyleSampleScanEntry } from "./host.ts";
import {
  findStyleRelinkCandidate,
  isStyleProfileExpired,
  isStyleProfileLinked,
} from "./identity.ts";
import { computeSampleStats } from "./statistics.ts";
import {
  createEmptyStyleProfileDocument,
  type StyleProfileDocument,
  type StyleSampleRecord,
  type WorkspaceStyleProfileRecord,
} from "./types.ts";

/** 每个工作区最多保留的样本数（按修改时间取最近的） */
export const MAX_STYLE_SAMPLES = 300;
/** 累计多少次样本变化后触发一轮汇总 */
export const ROUND_CHANGE_THRESHOLD = 20;
/** 首次学习至少需要的有效样本数 */
export const BOOTSTRAP_MIN_SAMPLES = 5;
/** 首次学习最多使用的样本数 */
export const BOOTSTRAP_MAX_SAMPLES = 60;
/** 首次学习把样本分成几组，每组算作一轮独立观察 */
export const BOOTSTRAP_ROUNDS = 3;
/** 单次运行最多分类的样本数，控制一次空闲窗口内的推理量 */
export const MAX_CLASSIFY_PER_RUN = 60;
/** Rust 侧拒绝切换正在使用的其他模型时返回的错误 */
export const STYLE_RUNTIME_BUSY_ERROR = "local-ai-busy";

export type StyleLearningStatus =
  /** 没有变化，也没有到汇总时机 */
  | "idle"
  /** 只更新了样本（变化计数、删除样本后的重新聚合） */
  | "updated"
  /** 完成了一轮或首次学习 */
  | "learned"
  /** 被用户请求抢占或被调用方取消，本轮未写入 */
  | "preempted"
  /** 本轮读取后数据被其他写入者改动（清除、撤销找回、重命名），结果已丢弃，下次基于最新数据重算 */
  | "discarded"
  /** 本地 runtime 正在使用其他模型，放弃本次空闲窗口 */
  | "busy"
  | "failed";

export interface StyleLearningOutcome {
  readonly status: StyleLearningStatus;
  /**
   * 本轮写入后的文档；未写入（无变化、被抢占、被丢弃、失败）时为 undefined。
   * 宿主应以存储层广播的文档为准，这里只用于测试与日志。
   */
  readonly document?: StyleProfileDocument;
  readonly workspaceId?: string;
  /** 本次运行通过自动找回改绑的画像 */
  readonly relinked?: { readonly profileId: string; readonly previousRoot: string };
  readonly error?: string;
}

export interface StyleLearningRunOptions {
  /** 是否允许把失去关联的画像改绑到当前目录 */
  readonly autoRelink?: boolean;
  readonly signal?: AbortSignal;
}

export interface StyleLearningEngineDeps {
  readonly host: StyleLearningHost;
  readonly inference: StyleInferencePort;
  readonly now?: () => Date;
}

interface PreparedSample {
  readonly record: StyleSampleRecord;
  /** 本次运行读取到的正文段落，只在内存中使用，供分类 */
  readonly paragraphs?: readonly string[];
}

export class StyleLearningEngine {
  private readonly host: StyleLearningHost;
  private readonly inference: StyleInferencePort;
  private readonly now: () => Date;

  public constructor(deps: StyleLearningEngineDeps) {
    this.host = deps.host;
    this.inference = deps.inference;
    this.now = deps.now ?? (() => new Date());
  }

  public async run(options: StyleLearningRunOptions = {}): Promise<StyleLearningOutcome> {
    let document = (await this.host.loadProfile()) ?? createEmptyStyleProfileDocument();
    /** 本轮改动过的工作区 id；提交时只把这些记录与全局层合并进最新文档 */
    const touched = new Set<string>();
    let globalTouched = false;
    /** 本轮最近一次读到或写入的磁盘文档：提交时据此判断其他写入者是否改动了本轮负责的记录 */
    let baseline = document;
    const commit = async (): Promise<void> => {
      throwIfAborted(options.signal);
      const ours = document;
      document = await this.host.updateProfile((latest) => {
        // 本轮读取后数据被清除，或本轮负责的工作区被其他写入者改动（撤销找回、重命名同步）：
        // 丢弃本轮结果，下次基于最新数据重算，不能覆盖用户的操作。
        if (wasClearedSince(baseline, latest) || ownedRecordsChanged(baseline, latest, touched)) {
          throw createDiscardedRunError();
        }
        return mergeOwnedChanges(latest, ours, touched, globalTouched);
      });
      baseline = document;
    };
    try {
      throwIfAborted(options.signal);
      const scan = await this.host.scanSamples();
      const nowIso = this.now().toISOString();
      const beforeExpiry = new Set(document.workspaces.map((workspace) => workspace.id));
      document = dropExpiredProfiles(document, this.now());
      for (const id of beforeExpiry) {
        if (!document.workspaces.some((workspace) => workspace.id === id)) touched.add(id);
      }

      // 1. 找到当前目录对应的画像，并读取变化样本。
      let workspace = document.workspaces.find(
        (candidate) => candidate.rootPath === scan.rootPath && candidate.linkState === "linked",
      );
      const scanned = latestSamples(scan.samples);
      const prepared = await this.prepareSamples(document, workspace, scanned, options.signal);

      // 2. 身份校验：目录内容与画像不符（互换、删除后重建）时，原画像失去关联。
      if (workspace && !isStyleProfileLinked(workspace, prepared.paragraphHashes)) {
        document = replaceWorkspace(document, {
          ...workspace,
          linkState: "unlinked",
          unlinkedSince: nowIso,
        });
        touched.add(workspace.id);
        workspace = undefined;
      }

      let relinked: StyleLearningOutcome["relinked"];
      if (!workspace && options.autoRelink) {
        const candidate = findStyleRelinkCandidate(
          document.workspaces,
          prepared.paragraphHashes,
          scan.rootPath,
        );
        const target = document.workspaces.find((profile) => profile.id === candidate?.profileId);
        if (target) {
          relinked = { profileId: target.id, previousRoot: target.rootPath };
          const { unlinkedSince: _unlinkedSince, ...rest } = target;
          workspace = {
            ...rest,
            rootPath: scan.rootPath,
            linkState: "linked",
            relinkedFrom: { rootPath: target.rootPath, at: nowIso },
          };
          document = replaceWorkspace(document, workspace);
          touched.add(workspace.id);
        }
      }

      const isNew = !workspace;
      const base: WorkspaceStyleProfileRecord = workspace ?? {
        // 同一路径可能先后对应多个画像（目录被替换后重建），id 不能由路径推导。
        id: `ws-${globalThis.crypto.randomUUID()}`,
        rootPath: scan.rootPath,
        linkState: "linked",
        samples: [],
        rules: [],
        roundCount: 0,
        changesSinceRound: 0,
      };
      // 找回或新建时样本 id 需要与新目录对齐，重新准备一次。
      const samples =
        isNew || relinked
          ? (await this.prepareSamples(document, base, scanned, options.signal)).samples
          : prepared.samples;

      // 3. 应用样本变化；删除或修改的样本立即丢弃旧特征并重新聚合当前轮。
      const diff = diffSamples(base.samples, samples);
      let next: WorkspaceStyleProfileRecord = {
        ...base,
        samples: samples.map((sample) => sample.record),
        changesSinceRound: base.changesSinceRound + diff.changed,
      };
      if (diff.removed > 0 && next.roundCount > 0) {
        // 与排除路径共用同一套重算：工作区规则与全局层一起更新。
        next = recomputeWorkspaceLayers(upsertWorkspace(document, next), next.id).workspaces.find(
          (entry) => entry.id === next.id,
        )!;
      }
      document = upsertWorkspace(document, next);
      const changed = diff.changed > 0 || isNew || Boolean(relinked) || touched.size > 0;
      touched.add(next.id);

      const eligible = samples.filter((sample) => sample.record.eligible);
      const bootstrap = next.roundCount === 0 && eligible.length >= BOOTSTRAP_MIN_SAMPLES;
      const roundDue = next.roundCount > 0 && next.changesSinceRound >= ROUND_CHANGE_THRESHOLD;
      if (!bootstrap && !roundDue) {
        // 没有任何变化时不写盘：空闲时的重复检查不应改写画像。
        if (changed) await commit();
        return {
          status: changed ? "updated" : "idle",
          document: changed ? document : undefined,
          workspaceId: next.id,
          relinked,
        };
      }

      // 先保存样本变化，分类被抢占时这些变化不会丢失。
      await commit();

      // 4. 分类尚未打标签的样本（只走本地 Standard，经共享调度器独占派发）。
      // 已有标签的样本（包括上次被抢占前已分类的）不再重复调用模型。
      const toClassify = (bootstrap ? bootstrapSamples(eligible).flat() : eligible).filter(
        (sample) => Object.keys(sample.record.labels).length === 0,
      );
      const labelled = new Map<string, StyleSampleRecord["labels"]>();
      const classifyOutcome = await this.classifyAll(
        toClassify.slice(0, MAX_CLASSIFY_PER_RUN),
        scan.rootPath,
        labelled,
        options.signal,
      );
      next = {
        ...next,
        samples: next.samples.map((sample) =>
          labelled.has(sample.id) ? { ...sample, labels: labelled.get(sample.id)! } : sample,
        ),
      };
      if (classifyOutcome !== "ok") {
        // 已得到的样本标签是样本自身的事实，保留；本轮汇总不写入。
        document = upsertWorkspace(document, next);
        // 本块被用户请求抢占时整轮仍有效，标签照常保存；整轮被取消（关闭学习、切换工作区）时不写入。
        const saved = labelled.size > 0 && !options.signal?.aborted;
        if (saved) await commit();
        return {
          status: classifyOutcome.status,
          document: saved ? document : undefined,
          workspaceId: next.id,
          relinked,
          error: classifyOutcome.error,
        };
      }

      // 5. 汇总：首次学习按分组记多轮，之后每次记一轮。
      const byId = new Map(next.samples.map((sample) => [sample.id, sample]));
      let rules = next.rules;
      let roundCount = next.roundCount;
      const groups = bootstrap
        ? bootstrapSamples(eligible).map((group) =>
            group.map((sample) => byId.get(sample.record.id)!),
          )
        : [next.samples];
      // 自上一轮以来“用户修改 AI 建议”的特征作为附加观察，只计入最后一轮。
      const feedback = summarizeEditFeatures(
        document.editFeedback?.[next.id] ?? [],
        next.lastRoundAt,
      );
      for (const [index, group] of groups.entries()) {
        roundCount += 1;
        const observations = observeSamples(group, roundCount);
        rules = applyObservations(
          rules,
          index === groups.length - 1
            ? withEditFeedback(observations, feedback, roundCount)
            : observations,
        );
      }
      next = { ...next, rules, roundCount, changesSinceRound: 0, lastRoundAt: nowIso };
      document = upsertWorkspace(document, next);

      globalTouched = true;
      const globalRound = document.global.roundCount + 1;
      document = {
        ...document,
        global: {
          roundCount: globalRound,
          rules: applyObservations(
            document.global.rules,
            observeGlobal(document.workspaces, globalRound),
          ),
        },
      };
      await commit();
      return { status: "learned", document, workspaceId: next.id, relinked };
    } catch (error) {
      if (isDiscardedRunError(error)) {
        return { status: "discarded" };
      }
      if (isAbortError(error)) {
        return { status: "preempted" };
      }
      return { status: "failed", error: errorMessage(error) };
    }
  }

  /**
   * 使用画像前的身份校验：当前目录的内容是否仍对应已关联的画像（互换、删除后重建时为 false）。
   * 不调用模型、不写入；没有已关联画像时返回 false。
   */
  public async verifyWorkspace(signal?: AbortSignal): Promise<boolean> {
    const document = await this.host.loadProfile();
    if (!document) return false;
    const scan = await this.host.scanSamples();
    const workspace = document.workspaces.find(
      (candidate) => candidate.rootPath === scan.rootPath && candidate.linkState === "linked",
    );
    if (!workspace) return false;
    const prepared = await this.prepareSamples(
      document,
      workspace,
      latestSamples(scan.samples),
      signal,
    );
    return isStyleProfileLinked(workspace, prepared.paragraphHashes);
  }

  /**
   * 为扫描结果准备样本记录：内容未变的样本复用已存特征，新增或修改的样本重新读取并抽取。
   */
  private async prepareSamples(
    document: StyleProfileDocument,
    workspace: WorkspaceStyleProfileRecord | undefined,
    scanned: readonly StyleSampleScanEntry[],
    signal: AbortSignal | undefined,
  ): Promise<{ samples: PreparedSample[]; paragraphHashes: Set<string> }> {
    const stored = new Map(workspace?.samples.map((sample) => [sample.relPath, sample]));
    const aiSegments = workspace ? document.aiSegments[workspace.id] : undefined;
    const samples: PreparedSample[] = [];
    const paragraphHashes = new Set<string>();

    for (const entry of scanned) {
      throwIfAborted(signal);
      const existing = stored.get(entry.relPath);
      if (existing && existing.sha256 === entry.sha256) {
        samples.push({ record: existing });
        existing.paragraphHashes.forEach((hash) => paragraphHashes.add(hash));
        continue;
      }
      let markdown: string;
      try {
        markdown = await this.host.readSample(entry.relPath);
      } catch {
        // 扫描后被删除或无法读取的文件跳过，下次扫描再处理。
        continue;
      }
      const prose = extractStyleProse(markdown, {
        aiSentenceHashes: new Set(aiSegments?.[entry.relPath] ?? []),
      });
      prose.paragraphHashes.forEach((hash) => paragraphHashes.add(hash));
      samples.push({
        record: {
          id: existing?.id ?? `s-${hashStyleText(entry.relPath).slice(3)}`,
          relPath: entry.relPath,
          sha256: entry.sha256,
          paragraphHashes: prose.paragraphHashes,
          eligible: prose.eligible,
          stats: computeSampleStats(prose),
          labels: {},
        },
        paragraphs: prose.paragraphs,
      });
    }
    return { samples, paragraphHashes };
  }

  private async classifyAll(
    samples: readonly PreparedSample[],
    rootPath: string,
    labelled: Map<string, StyleSampleRecord["labels"]>,
    signal: AbortSignal | undefined,
  ): Promise<"ok" | { status: "preempted" | "busy" | "failed"; error?: string }> {
    for (const sample of samples) {
      try {
        const paragraphs =
          sample.paragraphs ??
          extractStyleProse(await this.host.readSample(sample.record.relPath)).paragraphs;
        const chunkLabels = [];
        for (const [index, chunk] of chunkStyleProse(paragraphs).entries()) {
          throwIfAborted(signal);
          const output = await this.classifyChunk(
            chunk,
            rootPath,
            `${sample.record.id}:${index}`,
            signal,
          );
          chunkLabels.push(parseStyleClassifyOutput(output));
        }
        labelled.set(sample.record.id, voteStyleLabels(chunkLabels));
      } catch (error) {
        if (isAbortError(error)) {
          return { status: "preempted" };
        }
        if (errorMessage(error).includes(STYLE_RUNTIME_BUSY_ERROR)) {
          return { status: "busy" };
        }
        return { status: "failed", error: errorMessage(error) };
      }
    }
    return "ok";
  }

  private classifyChunk(
    chunk: string,
    rootPath: string,
    anchor: string,
    runSignal: AbortSignal | undefined,
  ): Promise<string> {
    const request = buildStyleClassifyRequest(chunk);
    const scheduled = this.inference.schedule({
      scope: { documentId: `style:${rootPath}`, task: "style-analysis", anchor },
      priority: "background",
      exclusive: true,
      replace: false,
      affinityKey: createLocalAffinityKey(STANDARD_LOCAL_MODEL_ID, "none"),
      run: ({ signal }) =>
        this.inference.bridge(request, { signal: combineAbortSignals(signal, runSignal) }),
    });
    // 关闭风格学习或切换工作区时，调用方取消整个轮次，排队或进行中的分类一并取消。
    // 派发是同步的，run 内部可能已经触发了取消，所以先检查一次再监听；结束后移除监听。
    const cancel = () => scheduled.cancel();
    if (runSignal?.aborted) {
      cancel();
    } else {
      runSignal?.addEventListener("abort", cancel, { once: true });
    }
    return scheduled.promise.finally(() => runSignal?.removeEventListener("abort", cancel));
  }
}

/** 超过样本上限时保留最近修改的文件，输出按路径排序保持稳定 */
function latestSamples(samples: readonly StyleSampleScanEntry[]): StyleSampleScanEntry[] {
  return samples
    .toSorted((a, b) => b.modifiedMs - a.modifiedMs || a.relPath.localeCompare(b.relPath))
    .slice(0, MAX_STYLE_SAMPLES)
    .toSorted((a, b) => a.relPath.localeCompare(b.relPath));
}

/** 首次学习：按内容 hash 排序后轮流分组，得到互不相交的若干组 */
function bootstrapSamples(eligible: readonly PreparedSample[]): PreparedSample[][] {
  const chosen = eligible
    .toSorted((a, b) => a.record.sha256.localeCompare(b.record.sha256))
    .slice(0, BOOTSTRAP_MAX_SAMPLES);
  const groups: PreparedSample[][] = Array.from({ length: BOOTSTRAP_ROUNDS }, () => []);
  chosen.forEach((sample, index) => groups[index % BOOTSTRAP_ROUNDS]!.push(sample));
  return groups;
}

function diffSamples(
  previous: readonly StyleSampleRecord[],
  next: readonly PreparedSample[],
): { changed: number; removed: number } {
  const before = new Map(previous.map((sample) => [sample.relPath, sample.sha256]));
  const after = new Map(next.map((sample) => [sample.record.relPath, sample.record.sha256]));
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const [relPath, sha] of after) {
    const old = before.get(relPath);
    if (old === undefined) {
      added += 1;
    } else if (old !== sha) {
      modified += 1;
    }
  }
  for (const relPath of before.keys()) {
    if (!after.has(relPath)) {
      deleted += 1;
    }
  }
  return { changed: added + modified + deleted, removed: modified + deleted };
}

function replaceWorkspace(
  document: StyleProfileDocument,
  workspace: WorkspaceStyleProfileRecord,
): StyleProfileDocument {
  return {
    ...document,
    workspaces: document.workspaces.map((candidate) =>
      candidate.id === workspace.id ? workspace : candidate,
    ),
  };
}

function upsertWorkspace(
  document: StyleProfileDocument,
  workspace: WorkspaceStyleProfileRecord,
): StyleProfileDocument {
  return document.workspaces.some((candidate) => candidate.id === workspace.id)
    ? replaceWorkspace(document, workspace)
    : { ...document, workspaces: [...document.workspaces, workspace] };
}

function dropExpiredProfiles(document: StyleProfileDocument, now: Date): StyleProfileDocument {
  const expired = new Set(
    document.workspaces
      .filter((workspace) => isStyleProfileExpired(workspace, now))
      .map((workspace) => workspace.id),
  );
  if (expired.size === 0) {
    return document;
  }
  return {
    ...document,
    workspaces: document.workspaces.filter((workspace) => !expired.has(workspace.id)),
    aiSegments: Object.fromEntries(
      Object.entries(document.aiSegments).filter(([id]) => !expired.has(id)),
    ),
    editFeedback: Object.fromEntries(
      Object.entries(document.editFeedback ?? {}).filter(([id]) => !expired.has(id)),
    ),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("风格学习已取消。");
    error.name = "AbortError";
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把本轮负责的字段合并进最新文档：本轮改动过的工作区记录（含删除）与全局层。
 * 其他字段（自定义规则、采纳 AI 段、本轮未触及的工作区）一律以最新文档为准。
 * 本轮触及的工作区若已被清除数据（最新文档中没有其他工作区且无 revision），同样以最新为准。
 */
export function mergeOwnedChanges(
  latest: StyleProfileDocument,
  ours: StyleProfileDocument,
  touched: ReadonlySet<string>,
  globalTouched: boolean,
): StyleProfileDocument {
  const ourById = new Map(ours.workspaces.map((workspace) => [workspace.id, workspace]));
  const kept = latest.workspaces
    .filter((workspace) => !touched.has(workspace.id) || ourById.has(workspace.id))
    .map((workspace) => (touched.has(workspace.id) ? ourById.get(workspace.id)! : workspace));
  const added = ours.workspaces.filter(
    (workspace) =>
      touched.has(workspace.id) && !latest.workspaces.some((entry) => entry.id === workspace.id),
  );
  return {
    ...latest,
    workspaces: [...kept, ...added],
    global: globalTouched ? ours.global : latest.global,
  };
}

/** 合并两个取消信号；不依赖 `AbortSignal.any`（较旧的系统 WebView 不支持） */
function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) return second;
  if (!second) return first;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) {
    abort();
  } else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

/**
 * 判断从 `ours` 读取之后数据是否被清除过：
 * `ours` 来自已保存的文档，而最新文档不存在（revision 为 0）或已换成新的代次。
 */
export function wasClearedSince(ours: StyleProfileDocument, latest: StyleProfileDocument): boolean {
  if ((ours.revision ?? 0) === 0) return false;
  return (latest.revision ?? 0) === 0 || latest.epoch !== ours.epoch;
}

const DISCARDED_RUN_ERROR = "StyleRunDiscarded";

function createDiscardedRunError(): Error {
  const error = new Error("风格学习数据已被其他写入者改动，本轮结果已丢弃。");
  error.name = DISCARDED_RUN_ERROR;
  return error;
}

function isDiscardedRunError(error: unknown): boolean {
  return error instanceof Error && error.name === DISCARDED_RUN_ERROR;
}

/**
 * 本轮负责的工作区在读取之后是否被其他写入者改动过身份相关字段或样本路径
 * （撤销找回、应用内重命名同步）。只比较这些字段：学习自身不会改动它们之外的他人字段。
 */
export function ownedRecordsChanged(
  initial: StyleProfileDocument,
  latest: StyleProfileDocument,
  touched: ReadonlySet<string>,
): boolean {
  const before = new Map(initial.workspaces.map((workspace) => [workspace.id, workspace]));
  for (const workspace of latest.workspaces) {
    if (!touched.has(workspace.id)) continue;
    const original = before.get(workspace.id);
    if (!original) continue;
    const identityChanged =
      original.rootPath !== workspace.rootPath ||
      original.linkState !== workspace.linkState ||
      original.relinkedFrom?.at !== workspace.relinkedFrom?.at ||
      (original.relinkDeclined ?? []).join("\n") !== (workspace.relinkDeclined ?? []).join("\n");
    const pathsChanged =
      original.samples.map((sample) => sample.relPath).join("\n") !==
      workspace.samples.map((sample) => sample.relPath).join("\n");
    if (identityChanged || pathsChanged) return true;
  }
  return false;
}
