/**
 * @fileoverview 主题跨窗口实时预览协调系统 (Theme Preview Coordinator)
 *
 * 当用户在独立“偏好设置”窗口中切换主题时，通过本协调器向主编辑窗口实时广播预览事件，
 * 并通过单调递增序号与会话门禁 (Gate) 消除网络/IPC 乱序导致的竞态回退。
 */

import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { APP_THEME_PREVIEW_CHANGED_EVENT } from "./defaults.ts";
import { normalizeAppTheme } from "./normalizer.ts";
import type {
  AppThemePreviewCoordinator,
  AppThemePreviewEvent,
  AppThemePreviewSession,
  AppThemeSettings,
} from "./types.ts";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * 监听跨窗口主题预览变更事件
 */
export function listenToAppThemePreviewChanged(
  handler: (event: AppThemePreviewEvent) => void,
): (() => void) | undefined {
  if (isTauri()) {
    // 主题预览是跨窗口即时反馈，不代表已保存；会话和序号用于拒绝迟到事件。
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<unknown>(APP_THEME_PREVIEW_CHANGED_EVENT, (event) => {
      const normalized = normalizeAppThemePreviewEvent(event.payload);
      if (normalized) handler(normalized);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    };
  }

  const listener = (event: Event) => {
    const normalized = normalizeAppThemePreviewEvent((event as CustomEvent<unknown>).detail);
    if (normalized) handler(normalized);
  };
  window.addEventListener(APP_THEME_PREVIEW_CHANGED_EVENT, listener);
  return () => window.removeEventListener(APP_THEME_PREVIEW_CHANGED_EVENT, listener);
}

/**
 * 创建发起端的主题实时预览会话 (Session)
 */
export function createAppThemePreviewSession({
  sessionId = createAppThemePreviewSessionId(),
  publishEvent = publishAppThemePreviewEvent,
}: {
  readonly sessionId?: string;
  readonly publishEvent?: (event: AppThemePreviewEvent) => Promise<void>;
} = {}): AppThemePreviewSession {
  let sequence = 0;
  let pending = Promise.resolve();

  return {
    sessionId,
    publish(theme) {
      const event: AppThemePreviewEvent = {
        sessionId,
        sequence: (sequence += 1),
        theme: theme === null ? null : normalizeAppTheme(theme),
      };
      // 串行发送保证结束事件一定排在本会话所有预览之后；失败不阻塞后续结束事件。
      const operation = pending.catch(() => undefined).then(() => publishEvent(event));
      pending = operation;
      return operation;
    },
  };
}

/**
 * 创建接收端的主题实时预览协调器 (Coordinator)
 */
export function createAppThemePreviewCoordinator<TSettings extends { theme: AppThemeSettings }>({
  loadPersistedSettings,
  onPersistedSettings,
  onPreviewTheme,
}: {
  readonly loadPersistedSettings: () => Promise<TSettings>;
  readonly onPersistedSettings: (settings: TSettings) => void;
  readonly onPreviewTheme: (theme: AppThemeSettings | null) => void;
}): AppThemePreviewCoordinator {
  const gate = createAppThemePreviewEventGate();
  let revision = 0;
  let disposed = false;

  return {
    async handle(event) {
      const decision = gate(event);
      if (decision === "ignore" || disposed) return;

      const currentRevision = (revision += 1);
      if (decision === "preview") {
        onPreviewTheme(event.theme);
        return;
      }

      const persistedSettings = await loadPersistedSettings();
      if (disposed || currentRevision !== revision) return;
      // 先更新权威设置，再清空预览；React 会在同一任务中批处理这两个状态变更。
      onPersistedSettings(persistedSettings);
      onPreviewTheme(null);
    },
    dispose() {
      disposed = true;
      revision += 1;
    },
  };
}

async function publishAppThemePreviewEvent(event: AppThemePreviewEvent): Promise<void> {
  if (isTauri()) {
    await emit(APP_THEME_PREVIEW_CHANGED_EVENT, event);
    return;
  }

  window.dispatchEvent(new CustomEvent(APP_THEME_PREVIEW_CHANGED_EVENT, { detail: event }));
}

function createAppThemePreviewEventGate() {
  const lastSequenceBySession = new Map<string, number>();
  const closedSessions = new Set<string>();
  let activeSessionId: string | null = null;

  return (event: AppThemePreviewEvent): "preview" | "end" | "ignore" => {
    const lastSequence = lastSequenceBySession.get(event.sessionId) ?? 0;
    if (event.sequence <= lastSequence || closedSessions.has(event.sessionId)) {
      return "ignore";
    }
    lastSequenceBySession.set(event.sessionId, event.sequence);

    if (event.theme !== null) {
      activeSessionId = event.sessionId;
      return "preview";
    }

    closedSessions.add(event.sessionId);
    if (activeSessionId !== null && activeSessionId !== event.sessionId) {
      return "ignore";
    }
    activeSessionId = null;
    return "end";
  };
}

function normalizeAppThemePreviewEvent(input: unknown): AppThemePreviewEvent | null {
  if (
    !isRecord(input) ||
    typeof input.sessionId !== "string" ||
    input.sessionId.length === 0 ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) <= 0
  ) {
    return null;
  }

  return {
    sessionId: input.sessionId,
    sequence: input.sequence as number,
    theme: input.theme === null ? null : normalizeAppTheme(input.theme),
  };
}

let fallbackThemePreviewSessionSequence = 0;

function createAppThemePreviewSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackThemePreviewSessionSequence += 1;
  return `theme-preview-${Date.now()}-${fallbackThemePreviewSessionSequence}`;
}
