import { describe, expect, it, vi } from "vitest";
import {
  createAppEditorPreviewCoordinator,
  createAppEditorPreviewSession,
  createDefaultSettings,
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  type AppEditorPreviewEvent,
  type AppSettings,
  type EditorDisplaySettings,
} from "../src/app/settings/app-settings";

describe("editor font and typography preview lifecycle", () => {
  it("serializes preview delivery so session end cannot overtake an earlier preview", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstDelivered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const delivered: AppEditorPreviewEvent[] = [];
    const session = createAppEditorPreviewSession({
      sessionId: "serialized-editor-session",
      publishEvent: async (event) => {
        delivered.push(event);
        if (event.sequence === 1) {
          markFirstStarted?.();
          await firstDelivered;
        }
      },
    });

    const preview = session.publish({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      wysiwygFontSize: 20,
      proseFontFamily: "Inter",
    });
    const end = session.publish(null);
    await firstStarted;

    expect(delivered.map((event) => event.sequence)).toEqual([1]);
    releaseFirst?.();
    await Promise.all([preview, end]);
    expect(delivered.map((event) => event.sequence)).toEqual([1, 2]);
    expect(delivered[0]?.editor?.wysiwygFontSize).toBe(20);
    expect(delivered[0]?.editor?.proseFontFamily).toBe("Inter");
    expect(delivered[1]?.editor).toBeNull();
  });

  it("normalizes font size and trims font families in published events", async () => {
    const delivered: AppEditorPreviewEvent[] = [];
    const session = createAppEditorPreviewSession({
      sessionId: "normalize-session",
      publishEvent: async (event) => {
        delivered.push(event);
      },
    });

    await session.publish({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      wysiwygFontSize: 99, // Should clamp to 22
      proseFontFamily: "  PingFang SC  ",
      codeFontFamily: "  JetBrains Mono  ",
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.editor?.wysiwygFontSize).toBe(22);
    expect(delivered[0]?.editor?.proseFontFamily).toBe("PingFang SC");
    expect(delivered[0]?.editor?.codeFontFamily).toBe("JetBrains Mono");
  });

  it("applies preview font instantly and rolls back on cancel/close", async () => {
    const initialSettings = createDefaultSettings();
    let currentSettings = initialSettings;
    let previewEditor: EditorDisplaySettings | null = null;

    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: async () => initialSettings,
      onPersistedSettings: (next) => {
        currentSettings = next;
      },
      onPreviewEditor: (next) => {
        previewEditor = next;
      },
    });

    // 1. 改变字体，主窗口立即收到实时预览
    await coordinator.handle(
      previewEvent(1, {
        ...initialSettings.editor,
        wysiwygFontSize: 19,
        proseFontFamily: "Georgia",
        codeFontFamily: "Fira Code",
      }),
    );
    expect(previewEditor).not.toBeNull();
    expect(previewEditor?.wysiwygFontSize).toBe(19);
    expect(previewEditor?.proseFontFamily).toBe("Georgia");
    expect(previewEditor?.codeFontFamily).toBe("Fira Code");

    // 2. 取消/关闭，回滚至已持久化设置，清除预览状态
    await coordinator.handle(previewEvent(2, null));
    expect(previewEditor).toBeNull();
    expect(currentSettings).toEqual(initialSettings);
  });

  it("commits and reflects newly persisted editor font settings on save", async () => {
    const initialSettings = createDefaultSettings();
    const savedSettings: AppSettings = {
      ...initialSettings,
      editor: {
        ...initialSettings.editor,
        wysiwygFontSize: 21,
        proseFontFamily: "Charter",
        codeFontFamily: "SF Mono",
      },
    };
    let currentSettings = initialSettings;
    let previewEditor: EditorDisplaySettings | null = null;

    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: async () => savedSettings,
      onPersistedSettings: (next) => {
        currentSettings = next;
      },
      onPreviewEditor: (next) => {
        previewEditor = next;
      },
    });

    // 预览中
    await coordinator.handle(
      previewEvent(1, {
        ...initialSettings.editor,
        wysiwygFontSize: 21,
        proseFontFamily: "Charter",
        codeFontFamily: "SF Mono",
      }),
    );
    expect(previewEditor?.wysiwygFontSize).toBe(21);

    // 用户点击保存，Session 结束
    await coordinator.handle(previewEvent(2, null));
    expect(previewEditor).toBeNull();
    expect(currentSettings.editor.wysiwygFontSize).toBe(21);
    expect(currentSettings.editor.proseFontFamily).toBe("Charter");
    expect(currentSettings.editor.codeFontFamily).toBe("SF Mono");
  });

  it("rejects out-of-order stale preview events and events from closed sessions", async () => {
    const initialSettings = createDefaultSettings();
    let previewEditor: EditorDisplaySettings | null = null;

    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: async () => initialSettings,
      onPersistedSettings: () => {},
      onPreviewEditor: (next) => {
        previewEditor = next;
      },
    });

    // 序列 2 成功应用
    await coordinator.handle(
      previewEvent(2, {
        ...initialSettings.editor,
        wysiwygFontSize: 20,
      }),
    );
    expect(previewEditor?.wysiwygFontSize).toBe(20);

    // 迟到的序列 1 应被静默丢弃
    await coordinator.handle(
      previewEvent(1, {
        ...initialSettings.editor,
        wysiwygFontSize: 14,
      }),
    );
    expect(previewEditor?.wysiwygFontSize).toBe(20);

    // 会话关闭
    await coordinator.handle(previewEvent(3, null));
    expect(previewEditor).toBeNull();

    // 属于已关闭会话的迟到事件必须丢弃
    await coordinator.handle(
      previewEvent(4, {
        ...initialSettings.editor,
        wysiwygFontSize: 18,
      }),
    );
    expect(previewEditor).toBeNull();
  });

  it("handles multi-session switching and ignores previous session after close", async () => {
    const initialSettings = createDefaultSettings();
    let previewEditor: EditorDisplaySettings | null = null;

    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: async () => initialSettings,
      onPersistedSettings: () => {},
      onPreviewEditor: (next) => {
        previewEditor = next;
      },
    });

    // 会话 A 预览
    await coordinator.handle({
      sessionId: "session-a",
      sequence: 1,
      editor: { ...initialSettings.editor, wysiwygFontSize: 15 },
    });
    expect(previewEditor?.wysiwygFontSize).toBe(15);

    // 会话 B 抢占
    await coordinator.handle({
      sessionId: "session-b",
      sequence: 1,
      editor: { ...initialSettings.editor, wysiwygFontSize: 18 },
    });
    expect(previewEditor?.wysiwygFontSize).toBe(18);

    // 会话 A 发送迟到的结束指令，不应影响当前活跃的会话 B
    await coordinator.handle({
      sessionId: "session-a",
      sequence: 2,
      editor: null,
    });
    expect(previewEditor?.wysiwygFontSize).toBe(18);

    // 会话 B 正常结束
    await coordinator.handle({
      sessionId: "session-b",
      sequence: 2,
      editor: null,
    });
    expect(previewEditor).toBeNull();
  });

  it("ignores events after coordinator is disposed", async () => {
    const initialSettings = createDefaultSettings();
    const onPreview = vi.fn();
    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: async () => initialSettings,
      onPersistedSettings: () => {},
      onPreviewEditor: onPreview,
    });

    coordinator.dispose();
    await coordinator.handle(
      previewEvent(1, {
        ...initialSettings.editor,
        wysiwygFontSize: 20,
      }),
    );

    expect(onPreview).not.toHaveBeenCalled();
  });
});

function previewEvent(
  sequence: number,
  editor: EditorDisplaySettings | null,
): AppEditorPreviewEvent {
  return {
    sessionId: "settings-session",
    sequence,
    editor,
  };
}
