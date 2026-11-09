/**
 * @file style/identity.ts
 * @module @md-editor/ai/style
 * @description
 * 目录身份校验与找回：用样本的段落 hash 判断“这个目录还是不是学习时的那个目录”。
 *
 * 只看文件路径不可靠：目录可能被移动、互换，或删除后在同一路径新建。
 * 段落级 hash 对“只改了几段”的外部编辑也能保持稳定。
 */

import { applyObservations, observeSamples } from "./aggregate.ts";
import type { StyleProfileDocument, WorkspaceStyleProfileRecord } from "./types.ts";

/** 身份分数低于该值时，画像视为与当前目录失去关联 */
export const LINK_MIN_SCORE = 0.3;
/** 自动找回的最低身份分数 */
export const RELINK_MIN_SCORE = 0.5;
/** 自动找回至少需要匹配到的样本数 */
export const RELINK_MIN_MATCHED_SAMPLES = 3;
/** 失去关联超过该天数的画像被清理 */
export const UNLINKED_RETENTION_DAYS = 30;

export interface StyleIdentityScore {
  /** 当前目录中仍然存在的已存段落 hash 占比 */
  readonly score: number;
  /** 至少有一个段落仍然存在的样本数 */
  readonly matchedSamples: number;
}

/**
 * 计算画像与某个目录的身份分数。
 *
 * `currentParagraphHashes` 为目录当前全部样本的段落 hash 集合。
 * 分数采用包含度（已存 hash 中仍存在的比例），目录多出来的新文章不会拉低分数。
 */
export function scoreStyleIdentity(
  profile: Pick<WorkspaceStyleProfileRecord, "samples">,
  currentParagraphHashes: ReadonlySet<string>,
): StyleIdentityScore {
  let stored = 0;
  let present = 0;
  let matchedSamples = 0;
  for (const sample of profile.samples) {
    let samplePresent = 0;
    for (const hash of sample.paragraphHashes) {
      stored += 1;
      if (currentParagraphHashes.has(hash)) {
        present += 1;
        samplePresent += 1;
      }
    }
    if (samplePresent > 0) {
      matchedSamples += 1;
    }
  }
  return { score: stored === 0 ? 0 : present / stored, matchedSamples };
}

/** 已存段落 hash 为空的画像（例如样本都太短）无法校验身份，视为仍然关联 */
export function isStyleProfileLinked(
  profile: Pick<WorkspaceStyleProfileRecord, "samples">,
  currentParagraphHashes: ReadonlySet<string>,
): boolean {
  const hasHashes = profile.samples.some((sample) => sample.paragraphHashes.length > 0);
  return !hasHashes || scoreStyleIdentity(profile, currentParagraphHashes).score >= LINK_MIN_SCORE;
}

export interface StyleRelinkCandidate {
  readonly profileId: string;
  readonly score: number;
  readonly matchedSamples: number;
}

/**
 * 为新打开的目录在失去关联的画像中挑选找回目标：分数最高且达到阈值者胜出。
 */
export function findStyleRelinkCandidate(
  profiles: readonly WorkspaceStyleProfileRecord[],
  currentParagraphHashes: ReadonlySet<string>,
  rootPath?: string,
): StyleRelinkCandidate | undefined {
  let best: StyleRelinkCandidate | undefined;
  for (const profile of profiles) {
    // 用户撤销过找回到这个目录，不再自动找回。
    if (
      profile.linkState !== "unlinked" ||
      (rootPath && profile.relinkDeclined?.includes(rootPath))
    ) {
      continue;
    }
    const { score, matchedSamples } = scoreStyleIdentity(profile, currentParagraphHashes);
    if (score < RELINK_MIN_SCORE || matchedSamples < RELINK_MIN_MATCHED_SAMPLES) {
      continue;
    }
    if (!best || score > best.score) {
      best = { profileId: profile.id, score, matchedSamples };
    }
  }
  return best;
}

/** 应用内重命名或移动后，更新样本与排除列表中的相对路径（文件或目录前缀） */
export function renameStyleRelPath(relPath: string, from: string, to: string): string {
  if (relPath === from) {
    return to;
  }
  return relPath.startsWith(`${from}/`) ? `${to}${relPath.slice(from.length)}` : relPath;
}

/** 失去关联超过保留期的画像应被清理 */
export function isStyleProfileExpired(
  profile: Pick<WorkspaceStyleProfileRecord, "linkState" | "unlinkedSince">,
  now: Date,
): boolean {
  if (profile.linkState !== "unlinked" || !profile.unlinkedSince) {
    return false;
  }
  const since = Date.parse(profile.unlinkedSince);
  return (
    Number.isFinite(since) && now.getTime() - since > UNLINKED_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
}

/**
 * 用户排除列表的路径前缀匹配，与 Rust 扫描规则一致：
 * 排除 `notes` 会排除 `notes` 文件本身与 `notes/` 下的全部内容，但不影响 `notes-old`。
 */
export function isUserStyleExcluded(relPath: string, excluded: readonly string[]): boolean {
  return excluded.some((entry) => {
    const normalized = entry.replace(/\/+$/u, "");
    return relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
}

/**
 * 撤销一次自动找回：画像回到找回前的根目录并标记为失去关联，
 * 当前目录之后按新目录学习。只对带 `relinkedFrom` 的已关联画像生效。
 */
export function undoStyleRelink(
  workspaces: readonly WorkspaceStyleProfileRecord[],
  profileId: string,
  now: string,
): WorkspaceStyleProfileRecord[] {
  return workspaces.map((workspace) => {
    if (workspace.id !== profileId || !workspace.relinkedFrom) return workspace;
    const { relinkedFrom, ...rest } = workspace;
    return {
      ...rest,
      rootPath: relinkedFrom.rootPath,
      linkState: "unlinked",
      unlinkedSince: now,
      relinkDeclined: [...new Set([...(workspace.relinkDeclined ?? []), workspace.rootPath])],
    };
  });
}

/**
 * 把已排除的样本从画像中剔除并重新聚合当前轮（不调用模型）。
 * 排除后立即生效：被排除文件的统计与标签不再参与合并与注入。
 * 返回原文档表示没有需要剔除的样本。
 */
export function dropExcludedSamples(
  document: StyleProfileDocument,
  workspaceId: string,
  excluded: readonly string[],
): StyleProfileDocument {
  if (excluded.length === 0) return document;
  const workspace = document.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return document;
  const removed = workspace.samples.filter((sample) =>
    isUserStyleExcluded(sample.relPath, excluded),
  );
  if (removed.length === 0) return document;
  const removedIds = new Set(removed.map((sample) => sample.id));
  const samples = workspace.samples.filter((sample) => !removedIds.has(sample.id));
  const rules =
    workspace.roundCount > 0
      ? applyObservations(workspace.rules, observeSamples(samples, workspace.roundCount), {
          replaceLatest: true,
        })
      : workspace.rules;
  return {
    ...document,
    workspaces: document.workspaces.map((candidate) =>
      candidate.id === workspace.id ? { ...candidate, samples, rules } : candidate,
    ),
    aiSegments: {
      ...document.aiSegments,
      [workspace.id]: Object.fromEntries(
        Object.entries(document.aiSegments[workspace.id] ?? {}).filter(
          ([relPath]) => !isUserStyleExcluded(relPath, excluded),
        ),
      ),
    },
  };
}
