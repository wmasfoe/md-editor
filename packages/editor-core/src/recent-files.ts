export interface RecentFile {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: number;
}

export interface RecentFilesStore {
  add(file: Omit<RecentFile, "lastOpenedAt">): void;
  remove(path: string): void;
  list(): readonly RecentFile[];
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

  function save(files: RecentFile[]): void {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(files));
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
