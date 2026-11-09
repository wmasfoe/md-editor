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
import { sentryReleaseName } from "./sentry-release.ts";

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
  T extends {
    breadcrumbs?: Array<{ category?: string; level?: string }>;
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
    tags?: Record<string, unknown>;
  },
>(event: T, options: { isDev?: boolean; isEnabled?: boolean } = {}): T | null {
  const isDev = options.isDev ?? isDevelopmentEnvironment();
  const isEnabled = options.isEnabled ?? isErrorReportingEnabled;

  if (isDev || !isEnabled) {
    return null;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs);
  }
  if (isStyleLearningEvent(event)) {
    scrubPaths(event);
  }

  return event;
}

/**
 * 风格学习相关的事件：错误信息里可能带工作区路径与文件名。
 * 学习相关代码在上报前会设置 `feature: "style-learning"` 标签；消息匹配只作为兜底。
 */
export function isStyleLearningEvent(event: {
  readonly message?: string;
  readonly tags?: Record<string, unknown>;
  readonly exception?: { values?: Array<{ value?: string }> };
}): boolean {
  const tag = event.tags?.feature ?? event.tags?.module;
  if (tag === "style-learning") return true;
  const texts = [event.message ?? "", ...(event.exception?.values ?? []).map((v) => v.value ?? "")];
  return texts.some(
    (text) =>
      text.includes("style-learning") ||
      text.includes("风格学习") ||
      text.includes("风格样本") ||
      text.includes("读取样本失败"),
  );
}

/** 路径片段允许中文、字母数字与内部空格（`我的 笔记.md`） */
const PATH_SEGMENT = "[\\p{L}\\p{N}_.-]+(?: [\\p{L}\\p{N}_.-]+)*";
const EXTENSION = "\\.(?:md|mdx|markdown|json|ts|tsx|js|jsx|txt|ya?ml|toml)\\b";
/** 形如 `日记/2024/私人.md` 的相对路径：末段同样允许空格 */
const RELATIVE_PATH = new RegExp(
  "(?<![\\\\/])[\\\\/]?(?:" + PATH_SEGMENT + "[\\\\/])+" + PATH_SEGMENT + EXTENSION,
  "giu",
);
/** 裸文件名（大小写不敏感，`.MD` 也算 Markdown） */
const BARE_FILE = new RegExp("(?<![\\p{L}\\p{N}_.])" + PATH_SEGMENT + EXTENSION, "giu");

function stripPaths(text: string): string {
  return (
    text
      // 相对路径：形如 `日记/2024/私人.md`，整段替换（必须在绝对路径规则之前，
      // 否则 `/2024/私人.md` 会被当成 POSIX 绝对路径而留下前面的目录名）
      .replace(RELATIVE_PATH, "[path]")
      // 盘符路径与 UNC
      .replace(
        new RegExp(
          "[A-Za-z]:[\\\\/](?:" + PATH_SEGMENT + "[\\\\/])*" + PATH_SEGMENT + EXTENSION,
          "giu",
        ),
        "[path]",
      )
      .replace(new RegExp("\\\\\\\\[^\\s'\"`,;]*", "gu"), "[path]")
      // POSIX 绝对路径：/a/b/c，前面不能是路径或文字的一部分；`12/34` 这类数字不算
      .replace(
        new RegExp(
          "(?<![\\p{L}\\p{N}_.-])(?:\\/(?:" +
            PATH_SEGMENT +
            "\\/)*" +
            PATH_SEGMENT +
            EXTENSION +
            ")",
          "giu",
        ),
        "[path]",
      )
      // 裸文件名：必须带常见文档/代码扩展名，避免误伤 1.2.3 这类版本号；中文文件名同样处理
      .replace(BARE_FILE, "[file]")
  );
}

/** 去掉绝对路径与文件名，只保留事件本身的错误描述 */
export function scrubPaths<
  T extends { message?: string; exception?: { values?: Array<{ value?: string }> } },
>(event: T): T {
  if (event.message) event.message = stripPaths(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = stripPaths(value.value);
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
        // 与 source map 上传的 release 一致，且不设置 dist。见 sentry-release.ts。
        release: sentryReleaseName(version),
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

/**
 * 上报风格学习失败。学习本身对用户保持静默，但错误上报需要带
 * `feature: "style-learning"` 标签，`beforeSend` 才会去掉其中的工作区路径与文件名（O-3）。
 */
export async function captureStyleLearningError(error: unknown): Promise<void> {
  if (isDevelopmentEnvironment() || !isErrorReportingEnabled) return;
  try {
    const Sentry = await import("@sentry/react");
    Sentry.withScope((scope) => {
      scope.setTag("feature", "style-learning");
      Sentry.captureException(error);
    });
  } catch {
    // Sentry 不可用时不影响学习本身
  }
}
