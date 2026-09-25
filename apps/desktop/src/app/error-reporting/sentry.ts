/**
 * @fileoverview Sentry 错误上报初始化模块
 *
 * 根据用户在设置中启用的错误上报开关，延迟初始化 Sentry SDK。
 * 仅收集生产环境下的 JS 异常与未处理 Promise rejection，不采集用户文档内容或个人数据。
 * 设备信息（OS、版本、架构）由 Sentry 自动采集。
 *
 * 开发环境（包括 dev、test、e2e）严格不上报任何异常与告警，避免无谓消耗配额与干扰开发调试。
 */

import { isTauri } from "@tauri-apps/api/core";
import type { ErrorReportingSettings } from "../settings/error-reporting/types.ts";

declare const __APP_VERSION__: string;

/** Sentry DSN — 替换为实际项目的 DSN */
const SENTRY_DSN =
  "https://1376e8b5c3e71f8643ab61077a5eb48b@o4505284194074624.ingest.us.sentry.io/4512117887008768";

let isInitialized = false;
let initPromise: Promise<void> | null = null;
let isErrorReportingEnabled = true;

/**
 * 判断当前是否处于开发或测试环境。
 * 开发环境（包括 dev、test、e2e）默认不上报任何异常与告警，
 * 避免消耗 Sentry 额度、污染线上告警池，以及开发态加载无用 SDK 影响性能与控制台堆栈。
 * 可通过 VITE_ENABLE_SENTRY="true" 环境变量显式开启用于调试。
 */
export function isDevelopmentEnvironment(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    if (import.meta.env.VITE_ENABLE_SENTRY === "true") {
      return false;
    }
    if (import.meta.env.DEV) {
      return true;
    }
    if (
      import.meta.env.MODE === "development" ||
      import.meta.env.MODE === "test" ||
      import.meta.env.MODE === "e2e"
    ) {
      return true;
    }
    if (import.meta.env.PROD || import.meta.env.MODE === "production") {
      return false;
    }
  }

  if (typeof process !== "undefined" && process.env) {
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return true;
    }
  }

  return false;
}

/**
 * 过滤 breadcrumbs，剔除可能包含用户输入或文档内容的 console.log / console.info / console.debug 日志，
 * 仅保留系统级 error 与 warn 级别日志，严格保护用户文档隐私。
 */
export function sanitizeBreadcrumbs<T extends { category?: string; level?: string }>(
  breadcrumbs: T[],
): T[] {
  return breadcrumbs.filter(
    (bc) => bc.category !== "console" || bc.level === "error" || bc.level === "warn",
  );
}

/**
 * Sentry beforeSend 钩子处理函数。
 * 1. 若处于开发环境，或者用户未开启错误上报，直接返回 null 丢弃事件；
 * 2. 移除包含敏感文本信息的 console breadcrumbs。
 */
export function handleBeforeSend<
  T extends { breadcrumbs?: Array<{ category?: string; level?: string }> },
>(event: T, options: { isDev?: boolean; isEnabled?: boolean } = {}): T | null {
  const isDev = options.isDev ?? isDevelopmentEnvironment();
  const isEnabled = options.isEnabled ?? isErrorReportingEnabled;

  if (isDev || !isEnabled) {
    return null;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs);
  }

  return event;
}

/**
 * 当前是否已初始化 Sentry
 */
export function isSentryInitialized(): boolean {
  return isInitialized;
}

/**
 * 当前是否允许错误上报（用户偏好）
 */
export function isSentryReportingEnabled(): boolean {
  return isErrorReportingEnabled;
}

/**
 * 测试重置函数，仅在测试套件中使用
 */
export function _resetSentryStateForTesting(): void {
  isInitialized = false;
  initPromise = null;
  isErrorReportingEnabled = true;
}

/**
 * 根据用户设置与运行环境启用或禁用 Sentry 错误上报。
 * 应在应用启动和设置变更时调用。
 */
export function syncSentryWithSettings(settings: ErrorReportingSettings): void {
  isErrorReportingEnabled = settings.enabled;

  // 开发、测试与端到端环境下完全不上报任何异常告警，无需延迟加载与初始化 Sentry SDK
  if (isDevelopmentEnvironment()) {
    return;
  }

  if (settings.enabled) {
    void ensureSentryInitialized();
  }
}

export async function ensureSentryInitialized(): Promise<void> {
  // 开发环境下直接跳过，避免加载 SDK
  if (isDevelopmentEnvironment()) {
    return;
  }

  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const Sentry = await import("@sentry/react");

      const isDev = isDevelopmentEnvironment();
      const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

      Sentry.init({
        dsn: SENTRY_DSN,
        release: `inkpoint@${version}`,
        environment: isDev ? "development" : isTauri() ? "desktop" : "web",
        // 开发环境强制禁用 SDK 发送能力，生产环境遵循用户设置
        enabled: !isDev && isErrorReportingEnabled,
        // 采样率：100% 捕获（免费额度 5K/月，小团队足够）
        tracesSampleRate: 0,
        // 不采集 PII（IP、cookies 等）
        sendDefaultPii: false,
        // 上下文标记，区分平台
        initialScope: (scope) => {
          scope.setTag("platform", isTauri() ? "desktop" : "web");
          return scope;
        },
        // 过滤敏感信息并支持动态启停
        beforeSend(event) {
          return handleBeforeSend(event);
        },
      });

      isInitialized = true;
    } catch {
      // Sentry SDK 加载失败不影响应用运行
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}
