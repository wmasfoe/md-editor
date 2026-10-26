/**
 * @fileoverview 文档历史版本快照元数据与存储契约
 */

export type HistorySnapshotTrigger = "manual-save" | "auto-idle" | "pre-restore";

export interface DocumentHistoryEntry {
  /** 快照唯一标识符 */
  readonly id: string;
  /** 快照创建时间戳（毫秒） */
  readonly timestamp: number;
  /** 总字符数 */
  readonly charCount: number;
  /** 总行数 */
  readonly lineCount: number;
  /** 内容散列值（用于快速去重） */
  readonly contentSha256: string;
  /** 触发源类型 */
  readonly trigger: HistorySnapshotTrigger;
}

export interface DocumentHistoryIndex {
  readonly documentPath: string;
  readonly entries: readonly DocumentHistoryEntry[];
}

export interface HistoryStorageAdapter {
  loadIndex(documentPath: string): Promise<DocumentHistoryIndex | null>;
  saveIndex(index: DocumentHistoryIndex): Promise<void>;
  loadSnapshot(documentPath: string, snapshotId: string): Promise<string | null>;
  saveSnapshot(documentPath: string, snapshotId: string, content: string): Promise<void>;
  deleteSnapshot(documentPath: string, snapshotId: string): Promise<void>;
  clearHistory(documentPath: string): Promise<void>;
}
