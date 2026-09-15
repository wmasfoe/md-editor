/**
 * @file contracts.ts
 * @description Inkpoint 移动端 JSBridge 双向通信类型契约定义。
 * 覆盖原生 (iOS/Android) 与 Webview 交互的所有 Action 与 Event。
 */

/** 基础消息封包结构 */
export interface BridgeMessage<T = unknown> {
  id: string;
  action: string;
  payload: T;
}

/** 异步请求响应结构 */
export interface BridgeResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

// ==========================================
// 1. 原生 ➔ Web (Native to Web Actions)
// ==========================================

export interface LoadDocumentPayload {
  content?: string;
  markdown?: string;
  path?: string;
  initialMode?: "read" | "edit";
  mode?: "read" | "edit";
  title?: string;
}

export interface SetModePayload {
  mode: "read" | "edit";
}

export type MarkdownCommand =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "h1"
  | "h2"
  | "h3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "undo"
  | "redo";

export interface ExecCommandPayload {
  command: MarkdownCommand;
}

export interface SetThemePayload {
  isDark: boolean;
}

// ==========================================
// 2. Web ➔ 原生 (Web to Native Events)
// ==========================================

export interface OutlineItem {
  level: number;
  text: string;
  id: string;
}

export interface NativeHeadingItem {
  headingId: string;
  text: string;
  level: number;
}

export interface ContentChangePayload {
  isDirty: boolean;
  wordCount: number;
}

export interface SelectionFormatPayload {
  activeFormats: MarkdownCommand[];
}

export interface SaveContentResponsePayload {
  content: string;
  success: boolean;
  path?: string;
}

export interface OutlineExtractedPayload {
  headings: NativeHeadingItem[];
  outline?: OutlineItem[];
}

export type HapticStyle =
  | "selection"
  | "impactLight"
  | "impactMedium"
  | "impactHeavy"
  | "notificationSuccess"
  | "notificationError";

export interface TriggerHapticPayload {
  style: HapticStyle;
}
