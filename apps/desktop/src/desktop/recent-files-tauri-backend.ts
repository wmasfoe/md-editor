import type { RecentFile, RecentFilesBackend } from "@md-editor/editor-core";

export function createTauriRecentFilesBackend(): RecentFilesBackend | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }

  return {
    async load() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<RecentFile[]>("load_recent_files");
    },
    async save(files) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_recent_files", { recentFiles: files });
    },
    async updateMenu() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_recent_files_menu");
    }
  };
}
