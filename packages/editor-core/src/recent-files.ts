export interface RecentFile {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: number;
}

export interface RecentFilesStore {
  add(file: Omit<RecentFile, "lastOpenedAt">): void;
  remove(path: string): void;
  list(): readonly RecentFile[];
  /**
   * Resolve the authoritative recent-files list. In Tauri this reads the same
   * `recent-files.json` the native menu is built from, so menu indices always
   * map to the correct path. Falls back to localStorage off-Tauri.
   */
  listAuthoritative(): Promise<readonly RecentFile[]>;
  clear(): void;
}

const MAX_RECENT_FILES = 10;

export function createRecentFilesStore(
  storage: Storage = typeof window !== "undefined" ? window.localStorage : createMemoryStorage()
): RecentFilesStore {
  const STORAGE_KEY = "md-editor-recent-files";

  function load(): RecentFile[] {
    try {
      const json = storage.getItem(STORAGE_KEY);
      if (!json) return [];
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function save(files: RecentFile[]): Promise<void> {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(files));

      // Also save to Tauri backend for menu persistence
      // Check if we're in Tauri environment by looking for the Tauri context
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          // Dynamic import to avoid bundler issues in non-Tauri environments
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("save_recent_files", { recentFiles: files });
          console.log('[RecentFiles] Saved to Tauri backend successfully');

          // Update the menu to reflect the new recent files
          await invoke("update_recent_files_menu");
          console.log('[RecentFiles] Menu updated successfully');
        } catch (error) {
          console.error("Failed to save recent files to Tauri backend:", error);
        }
      }
    } catch (error) {
      console.error("Failed to save recent files:", error);
    }
  }

  return {
    add(file) {
      const files = load();
      const existingIndex = files.findIndex((f) => f.path === file.path);

      const newFile: RecentFile = {
        ...file,
        lastOpenedAt: Date.now()
      };

      if (existingIndex >= 0) {
        files.splice(existingIndex, 1);
      }

      files.unshift(newFile);

      if (files.length > MAX_RECENT_FILES) {
        files.splice(MAX_RECENT_FILES);
      }

      save(files);
    },

    remove(path) {
      const files = load().filter((f) => f.path !== path);
      save(files);
    },

    list() {
      return load();
    },

    async listAuthoritative() {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // The native menu is rebuilt from this same source on every change,
          // so the index carried by a menu click always lines up here.
          return await invoke<RecentFile[]>("load_recent_files");
        } catch (error) {
          console.error("Failed to load recent files from Tauri backend:", error);
        }
      }
      return load();
    },

    clear() {
      storage.removeItem(STORAGE_KEY);
    }
  };
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    }
  };
}
