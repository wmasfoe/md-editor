import { describe, it, expect, vi, beforeEach } from "vitest";
import { InkpointBridgeImpl } from "../src/bridge/index.ts";

describe("InkpointBridge Core Contract Tests", () => {
  let bridge: InkpointBridgeImpl;

  beforeEach(() => {
    bridge = new InkpointBridgeImpl();
  });

  describe("Native to Web (dispatchNativeAction)", () => {
    it("should correctly dispatch stringified JSON message to registered handler", () => {
      const handler = vi.fn();
      bridge.onAction("loadDocument", handler);

      const payload = { content: "# Hello Mobile", path: "/test.md", initialMode: "read" };
      bridge.dispatchNativeAction(
        JSON.stringify({
          id: "msg-1",
          action: "loadDocument",
          payload,
        }),
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload, "msg-1");
    });

    it("should correctly dispatch pre-parsed object message", () => {
      const handler = vi.fn();
      bridge.onAction("setMode", handler);

      bridge.dispatchNativeAction({
        id: "msg-2",
        action: "setMode",
        payload: { mode: "edit" },
      });

      expect(handler).toHaveBeenCalledWith({ mode: "edit" }, "msg-2");
    });

    it("should gracefully handle malformed JSON without throwing", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        bridge.dispatchNativeAction("invalid json string {");
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should allow unsubscribing from actions", () => {
      const handler = vi.fn();
      const unsubscribe = bridge.onAction("execCommand", handler);

      bridge.dispatchNativeAction({
        id: "msg-3",
        action: "execCommand",
        payload: { command: "bold" },
      });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      bridge.dispatchNativeAction({
        id: "msg-4",
        action: "execCommand",
        payload: { command: "bold" },
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Web to Native (postToNative)", () => {
    interface MockNativeBridgeScope {
      webkit?: {
        messageHandlers?: {
          InkpointBridge?: {
            postMessage: (msg: string) => void;
          };
        };
      };
      AndroidBridge?: {
        postMessage: (msg: string) => void;
      };
    }
    const globalScope = globalThis as MockNativeBridgeScope;

    it("should dispatch to window.webkit.messageHandlers on iOS", () => {
      const postMessageSpy = vi.fn();
      globalScope.webkit = {
        messageHandlers: {
          InkpointBridge: {
            postMessage: postMessageSpy,
          },
        },
      };

      bridge.notifyReady();

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const sentPayload = JSON.parse(postMessageSpy.mock.calls[0][0]);
      expect(sentPayload.event).toBe("ready");
      expect(sentPayload.timestamp).toBeTypeOf("number");

      delete globalScope.webkit;
    });

    it("should dispatch to window.AndroidBridge on Android", () => {
      const postMessageSpy = vi.fn();
      globalScope.AndroidBridge = {
        postMessage: postMessageSpy,
      };

      bridge.triggerHaptic("impactLight");

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const sentPayload = JSON.parse(postMessageSpy.mock.calls[0][0]);
      expect(sentPayload.event).toBe("haptic");
      expect(sentPayload.payload).toEqual({ type: "impactLight" });

      delete globalScope.AndroidBridge;
    });

    it("should post contentChange, saveResponse and outlineExtracted with correct payloads", () => {
      const postMessageSpy = vi.fn();
      globalScope.AndroidBridge = { postMessage: postMessageSpy };

      bridge.notifyContentChange({ isDirty: true, wordCount: 42 });
      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      let sent = JSON.parse(postMessageSpy.mock.calls[0][0]);
      expect(sent.event).toBe("contentChange");
      expect(sent.payload).toEqual({ isDirty: true, wordCount: 42 });

      bridge.respondSaveContent("# Saved Markdown", true, "/doc.md");
      expect(postMessageSpy).toHaveBeenCalledTimes(2);
      sent = JSON.parse(postMessageSpy.mock.calls[1][0]);
      expect(sent.event).toBe("saveResponse");
      expect(sent.payload).toEqual({
        markdown: "# Saved Markdown",
        isSuccess: true,
        path: "/doc.md",
      });

      bridge.notifyOutline([
        { id: "heading-1", text: "Introduction", level: 1 },
        { id: "heading-2", text: "Details", level: 2 },
      ]);
      expect(postMessageSpy).toHaveBeenCalledTimes(3);
      sent = JSON.parse(postMessageSpy.mock.calls[2][0]);
      expect(sent.event).toBe("outlineExtracted");
      expect(sent.payload.headings).toEqual([
        { headingId: "heading-1", text: "Introduction", level: 1 },
        { headingId: "heading-2", text: "Details", level: 2 },
      ]);

      delete globalScope.AndroidBridge;
    });
  });
});
