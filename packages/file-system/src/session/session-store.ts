/**
 * @fileoverview 会话与未保存草稿管理存储引擎 (SessionStore)
 */

import type { PersistedSession, SessionDocumentEntry, SessionStorageAdapter } from "./types.ts";

export * from "./types.ts";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天默认过期

/**
 * 为文档路径或新建未命名文档生成稳定的草稿 ID
 */
export function generateDraftId(filePath: string | null): string {
  if (!filePath) {
    return `untitled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  // 使用安全无害的 slug 字符串作为文件名标识
  const normalized = filePath.replace(/\\/g, "/");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  const base =
    normalized
      .split("/")
      .pop()
      ?.replace(/[^a-zA-Z0-9_-]/gu, "_") ?? "doc";
  return `${base}-${hash.toString(16)}`;
}

export interface SessionStore {
  saveActiveSession(params: {
    doc: SessionDocumentEntry;
    draftMarkdown: string;
    openDocuments?: readonly SessionDocumentEntry[];
  }): Promise<void>;
  loadActiveSession(): Promise<{
    session: PersistedSession;
    draftMarkdown: string | null;
  } | null>;
  clearActiveSession(): Promise<void>;
  loadDraft(draftId: string): Promise<string | null>;
  discardDraft(draftId: string): Promise<void>;
  purgeExpiredDrafts(ttlMs?: number): Promise<number>;
}

export function createSessionStore(adapter: SessionStorageAdapter): SessionStore {
  return {
    async saveActiveSession({ doc, draftMarkdown, openDocuments = [doc] }) {
      // 1. 先原子保存草稿内容
      await adapter.saveDraft(doc.draftId, draftMarkdown);

      // 2. 再保存会话元数据索引
      const session: PersistedSession = {
        version: 1,
        activeDocument: doc,
        openDocuments,
        updatedAt: Date.now(),
      };
      await adapter.saveSession(session);
    },

    async loadActiveSession() {
      const session = await adapter.loadSession();
      if (!session || !session.activeDocument) {
        return null;
      }
      const draftMarkdown = await adapter.loadDraft(session.activeDocument.draftId);
      return {
        session,
        draftMarkdown,
      };
    },

    async clearActiveSession() {
      await adapter.clearSession();
    },

    async loadDraft(draftId: string) {
      return adapter.loadDraft(draftId);
    },

    async discardDraft(draftId: string) {
      await adapter.deleteDraft(draftId);
      const session = await adapter.loadSession();
      if (session && session.activeDocument?.draftId === draftId) {
        await adapter.clearSession();
      }
    },

    async purgeExpiredDrafts(ttlMs = DEFAULT_TTL_MS) {
      const drafts = await adapter.listDrafts();
      const session = await adapter.loadSession();
      const activeDraftId = session?.activeDocument?.draftId;
      const now = Date.now();
      let purgedCount = 0;

      for (const draftId of drafts) {
        // 当前活动草稿不清理
        if (draftId === activeDraftId) {
          continue;
        }
        // 如果草稿元数据超时或者会话不存在且草稿超期
        if (session && now - session.updatedAt > ttlMs) {
          await adapter.deleteDraft(draftId);
          purgedCount += 1;
        }
      }

      return purgedCount;
    },
  };
}

/**
 * 内存会话存储适配器（专供单元测试与纯无头环境使用）
 */
export function createMemorySessionStorageAdapter(): SessionStorageAdapter {
  let sessionState: PersistedSession | null = null;
  const draftMap = new Map<string, string>();

  return {
    async loadSession() {
      return sessionState;
    },
    async saveSession(session) {
      sessionState = Object.freeze({ ...session });
    },
    async clearSession() {
      sessionState = null;
    },
    async loadDraft(draftId) {
      return draftMap.get(draftId) ?? null;
    },
    async saveDraft(draftId, content) {
      draftMap.set(draftId, content);
    },
    async deleteDraft(draftId) {
      draftMap.delete(draftId);
    },
    async listDrafts() {
      return Array.from(draftMap.keys());
    },
  };
}
