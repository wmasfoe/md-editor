import type { RecentFile, RecentFilesStore } from "@md-editor/editor-core";

interface RecentFileEventStore {
  listAuthoritative(): Promise<readonly RecentFile[]>;
  clear(): Promise<void>;
}

interface RecentFileMenuEventOptions {
  readonly target?: EventTarget;
  readonly store: RecentFileEventStore | Pick<RecentFilesStore, "listAuthoritative" | "clear">;
  readonly openRecentFile: (path: string) => Promise<void>;
  readonly onError?: (message: string) => void;
}

export function bindRecentFileMenuEvents({
  target = window,
  store,
  openRecentFile,
  onError
}: RecentFileMenuEventOptions) {
  const reportError = (error: unknown) => {
    onError?.(error instanceof Error ? error.message : "最近文件操作失败。");
  };
  const handleOpen = (event: Event) => {
    const index = (event as CustomEvent<{ index: number }>).detail.index;
    void store
      .listAuthoritative()
      .then((files) => files[index])
      .then((file) => (file ? openRecentFile(file.path) : undefined))
      .catch(reportError);
  };
  const handleClear = () => {
    void store.clear().catch(reportError);
  };

  target.addEventListener("open-recent-file-by-index", handleOpen);
  target.addEventListener("clear-recent-files", handleClear);
  return () => {
    target.removeEventListener("open-recent-file-by-index", handleOpen);
    target.removeEventListener("clear-recent-files", handleClear);
  };
}
