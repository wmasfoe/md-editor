// apps/utools/src/utools/db-storage.ts
// uTools 便签数据存储模块
// 采用 utools.db (CouchDB / PouchDB 架构)，支持在 uTools 登录用户设备间无缝云漫游

export const SCRATCHPAD_DOC_ID = "inkpoint_quick_scratchpad";

export interface ScratchpadDoc {
  _id: string;
  _rev?: string;
  title: string;
  markdown: string;
  updatedAt: number;
}

const DEFAULT_SCRATCHPAD_MARKDOWN = `# Inkpoint Markdown 编辑器

欢迎使用 Inkpoint。支持所见即所得排版、本地文件秒开与全局选词编辑。
当前草稿自动保存，并通过 uTools 账号在多设备间同步。

> [!TIP]
> 点击顶部「前往官网」可获取 Inkpoint 原生桌面版，体验独家本地专属小模型与完整多窗口工作区。
`;

/**
 * 保存草稿内容到 utools.db
 */
export function saveScratchpadToDb(markdown: string): void {
  if (typeof window === "undefined" || typeof window.utools === "undefined") {
    // 降级使用 localStorage
    try {
      localStorage.setItem(SCRATCHPAD_DOC_ID, markdown);
    } catch {
      // 忽略存储异常
    }
    return;
  }

  const existing = window.utools.db.get<ScratchpadDoc>(SCRATCHPAD_DOC_ID);
  const doc: ScratchpadDoc = {
    _id: SCRATCHPAD_DOC_ID,
    _rev: existing?._rev,
    title: "草稿文档",
    markdown,
    updatedAt: Date.now(),
  };

  window.utools.db.put(doc);
}

/**
 * 从 utools.db 加载便签内容
 */
export function loadScratchpadFromDb(): string {
  if (typeof window === "undefined" || typeof window.utools === "undefined") {
    try {
      return localStorage.getItem(SCRATCHPAD_DOC_ID) ?? DEFAULT_SCRATCHPAD_MARKDOWN;
    } catch {
      return DEFAULT_SCRATCHPAD_MARKDOWN;
    }
  }

  const doc = window.utools.db.get<ScratchpadDoc>(SCRATCHPAD_DOC_ID);
  return doc?.markdown ?? DEFAULT_SCRATCHPAD_MARKDOWN;
}
