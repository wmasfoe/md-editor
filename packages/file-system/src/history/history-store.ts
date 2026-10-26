/**
 * @fileoverview 文档历史版本快照引擎 (HistoryStore)
 */

import type {
  DocumentHistoryEntry,
  DocumentHistoryIndex,
  HistorySnapshotTrigger,
  HistoryStorageAdapter,
} from "./types.ts";

export * from "./types.ts";

export const DEFAULT_MAX_HISTORY_ENTRIES = 100;

/**
 * 计算纯文本内容的快速非加密指纹散列（32 位无符号十六进制）
 */
export function calculateContentHash(content: string): string {
  let h1 = 0xdeadbeef ^ content.length;
  let h2 = 0x41c6ce57 ^ content.length;

  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hashNum = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hashNum.toString(16).padStart(12, "0");
}

export interface HistoryStoreOptions {
  /** 单个文档最多保留快照数，默认 100 条 */
  readonly maxEntries?: number;
}

export interface HistoryStore {
  recordSnapshot(
    documentPath: string,
    markdown: string,
    trigger: HistorySnapshotTrigger,
  ): Promise<DocumentHistoryEntry | null>;
  listSnapshots(documentPath: string): Promise<readonly DocumentHistoryEntry[]>;
  loadSnapshotContent(documentPath: string, snapshotId: string): Promise<string | null>;
  deleteSnapshot(documentPath: string, snapshotId: string): Promise<void>;
  clearHistory(documentPath: string): Promise<void>;
}

export function createHistoryStore(
  adapter: HistoryStorageAdapter,
  options: HistoryStoreOptions = {},
): HistoryStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;

  return {
    async recordSnapshot(documentPath, markdown, trigger) {
      const existingIndex = (await adapter.loadIndex(documentPath)) ?? {
        documentPath,
        entries: [],
      };

      const hash = calculateContentHash(markdown);
      const latest = existingIndex.entries[existingIndex.entries.length - 1];

      // 去重：若与上一次快照内容哈希一致，则不重复记录
      if (latest && latest.contentSha256 === hash) {
        return null;
      }

      const now = Date.now();
      const snapshotId = `snap-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const lineCount = markdown.length === 0 ? 0 : markdown.split("\n").length;

      const newEntry: DocumentHistoryEntry = {
        id: snapshotId,
        timestamp: now,
        charCount: markdown.length,
        lineCount,
        contentSha256: hash,
        trigger,
      };

      // 1. 保存快照文件内容
      await adapter.saveSnapshot(documentPath, snapshotId, markdown);

      // 2. 超额按策略淘汰最老快照（保留每天第一版）
      let updatedEntries = [...existingIndex.entries, newEntry];
      if (updatedEntries.length > maxEntries) {
        updatedEntries = pruneOldestEntries(updatedEntries, maxEntries, async (prunedId) => {
          await adapter.deleteSnapshot(documentPath, prunedId);
        });
      }

      // 3. 更新索引文件
      const nextIndex: DocumentHistoryIndex = {
        documentPath,
        entries: updatedEntries,
      };
      await adapter.saveIndex(nextIndex);

      return newEntry;
    },

    async listSnapshots(documentPath) {
      const index = await adapter.loadIndex(documentPath);
      return index?.entries ?? [];
    },

    async loadSnapshotContent(documentPath, snapshotId) {
      return adapter.loadSnapshot(documentPath, snapshotId);
    },

    async deleteSnapshot(documentPath, snapshotId) {
      const index = await adapter.loadIndex(documentPath);
      if (!index) return;

      await adapter.deleteSnapshot(documentPath, snapshotId);
      const nextIndex: DocumentHistoryIndex = {
        documentPath,
        entries: index.entries.filter((entry) => entry.id !== snapshotId),
      };
      await adapter.saveIndex(nextIndex);
    },

    async clearHistory(documentPath) {
      await adapter.clearHistory(documentPath);
    },
  };
}

/**
 * 历史版本超限修剪算法：
 * 当超过上限时，从最老的条目开始剔除；若某条目是当天唯一的快照，则尽量予以保留以防按天断代。
 */
function pruneOldestEntries(
  entries: readonly DocumentHistoryEntry[],
  targetMax: number,
  onPrune: (id: string) => void | Promise<void>,
): DocumentHistoryEntry[] {
  if (entries.length <= targetMax) {
    return [...entries];
  }

  const excess = entries.length - targetMax;
  const prunedSet = new Set<string>();

  // 记录每一天（年月日）的第一条快照 ID（保护日快照）
  const dailyFirstSnapshotIds = new Set<string>();
  for (const entry of entries) {
    const dayKey = new Date(entry.timestamp).toISOString().slice(0, 10);
    if (!Array.from(dailyFirstSnapshotIds).some((id) => id.startsWith(dayKey))) {
      dailyFirstSnapshotIds.add(`${dayKey}-${entry.id}`);
    }
  }

  // 第一轮：淘汰非日首版本的旧快照
  let prunedCount = 0;
  for (let i = 0; i < entries.length && prunedCount < excess; i++) {
    const entry = entries[i];
    const dayKey = `${new Date(entry.timestamp).toISOString().slice(0, 10)}-${entry.id}`;
    if (!dailyFirstSnapshotIds.has(dayKey)) {
      prunedSet.add(entry.id);
      void onPrune(entry.id);
      prunedCount += 1;
    }
  }

  // 第二轮：若仍超限，纯按 FIFO 顺序淘汰最老条目
  for (let i = 0; i < entries.length && prunedCount < excess; i++) {
    const entry = entries[i];
    if (!prunedSet.has(entry.id)) {
      prunedSet.add(entry.id);
      void onPrune(entry.id);
      prunedCount += 1;
    }
  }

  return entries.filter((entry) => !prunedSet.has(entry.id));
}

function makeMemorySnapshotKey(docPath: string, snapshotId: string): string {
  return `${docPath}::${snapshotId}`;
}

/**
 * 内存历史版本存储适配器（专供单元测试与纯无头环境使用）
 */
export function createMemoryHistoryStorageAdapter(): HistoryStorageAdapter {
  const indexMap = new Map<string, DocumentHistoryIndex>();
  const snapshotMap = new Map<string, string>();

  return {
    async loadIndex(documentPath) {
      const idx = indexMap.get(documentPath);
      return idx ? { ...idx } : null;
    },
    async saveIndex(index) {
      indexMap.set(index.documentPath, Object.freeze({ ...index }));
    },
    async loadSnapshot(documentPath, snapshotId) {
      return snapshotMap.get(makeMemorySnapshotKey(documentPath, snapshotId)) ?? null;
    },
    async saveSnapshot(documentPath, snapshotId, content) {
      snapshotMap.set(makeMemorySnapshotKey(documentPath, snapshotId), content);
    },
    async deleteSnapshot(documentPath, snapshotId) {
      snapshotMap.delete(makeMemorySnapshotKey(documentPath, snapshotId));
    },
    async clearHistory(documentPath) {
      indexMap.delete(documentPath);
      for (const key of snapshotMap.keys()) {
        if (key.startsWith(`${documentPath}::`)) {
          snapshotMap.delete(key);
        }
      }
    },
  };
}
