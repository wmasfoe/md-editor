/**
 * @file index.ts
 * @description InkpointBridge 核心调度单例。
 * 实现原生平台 (iOS WKWebView / Android WebView) 与前端 Webview 之间的双向 RPC 通信。
 */

import type {
  BridgeMessage,
  ContentChangePayload,
  HapticStyle,
  OutlineItem,
  SelectionFormatPayload,
} from "./contracts.ts";

export * from "./contracts.ts";

// 扩展全局 Window 接口
declare global {
  interface Window {
    InkpointBridge?: InkpointBridgeImpl;
    webkit?: {
      messageHandlers?: {
        InkpointBridge?: {
          postMessage: (message: string | object) => void;
        };
      };
    };
    AndroidBridge?: {
      postMessage: (messageJson: string) => void;
    };
  }
}

interface GlobalBridgeScope {
  InkpointBridge?: InkpointBridgeImpl;
  webkit?: {
    messageHandlers?: {
      InkpointBridge?: {
        postMessage: (message: string) => void;
      };
    };
  };
  AndroidBridge?: {
    postMessage: (message: string) => void;
  };
}

function getGlobalScope(): GlobalBridgeScope {
  if (typeof window !== "undefined") return window as unknown as GlobalBridgeScope;
  if (typeof globalThis !== "undefined") return globalThis as unknown as GlobalBridgeScope;
  return {};
}

// oxlint-disable-next-line typescript/no-explicit-any
type RawHandler = (payload: any, messageId: string) => void | Promise<void>;
type ActionHandler<T = unknown> = (payload: T, messageId: string) => void | Promise<void>;

export class InkpointBridgeImpl {
  private handlers = new Map<string, Set<RawHandler>>();

  constructor() {
    // 自动挂载到全局对象，供原生端通过 evaluateJavaScript 直接调用
    const globalScope = getGlobalScope();
    globalScope.InkpointBridge = this;
  }

  /**
   * 原生端调用的统一入口方法
   * 支持传入 JSON 字符串或已解析的 Message 对象
   */
  public dispatchNativeAction(rawMessage: string | BridgeMessage): void {
    let msg: BridgeMessage;
    if (typeof rawMessage === "string") {
      try {
        msg = JSON.parse(rawMessage);
      } catch (err) {
        console.error("[InkpointBridge] Failed to parse native message JSON:", rawMessage, err);
        return;
      }
    } else {
      msg = rawMessage;
    }

    if (!msg || typeof msg.action !== "string") {
      console.warn("[InkpointBridge] Invalid message received:", msg);
      return;
    }

    const listeners = this.handlers.get(msg.action);
    if (listeners && listeners.size > 0) {
      listeners.forEach((handler) => {
        try {
          handler(msg.payload, msg.id);
        } catch (err) {
          console.error(
            `[InkpointBridge] Error executing handler for action "${msg.action}":`,
            err,
          );
        }
      });
    } else {
      console.warn(`[InkpointBridge] No listener registered for action: "${msg.action}"`);
    }
  }

  /**
   * 注册监听特定 Native Action
   * 返回取消监听的清理函数
   */
  public onAction<T = unknown>(action: string, handler: ActionHandler<T>): () => void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    const set = this.handlers.get(action)!;
    const raw = handler as RawHandler;
    set.add(raw);

    return () => {
      set.delete(raw);
      if (set.size === 0) {
        this.handlers.delete(action);
      }
    };
  }

  /**
   * 发送事件或数据给原生端
   */
  public postToNative(event: string, payload: unknown = {}): void {
    const message = {
      event,
      payload,
      timestamp: Date.now(),
    };
    const jsonString = JSON.stringify(message);

    const globalScope = getGlobalScope();

    // 1. iOS WKWebView: window.webkit.messageHandlers.InkpointBridge.postMessage
    if (globalScope.webkit?.messageHandlers?.InkpointBridge) {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        globalScope.webkit.messageHandlers.InkpointBridge.postMessage(jsonString);
        return;
      } catch (err) {
        console.error("[InkpointBridge] Failed to post message to iOS:", err);
      }
    }

    // 2. Android WebView: window.AndroidBridge.postMessage
    if (globalScope.AndroidBridge?.postMessage) {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        globalScope.AndroidBridge.postMessage(jsonString);
        return;
      } catch (err) {
        console.error("[InkpointBridge] Failed to post message to Android:", err);
      }
    }

    // 3. 浏览器/本地开发环境模拟
    if (process.env.NODE_ENV !== "production") {
      console.log("[InkpointBridge -> Native Mock]", message);
    }
  }

  // ==========================================
  // 常用快捷调用方法
  // ==========================================

  /** 通知原生端：前端已就绪 */
  public notifyReady(): void {
    this.postToNative("ready");
  }

  /** 通知原生端：文档内容修改状态变化 */
  public notifyContentChange(payload: ContentChangePayload): void {
    this.postToNative("contentChange", {
      isDirty: payload.isDirty,
      wordCount: payload.wordCount,
    });
  }

  /** 通知原生端：当前选区的富文本格式状态（用于软键盘工具栏高亮） */
  public notifySelectionFormats(payload: SelectionFormatPayload): void {
    this.postToNative("selectionChange", payload);
  }

  /** 响应原生端：提交保存的文档内容 */
  public respondSaveContent(content: string, success = true, path?: string): void {
    this.postToNative("saveResponse", { markdown: content, isSuccess: success, path });
  }

  /** 通知原生端：提取出的大纲层级结构 */
  public notifyOutline(outline: OutlineItem[]): void {
    const headings = outline.map((item) => ({
      headingId: item.id,
      text: item.text,
      level: item.level,
    }));
    this.postToNative("outlineExtracted", { headings, outline });
  }

  /** 请求原生端触发震动触觉反馈 */
  public triggerHaptic(style: HapticStyle = "selection"): void {
    this.postToNative("haptic", { type: style });
  }
}

export const bridge = new InkpointBridgeImpl();
