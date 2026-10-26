/**
 * @file session-adapter.ts
 * @module apps/desktop/desktop/session-adapter
 * @description
 * Tauri 桌面端会话与文档历史存储适配器。
 * 将前端 SessionStore 与 HistoryStore 契约映射为底层的 Tauri IPC 命令调用。
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createMemoryHistoryStorageAdapter,
  createMemorySessionStorageAdapter,
  type DocumentHistoryIndex,
  type HistoryStorageAdapter,
  type PersistedSession,
  type SessionStorageAdapter,
} from "@md-editor/file-system";

function hashDocumentPath(documentPath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < documentPath.length; i++) {
    hash ^= documentPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `doc-${(hash >>> 0).toString(16)}`;
}

/**
 * 创建用于 Tauri 桌面端的会话存储适配器
 */
export function createDesktopSessionStorageAdapter(): SessionStorageAdapter {
  if (!isTauri() || typeof invoke !== "function") {
    return createMemorySessionStorageAdapter();
  }

  return {
    async loadSession() {
      const json = await invoke<string | null>("load_persisted_session");
      if (!json) return null;
      try {
        return JSON.parse(json) as PersistedSession;
      } catch {
        return null;
      }
    },
    async saveSession(session) {
      await invoke("save_persisted_session", {
        sessionJson: JSON.stringify(session),
      });
    },
    async clearSession() {
      await invoke("clear_persisted_session");
    },
    async loadDraft(draftId) {
      return invoke<string | null>("load_draft_file", { draftId });
    },
    async saveDraft(draftId, content) {
      await invoke("save_draft_file", { draftId, content });
    },
    async deleteDraft(draftId) {
      await invoke("delete_draft_file", { draftId });
    },
    async listDrafts() {
      return invoke<string[]>("list_draft_files");
    },
  };
}

/**
 * 创建用于 Tauri 桌面端的历史版本存储适配器
 */
export function createDesktopHistoryStorageAdapter(): HistoryStorageAdapter {
  if (!isTauri() || typeof invoke !== "function") {
    return createMemoryHistoryStorageAdapter();
  }

  return {
    async loadIndex(documentPath) {
      const docHash = hashDocumentPath(documentPath);
      const json = await invoke<string | null>("load_history_index", { docHash });
      if (!json) return null;
      try {
        return JSON.parse(json) as DocumentHistoryIndex;
      } catch {
        return null;
      }
    },
    async saveIndex(index) {
      const docHash = hashDocumentPath(index.documentPath);
      await invoke("save_history_index", {
        docHash,
        indexJson: JSON.stringify(index),
      });
    },
    async loadSnapshot(documentPath, snapshotId) {
      const docHash = hashDocumentPath(documentPath);
      return invoke<string | null>("load_history_snapshot", { docHash, snapshotId });
    },
    async saveSnapshot(documentPath, snapshotId, content) {
      const docHash = hashDocumentPath(documentPath);
      await invoke("save_history_snapshot", { docHash, snapshotId, content });
    },
    async deleteSnapshot(documentPath, snapshotId) {
      const docHash = hashDocumentPath(documentPath);
      await invoke("delete_history_snapshot", { docHash, snapshotId });
    },
    async clearHistory(documentPath) {
      const docHash = hashDocumentPath(documentPath);
      await invoke("save_history_index", {
        docHash,
        indexJson: JSON.stringify({ documentPath, entries: [] }),
      });
    },
  };
}
