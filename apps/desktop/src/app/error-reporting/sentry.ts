/**
 * @fileoverview Sentry 错误上报初始化模块
 *
 * 根据用户在设置中启用的错误上报开关，延迟初始化 Sentry SDK。
 * 仅收集 JS 异常与未处理 Promise rejection，不采集用户文档内容或个人数据。
 * 设备信息（OS、版本、架构）由 Sentry 自动采集。
 */

import { isTauri } from "@tauri-apps/api/core";
import type { ErrorReportingSettings } from "../settings/error-reporting/types.ts";

declare const __APP_VERSION__: string;

/** Sentry DSN — 替换为实际项目的 DSN */
const SENTRY_DSN = "https://1376e8b5c3e71f8643ab61077a5eb48b@o4505284194074624.ingest.us.sentry.io/4512117887008768";

let isInitialized = false;

/**
 * 根据用户设置启用或禁用 Sentry 错误上报。
 * 应在应用启动和设置变更时调用。
 */
export function syncSentryWithSettings(settings: ErrorReportingSettings): void {
  if (settings.enabled) {
    enableSentry();
  } else {
    disableSentry();
  }
}

async function enableSentry(): Promise<void> {
  if (isInitialized) return;

  try {
    const Sentry = await import("@sentry/react");

    Sentry.init({
      dsn: SENTRY_DSN,
      release: `inkpoint@${__APP_VERSION__}`,
      environment: isTauri() ? "desktop" : "web",
      // 采样率：100% 捕获（免费额度 5K/月，小团队足够）
      tracesSampleRate: 0,
      // 不采集 PII（IP、cookies 等）
      sendDefaultPii: false,
      // 上下文标记，区分平台
      initialScope: (scope) => {
        scope.setTag("platform", isTauri() ? "desktop" : "web");
        return scope;
      },
      // 过滤敏感信息：不发送文档内容
      beforeSend(event) {
        // 移除可能包含文档内容的 breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.filter(
            (bc) => bc.category !== "console" || bc.level !== "log",
          );
        }
        return event;
      },
    });

    isInitialized = true;
  } catch {
    // Sentry SDK 加载失败不影响应用运行
  }
}

function disableSentry(): void {
  if (!isInitialized) return;

  try {
    // 动态 import 以获取 client 并关闭
    import("@sentry/react")
      .then((Sentry) => {
        Sentry.close().catch(() => undefined);
        isInitialized = false;
      })
      .catch(() => undefined);
  } catch {
    // 忽略
  }
}
