import {
  createEditorContent,
  markSaved,
  updateRawMarkdown,
  type EditorContent,
} from "./content.ts";

export interface MarkdownFileStore {
  read(path: string): Promise<string>;
  write(path: string, rawMarkdown: string): Promise<void>;
}

export interface EditorFileSession {
  readonly path: string;
  readonly content: EditorContent;
}

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

export function updateFileSessionRawMarkdown(
  session: EditorFileSession,
  rawMarkdown: string,
): EditorFileSession {
  return {
    ...session,
    content: updateRawMarkdown(session.content, rawMarkdown),
  };
}

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

export async function reloadMarkdownFile(
  store: MarkdownFileStore,
  session: EditorFileSession,
): Promise<EditorFileSession> {
  return loadMarkdownFile(store, session.path);
}
