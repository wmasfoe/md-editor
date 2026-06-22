export interface RecentFile {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: number;
}

export interface RecentFilesStore {
  add(file: Omit<RecentFile, "lastOpenedAt">): Promise<void>;
  remove(path: string): Promise<void>;
  move(previousPath: string, file: Omit<RecentFile, "lastOpenedAt">): Promise<void>;
  list(): readonly RecentFile[];
  /**
   * Resolve the authoritative recent-files list. In Tauri this reads the same
   * `recent-files.json` the native menu is built from, so menu indices always
   * map to the correct path. Falls back to localStorage off-Tauri.
   */
  listAuthoritative(): Promise<readonly RecentFile[]>;
  clear(): Promise<void>;
}

export interface RecentFilesBackend {
  load(): Promise<readonly RecentFile[]>;
  save(files: readonly RecentFile[]): Promise<void>;
  updateMenu(): Promise<void>;
}

const MAX_RECENT_FILES = 10;

export function createRecentFilesStore(
  storage: Storage = typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  backend: RecentFilesBackend | null = createTauriRecentFilesBackend()
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

  async function save(files: readonly RecentFile[]): Promise<void> {
    if (files.length === 0) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(files));
    }

    if (backend) {
      await backend.save(files);
      await backend.updateMenu();
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

      return save(files);
    },

    remove(path) {
      const files = load().filter((f) => f.path !== path);
      return save(files);
    },

    move(previousPath, file) {
      const files = load();
      const movedFiles = files.map((current) => {
        if (!isSameOrChildPath(current.path, previousPath)) {
          return current;
        }

        const nextPath =
          current.path === previousPath
            ? file.path
            : `${file.path}${current.path.slice(previousPath.length)}`;

        return {
          ...current,
          path: nextPath,
          name: current.path === previousPath ? file.name : basename(nextPath)
        };
      });

      if (movedFiles.every((current, index) => current.path === files[index]?.path)) {
        return Promise.resolve();
      }

      const deduplicatedFiles: RecentFile[] = [];
      const seenPaths = new Set<string>();
      for (const current of movedFiles) {
        if (seenPaths.has(current.path)) {
          continue;
        }
        seenPaths.add(current.path);
        deduplicatedFiles.push(current);
      }

      return save(deduplicatedFiles);
    },

    list() {
      return load();
    },

    async listAuthoritative() {
      if (backend) {
        return backend.load();
      }
      return load();
    },

    clear() {
      return save([]);
    }
  };
}

function isSameOrChildPath(path: string, parentPath: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedParent = parentPath.replace(/\\/g, "/").replace(/\/+$/u, "");
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function createTauriRecentFilesBackend(): RecentFilesBackend | null {
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
