export interface InMemorySaveJob {
  readonly path: string;
  readonly markdownLf: string;
}

export interface InMemoryDocumentRuntime {
  readonly open: (path: string) => string | null;
  readonly save: (job: InMemorySaveJob) => { readonly filePath: string };
  readonly readPersistedBytes: (path: string) => Uint8Array | null;
  readonly saveLog: readonly InMemorySaveJob[];
}

export function createInMemoryDocumentRuntime(
  initialFiles: Readonly<Record<string, string>> = {},
): InMemoryDocumentRuntime {
  const files = new Map(Object.entries(initialFiles));
  const saveLog: InMemorySaveJob[] = [];

  return {
    open(path) {
      return files.get(path) ?? null;
    },
    save(job) {
      if (job.markdownLf.includes("\r")) {
        throw new Error("In-memory S1 save fixture accepts canonical LF Markdown only.");
      }
      const recorded = Object.freeze({ ...job });
      files.set(job.path, job.markdownLf);
      saveLog.push(recorded);
      return { filePath: job.path };
    },
    readPersistedBytes(path) {
      const markdown = files.get(path);
      return markdown === undefined ? null : new TextEncoder().encode(markdown);
    },
    get saveLog() {
      return Object.freeze([...saveLog]);
    },
  };
}
