/**
 * @fileoverview 文件存储生命周期适配器与会话管理 (File Lifecycle)
 *
 * 提供只读/可写文件存储接口 (MarkdownFileStore)，
 * 管理 EditorFileSession 会话状态与内存缓存测试存储。
 */

import {
  createEditorContent,
  markSaved,
  updateRawMarkdown,
  type EditorContent,
} from "./content.ts";

/**
 * 底层文件存储读写接口契约
 */
export interface MarkdownFileStore {
  /** 读取指定路径的 Markdown 文本内容 */
  read(path: string): Promise<string>;
  /** 将文本内容写入指定物理路径 */
  write(path: string, rawMarkdown: string): Promise<void>;
}

/**
 * 编辑器激活的文件会话
 */
export interface EditorFileSession {
  /** 关联的物理文件绝对路径 */
  readonly path: string;
  /** 关联的结构化编辑器内容 */
  readonly content: EditorContent;
}

/**
 * 创建用于单元测试或纯内存环境的 MarkdownFileStore
 *
 * @param initialFiles 初始内存文件映射表
 */
export function createInMemoryMarkdownFileStore(
  initialFiles: Readonly<Record<string, string>> = {},
): MarkdownFileStore {
  const files = new Map(Object.entries(initialFiles));

  return {
    async read(path) {
      const rawMarkdown = files.get(path);

      if (rawMarkdown === undefined) {
        throw new Error(`Markdown file not found: ${path}`);
      }

      return rawMarkdown;
    },
    async write(path, rawMarkdown) {
      files.set(path, rawMarkdown);
    },
  };
}

/**
 * 从存储中异步加载文件并创建会话
 */
export async function loadMarkdownFile(
  store: MarkdownFileStore,
  path: string,
): Promise<EditorFileSession> {
  const rawMarkdown = await store.read(path);

  return {
    path,
    content: createEditorContent({ rawMarkdown }),
  };
}

/**
 * 更新文件会话内的当前 Markdown 文本并重算脏标记
 */
export function updateFileSessionRawMarkdown(
  session: EditorFileSession,
  rawMarkdown: string,
): EditorFileSession {
  return {
    ...session,
    content: updateRawMarkdown(session.content, rawMarkdown),
  };
}

/**
 * 将文件会话内容保存持久化至存储介质
 */
export async function persistMarkdownFile(
  store: MarkdownFileStore,
  session: EditorFileSession,
): Promise<EditorFileSession> {
  await store.write(session.path, session.content.rawMarkdown);

  return {
    ...session,
    content: markSaved(session.content),
  };
}

/**
 * 从存储介质重新载入最新文件内容
 */
export async function reloadMarkdownFile(
  store: MarkdownFileStore,
  session: EditorFileSession,
): Promise<EditorFileSession> {
  return loadMarkdownFile(store, session.path);
}
