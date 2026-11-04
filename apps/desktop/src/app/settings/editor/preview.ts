/**
 * @fileoverview 编辑器排版与字体跨窗口实时预览协调系统 (Editor Font/Display Preview Coordinator)
 *
 * 当用户在独立的“偏好设置”窗口中调节正文字体、代码字体、字号等显示偏好时，
 * 通过本协调系统向主编辑窗口实时广播预览事件，实现与主题切换完全一致的「即时反馈、取消回滚、保存生效」体验。
 * 同时通过递增序号与会话门禁 (Gate) 消除多窗口 IPC 乱序导致的竞态回退。
 */

import { emit, listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../../desktop/safe-unlisten";
import { isTauri } from "@tauri-apps/api/core";
import { normalizeEditorDisplaySettings } from "./defaults.ts";
import type { EditorDisplaySettings } from "./types.ts";

/** 编辑器显示设置跨窗口实时预览事件通道标识 */
export const APP_EDITOR_PREVIEW_CHANGED_EVENT = "md-editor-app-editor-preview-changed";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * 跨窗口编辑器显示设置实时预览事件载荷
 */
export interface AppEditorPreviewEvent {
  readonly sessionId: string;
  readonly sequence: number;
  readonly editor: EditorDisplaySettings | null;
}

/**
 * 编辑器显示设置实时预览发布会话契约
 */
export interface AppEditorPreviewSession {
  readonly sessionId: string;
  readonly publish: (editor: EditorDisplaySettings | null) => Promise<void>;
}

/**
 * 编辑器显示设置实时预览跨窗口协调器
 */
export interface AppEditorPreviewCoordinator {
  readonly handle: (event: AppEditorPreviewEvent) => Promise<void>;
  readonly dispose: () => void;
}

/**
 * 监听跨窗口编辑器排版与字体预览变更事件
 */
export function listenToAppEditorPreviewChanged(
  handler: (event: AppEditorPreviewEvent) => void,
): (() => void) | undefined {
  if (isTauri()) {
    let unlisten: (() => void | Promise<void>) | undefined;
    let disposed = false;

    void listen<unknown>(APP_EDITOR_PREVIEW_CHANGED_EVENT, (event) => {
      const normalized = normalizeAppEditorPreviewEvent(event.payload);
      if (normalized) handler(normalized);
    })
      .then((dispose) => {
        if (disposed) {
          safeUnlisten(dispose);
          return;
        }
        unlisten = dispose;
      })
      .catch((err: unknown) => {
        console.debug("[tauri] listen to app editor preview failed:", err);
      });

    return () => {
      disposed = true;
      const fn = unlisten;
      unlisten = undefined;
      safeUnlisten(fn);
    };
  }

  const listener = (event: Event) => {
    const normalized = normalizeAppEditorPreviewEvent((event as CustomEvent<unknown>).detail);
    if (normalized) handler(normalized);
  };
  window.addEventListener(APP_EDITOR_PREVIEW_CHANGED_EVENT, listener);
  return () => window.removeEventListener(APP_EDITOR_PREVIEW_CHANGED_EVENT, listener);
}

/**
 * 创建发起端的编辑器字体与显示实时预览会话 (Session)
 */
export function createAppEditorPreviewSession({
  sessionId = createAppEditorPreviewSessionId(),
  publishEvent = publishAppEditorPreviewEvent,
}: {
  readonly sessionId?: string;
  readonly publishEvent?: (event: AppEditorPreviewEvent) => Promise<void>;
} = {}): AppEditorPreviewSession {
  let sequence = 0;
  let pending = Promise.resolve();

  return {
    sessionId,
    publish(editor) {
      const event: AppEditorPreviewEvent = {
        sessionId,
        sequence: (sequence += 1),
        editor: editor === null ? null : normalizeEditorDisplaySettings(editor),
      };
      // 串行发送保证结束事件（publish null）一定排在所有预览事件之后
      const operation = pending.catch(() => undefined).then(() => publishEvent(event));
      pending = operation;
      return operation;
    },
  };
}

/**
 * 创建接收端的编辑器字体与显示实时预览协调器 (Coordinator)
 */
export function createAppEditorPreviewCoordinator<
  TSettings extends { editor: EditorDisplaySettings },
>({
  loadPersistedSettings,
  onPersistedSettings,
  onPreviewEditor,
}: {
  readonly loadPersistedSettings: () => Promise<TSettings>;
  readonly onPersistedSettings: (settings: TSettings) => void;
  readonly onPreviewEditor: (editor: EditorDisplaySettings | null) => void;
}): AppEditorPreviewCoordinator {
  const gate = createAppEditorPreviewEventGate();
  let revision = 0;
  let disposed = false;

  return {
    async handle(event) {
      const decision = gate(event);
      if (decision === "ignore" || disposed) return;

      const currentRevision = (revision += 1);
      if (decision === "preview") {
        onPreviewEditor(event.editor);
        return;
      }

      // 预览结束：重新拉取权威持久化配置并清空预览
      const persistedSettings = await loadPersistedSettings();
      if (disposed || currentRevision !== revision) return;
      onPersistedSettings(persistedSettings);
      onPreviewEditor(null);
    },
    dispose() {
      disposed = true;
      revision += 1;
    },
  };
}

async function publishAppEditorPreviewEvent(event: AppEditorPreviewEvent): Promise<void> {
  if (isTauri()) {
    await emit(APP_EDITOR_PREVIEW_CHANGED_EVENT, event);
    return;
  }

  window.dispatchEvent(new CustomEvent(APP_EDITOR_PREVIEW_CHANGED_EVENT, { detail: event }));
}

function createAppEditorPreviewEventGate() {
  const lastSequenceBySession = new Map<string, number>();
  const closedSessions = new Set<string>();
  let activeSessionId: string | null = null;

  return (event: AppEditorPreviewEvent): "preview" | "end" | "ignore" => {
    const lastSequence = lastSequenceBySession.get(event.sessionId) ?? 0;
    if (event.sequence <= lastSequence || closedSessions.has(event.sessionId)) {
      return "ignore";
    }
    lastSequenceBySession.set(event.sessionId, event.sequence);

    if (event.editor !== null) {
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

function normalizeAppEditorPreviewEvent(input: unknown): AppEditorPreviewEvent | null {
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
    editor: input.editor === null ? null : normalizeEditorDisplaySettings(input.editor),
  };
}

let fallbackEditorPreviewSessionSequence = 0;

function createAppEditorPreviewSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackEditorPreviewSessionSequence += 1;
  return `editor-preview-${Date.now()}-${fallbackEditorPreviewSessionSequence}`;
}
