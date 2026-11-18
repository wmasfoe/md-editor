/**
 * @file session-controller.ts
 * @module apps/desktop/app/controller/session-controller
 * @description
 * 桌面端 Hot Exit 会话恢复与文档历史控制器。
 */

import {
  createHistoryStore,
  createSessionStore,
  generateDraftId,
  type HistorySnapshotTrigger,
  type HistoryStore,
  type SessionStore,
} from "@md-editor/file-system";
import {
  restoreDraftToDocument,
  revertDocumentToSnapshot,
  type DocumentSnapshot,
} from "@md-editor/core";
import {
  createDesktopHistoryStorageAdapter,
  createDesktopSessionStorageAdapter,
} from "../../desktop/session-adapter.ts";
import { runtime } from "../runtime/editor-runtime.ts";

export interface PendingDraftInfo {
  readonly draftId: string;
  readonly filePath: string | null;
  readonly draftContent: string;
  /** 缺省表示宿主未能记录光标（旧会话或退出时编辑器未挂载） */
  readonly cursorOffset?: number;
  readonly lastModifiedAt: number;
}

export const sessionStore: SessionStore = createSessionStore(createDesktopSessionStorageAdapter());

export const historyStore: HistoryStore = createHistoryStore(createDesktopHistoryStorageAdapter());

/**
 * 在应用退出（Cmd+Q、窗口关闭）时毫秒级静默暂存当前活动文档与草稿
 */
export async function saveHotExitSession(
  snapshot: DocumentSnapshot,
  /**
   * 用户离开时的光标偏移。`null` 表示“宿主未能提供”（例如编辑器未挂载）。
   *
   * 未知时**不写入字段**，而不是伪造成 `0`：`0` 是一个真实位置（光标在文档开头），
   * 两者恢复语义不同（未知 → 文档末尾，0 → 回到开头）。
   */
  cursorOffset: number | null = null,
): Promise<void> {
  // 只有 dirty 文档或有内容的未命名文档才需要暂存草稿
  if (!snapshot.isDirty && snapshot.filePath !== null) {
    await sessionStore.clearActiveSession();
    return;
  }

  if (snapshot.filePath === null && !snapshot.markdown.trim()) {
    await sessionStore.clearActiveSession();
    return;
  }

  const draftId = generateDraftId(snapshot.filePath);
  await sessionStore.saveActiveSession({
    doc: {
      filePath: snapshot.filePath,
      isUntitled: snapshot.filePath === null,
      draftId,
      // 未知时不写字段：省略与 `0` 是不同语义，不能被写成同一个值。
      ...(cursorOffset === null ? {} : { cursorOffset }),
      mode: snapshot.mode,
      lastModifiedAt: Date.now(),
    },
    draftMarkdown: snapshot.markdown,
  });
}

/**
 * 检查当前打开文档是否存在比磁盘内容更新的未保存草稿
 */
export async function checkPendingDraft(filePath: string | null): Promise<PendingDraftInfo | null> {
  const sessionData = await sessionStore.loadActiveSession();
  if (!sessionData || !sessionData.draftMarkdown) {
    return null;
  }

  const activeDoc = sessionData.session.activeDocument;
  if (!activeDoc) {
    return null;
  }

  // 必须匹配目标文档路径（针对新建未命名文档，filePath 均为 null）
  if (activeDoc.filePath !== filePath) {
    return null;
  }

  return {
    draftId: activeDoc.draftId,
    filePath: activeDoc.filePath,
    draftContent: sessionData.draftMarkdown,
    // 旧会话或未知情况没有该字段，保持 undefined 交由文档模型回退。
    cursorOffset: activeDoc.cursorOffset,
    lastModifiedAt: activeDoc.lastModifiedAt,
  };
}

/**
 * 恢复未保存草稿至当前活动文档模型。
 *
 * 返回 `cursorOffset` 表示应该写入的选区位置；`undefined` 表示草稿里没有可靠的光标记录
 * （旧会话或退出时编辑器未挂载），此时调用方应保留文档模型的默认光标，
 * 而不是把它强行放到末尾或开头。
 */
export function restorePendingDraft(info: PendingDraftInfo): {
  readonly cursorOffset: number | undefined;
} {
  const result = restoreDraftToDocument(runtime.document, info.draftContent, {
    cursorOffset: info.cursorOffset,
  });
  return { cursorOffset: info.cursorOffset === undefined ? undefined : result.cursorOffset };
}

/**
 * 丢弃草稿并清理会话缓存
 */
export async function discardPendingDraft(draftId: string): Promise<void> {
  await sessionStore.discardDraft(draftId);
}

/**
 * 记录文档历史快照（在保存成功或特定事件时调用）
 */
export async function recordDocumentHistory(
  filePath: string | null,
  markdown: string,
  trigger: HistorySnapshotTrigger = "manual-save",
): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await historyStore.recordSnapshot(filePath, markdown, trigger);
  } catch (error) {
    console.warn("[HistoryStore] 记录历史快照失败", error);
  }
}

/**
 * 将当前文档回滚到指定历史快照
 */
export async function revertToHistorySnapshot(
  filePath: string,
  snapshotId: string,
): Promise<boolean> {
  const content = await historyStore.loadSnapshotContent(filePath, snapshotId);
  if (content === null) {
    return false;
  }

  // 恢复前先给当前版本留存一份瞬时快照，防止误操作
  const current = runtime.document.getSnapshot();
  await historyStore.recordSnapshot(filePath, current.markdown, "pre-restore");

  revertDocumentToSnapshot(runtime.document, content);
  return true;
}
