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
  /** 本地 runtime 正在使用其他模型，放弃本次空闲窗口 */
  | "busy"
  | "failed";

export interface StyleLearningOutcome {
  readonly status: StyleLearningStatus;
  readonly document: StyleProfileDocument;
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
    try {
      throwIfAborted(options.signal);
      const scan = await this.host.scanSamples();
      const nowIso = this.now().toISOString();
      document = dropExpiredProfiles(document, this.now());

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
        workspace = undefined;
      }

      let relinked: StyleLearningOutcome["relinked"];
      if (!workspace && options.autoRelink) {
        const candidate = findStyleRelinkCandidate(document.workspaces, prepared.paragraphHashes);
        const target = document.workspaces.find((profile) => profile.id === candidate?.profileId);
        if (target) {
          relinked = { profileId: target.id, previousRoot: target.rootPath };
          workspace = { ...target, rootPath: scan.rootPath, linkState: "linked" };
          delete (workspace as { unlinkedSince?: string }).unlinkedSince;
          document = replaceWorkspace(document, workspace);
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
        editFeedback: [],
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
        next = {
          ...next,
          rules: applyObservations(next.rules, observeSamples(next.samples, next.roundCount), {
            replaceLatest: true,
          }),
        };
      }
      document = upsertWorkspace(document, next);

      const eligible = samples.filter((sample) => sample.record.eligible);
      const bootstrap = next.roundCount === 0 && eligible.length >= BOOTSTRAP_MIN_SAMPLES;
      const roundDue = next.roundCount > 0 && next.changesSinceRound >= ROUND_CHANGE_THRESHOLD;
      if (!bootstrap && !roundDue) {
        await this.host.saveProfile(document);
        return {
          status: diff.changed > 0 || isNew || relinked ? "updated" : "idle",
          document,
          workspaceId: next.id,
          relinked,
        };
      }

      // 先保存样本变化，分类被抢占时这些变化不会丢失。
      await this.host.saveProfile(document);

      // 4. 分类尚未打标签的样本（只走本地 Standard，经共享调度器独占派发）。
      const toClassify = bootstrap
        ? bootstrapSamples(eligible).flat()
        : eligible.filter((sample) => Object.keys(sample.record.labels).length === 0);
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
        await this.host.saveProfile(document);
        return {
          status: classifyOutcome.status,
          document,
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
      const feedback = summarizeEditFeatures(next.editFeedback, next.lastRoundAt);
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
      await this.host.saveProfile(document);
      return { status: "learned", document, workspaceId: next.id, relinked };
    } catch (error) {
      if (isAbortError(error)) {
        return { status: "preempted", document };
      }
      return { status: "failed", document, error: errorMessage(error) };
    }
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
          const output = await this.classifyChunk(chunk, rootPath, `${sample.record.id}:${index}`);
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

  private classifyChunk(chunk: string, rootPath: string, anchor: string): Promise<string> {
    const request = buildStyleClassifyRequest(chunk);
    return this.inference.schedule({
      scope: { documentId: `style:${rootPath}`, task: "style-analysis", anchor },
      priority: "background",
      exclusive: true,
      replace: false,
      affinityKey: createLocalAffinityKey(STANDARD_LOCAL_MODEL_ID, "none"),
      run: ({ signal }) => this.inference.bridge(request, { signal }),
    }).promise;
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
