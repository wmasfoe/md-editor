/**
 * @fileoverview 会话与未保存草稿元数据与存储契约
 */

export interface SessionDocumentEntry {
  /** 文档绝对路径，未命名新建文档为 null */
  readonly filePath: string | null;
  /** 是否为未命名文档 */
  readonly isUntitled: boolean;
  /** 草稿唯一标识符 */
  readonly draftId: string;
  /** 光标偏移量 */
  readonly cursorOffset: number;
  /** 滚动位置（垂直像素或行号） */
  readonly scrollOffset?: number;
  /** 编辑器视图模式 */
  readonly mode?: "wysiwyg" | "source";
  /** 最后修改时间戳（毫秒） */
  readonly lastModifiedAt: number;
}

export interface PersistedSession {
  readonly version: 1;
  /** 当前主活动文档 */
  readonly activeDocument: SessionDocumentEntry | null;
  /** 已打开文档列表（为后续多标签/最近会话预留） */
  readonly openDocuments: readonly SessionDocumentEntry[];
  /** 会话最后记录时间戳（毫秒） */
  readonly updatedAt: number;
}

export interface SessionStorageAdapter {
  loadSession(): Promise<PersistedSession | null>;
  saveSession(session: PersistedSession): Promise<void>;
  clearSession(): Promise<void>;
  loadDraft(draftId: string): Promise<string | null>;
  saveDraft(draftId: string, content: string): Promise<void>;
  deleteDraft(draftId: string): Promise<void>;
  listDrafts(): Promise<readonly string[]>;
}
