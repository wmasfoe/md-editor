export const LAST_OPENED_FILE_KEY = "inkpoint_last_opened_file_path";

/**
 * 记录最近打开的本地文件路径 (利用 utools.dbStorage / localStorage 持久化)
 */
export function saveLastOpenedFile(filePath: string): void {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.setItem(LAST_OPENED_FILE_KEY, filePath);
      return;
    } catch {
      // 降级
    }
  }
  try {
    localStorage.setItem(LAST_OPENED_FILE_KEY, filePath);
  } catch {
    // 忽略
  }
}

/**
 * 获取最近打开的本地文件路径
 */
export function loadLastOpenedFile(): string | null {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      const val = window.utools.dbStorage.getItem(LAST_OPENED_FILE_KEY);
      if (typeof val === "string" && val.trim().length > 0) {
        return val;
      }
    } catch {
      // 降级
    }
  }
  try {
    return localStorage.getItem(LAST_OPENED_FILE_KEY);
  } catch {
    return null;
  }
}

/**
 * 清除最近打开的文件记录
 */
export function clearLastOpenedFile(): void {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.removeItem(LAST_OPENED_FILE_KEY);
    } catch {
      // 降级
    }
  }
  try {
    localStorage.removeItem(LAST_OPENED_FILE_KEY);
  } catch {
    // 忽略
  }
}

export const LAST_WORKSPACE_KEY = "inkpoint_last_workspace_path";

/**
 * 记录最近打开的工作区路径 (利用 utools.dbStorage 持久化，支持跨次启动记忆)
 */
export function saveLastOpenedFolder(folderPath: string): void {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.setItem(LAST_WORKSPACE_KEY, folderPath);
      return;
    } catch {
      // 降级
    }
  }
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, folderPath);
  } catch {
    // 忽略
  }
}

/**
 * 获取最近打开的工作区路径
 */
export function loadLastOpenedFolder(): string | null {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      const val = window.utools.dbStorage.getItem(LAST_WORKSPACE_KEY);
      if (typeof val === "string" && val.trim().length > 0) {
        return val;
      }
    } catch {
      // 降级
    }
  }
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/**
 * 清除最近打开的工作区记录
 */
export function clearLastOpenedFolder(): void {
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.removeItem(LAST_WORKSPACE_KEY);
    } catch {
      // 降级
    }
  }
  try {
    localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    // 忽略
  }
}

export interface UtoolsSettings {
  theme: "system" | "light" | "dark";
  fontSize: number; // 13 ~ 22, default 15
  proseFontFamily: string; // font option id, default ""
  codeFontFamily: string; // font option id, default ""
}

export const DEFAULT_UTOOLS_SETTINGS: UtoolsSettings = {
  theme: "system",
  fontSize: 15,
  proseFontFamily: "",
  codeFontFamily: "",
};

export const UTOOLS_SETTINGS_KEY = "inkpoint_utools_settings";

/**
 * 加载用户偏好设置（主题、字号、字体族栈）
 */
export function loadUtoolsSettings(): UtoolsSettings {
  let raw: string | null = null;
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      raw = window.utools.dbStorage.getItem(UTOOLS_SETTINGS_KEY);
    } catch {
      // 降级
    }
  }
  if (!raw && typeof window !== "undefined") {
    try {
      raw = localStorage.getItem(UTOOLS_SETTINGS_KEY);
    } catch {
      // 降级
    }
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        theme: parsed.theme === "dark" || parsed.theme === "light" ? parsed.theme : "system",
        fontSize:
          typeof parsed.fontSize === "number" && parsed.fontSize >= 13 && parsed.fontSize <= 22
            ? parsed.fontSize
            : 15,
        proseFontFamily: typeof parsed.proseFontFamily === "string" ? parsed.proseFontFamily : "",
        codeFontFamily: typeof parsed.codeFontFamily === "string" ? parsed.codeFontFamily : "",
      };
    } catch {
      // JSON 解析失败则回退默认
    }
  }
  return { ...DEFAULT_UTOOLS_SETTINGS };
}

/**
 * 保存用户偏好设置
 */
export function saveUtoolsSettings(settings: UtoolsSettings): void {
  const serialized = JSON.stringify(settings);
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.setItem(UTOOLS_SETTINGS_KEY, serialized);
    } catch {
      // 降级
    }
  }
  try {
    localStorage.setItem(UTOOLS_SETTINGS_KEY, serialized);
  } catch {
    // 忽略
  }
}
