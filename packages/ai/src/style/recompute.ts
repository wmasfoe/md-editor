/**
 * @file style/recompute.ts
 * @module @md-editor/ai/style
 * @description
 * 从样本重新计算一轮画像的唯一入口。
 *
 * 学习轮次（删除或修改样本后）与排除文件都必须经过这里：
 * 工作区规则、全局层与采纳 AI 段一起重算，保证“移除证据”在所有派生层上同时生效。
 */

import { applyObservations, observeGlobal, observeSamples } from "./aggregate.ts";
import { isUserStyleExcluded } from "./identity.ts";
import type { StyleProfileDocument, WorkspaceStyleProfileRecord } from "./types.ts";

/**
 * 用工作区当前的样本重算它的规则，并同步重算全局层。
 *
 * `excluded` 非空时同时剔除被排除的样本与它们的 AI 段 hash（排除立即生效）。
 * 没有可重算的内容时返回原文档。
 */
export function recomputeStyleRound(
  document: StyleProfileDocument,
  workspaceId: string,
  options: { readonly excluded?: readonly string[] } = {},
): StyleProfileDocument {
  const excluded = options.excluded ?? [];
  const workspace = document.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return document;

  const removed = excluded.length
    ? workspace.samples.filter((sample) => isUserStyleExcluded(sample.relPath, excluded))
    : [];
  const samples = removed.length
    ? workspace.samples.filter((sample) => !removed.includes(sample))
    : workspace.samples;
  const segments = document.aiSegments[workspace.id] ?? {};
  const prunedSegments = excluded.length
    ? Object.fromEntries(
        Object.entries(segments).filter(([relPath]) => !isUserStyleExcluded(relPath, excluded)),
      )
    : segments;
  const segmentsChanged = Object.keys(prunedSegments).length !== Object.keys(segments).length;
  if (removed.length === 0 && !segmentsChanged) return document;

  const next: WorkspaceStyleProfileRecord =
    workspace.roundCount > 0
      ? {
          ...workspace,
          samples,
          rules: applyObservations(workspace.rules, observeSamples(samples, workspace.roundCount), {
            replaceLatest: true,
          }),
        }
      : { ...workspace, samples };
  const workspaces = document.workspaces.map((candidate) =>
    candidate.id === workspace.id ? next : candidate,
  );
  // 全局层同样由工作区规则推导：被排除的证据不能继续通过全局层进入 prompt。
  const globalRules =
    document.global.roundCount > 0
      ? applyObservations(
          document.global.rules,
          observeGlobal(workspaces, document.global.roundCount),
          { replaceLatest: true },
        )
      : document.global.rules;
  return {
    ...document,
    workspaces,
    global: { ...document.global, rules: globalRules },
    aiSegments: { ...document.aiSegments, [workspace.id]: prunedSegments },
  };
}

/**
 * 只用工作区当前的样本重算规则与全局层（不做排除匹配）。
 * 学习轮次在删除或修改样本后调用，与排除路径共享同一套“重算派生层”的不变量。
 */
export function recomputeWorkspaceLayers(
  document: StyleProfileDocument,
  workspaceId: string,
): StyleProfileDocument {
  const workspace = document.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace || workspace.roundCount === 0) return document;
  const rules = applyObservations(
    workspace.rules,
    observeSamples(workspace.samples, workspace.roundCount),
    { replaceLatest: true },
  );
  const workspaces = document.workspaces.map((candidate) =>
    candidate.id === workspace.id ? { ...candidate, rules } : candidate,
  );
  const globalRules =
    document.global.roundCount > 0
      ? applyObservations(
          document.global.rules,
          observeGlobal(workspaces, document.global.roundCount),
          { replaceLatest: true },
        )
      : document.global.rules;
  return { ...document, workspaces, global: { ...document.global, rules: globalRules } };
}
