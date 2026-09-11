/**
 * @fileoverview 应用在线更新设置与状态类型定义
 */

/**
 * 在线更新检查与下载状态模型
 */
export interface UpdateStatus {
  /** 当前运行客户端版本号 */
  readonly currentVersion: string;
  /** 更新状态生命周期机 */
  readonly state:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "installed"
    | "unconfigured"
    | "error";
  readonly message?: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly downloadUrl?: string;
  readonly installKind?: "app" | "manual";
  readonly installCommand?: string;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
  readonly error?: string;
}

/**
 * 更新自动化偏好设置
 */
export interface AppUpdateSettings {
  /** 是否自动检查新版本 */
  readonly automaticCheck: boolean;
  /** 是否在后台自动下载可用更新 */
  readonly automaticDownload: boolean;
}
