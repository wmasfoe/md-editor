import { describe, it, expect, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary.tsx";
import { bridge } from "../src/bridge/index.ts";

describe("ErrorBoundary Unit & Contract Tests", () => {
  it("should derive state from error correctly", () => {
    const error = new Error("CodeMirror initialization crashed");
    const state = ErrorBoundary.getDerivedStateFromError(error);

    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  it("should report caught error to native bridge via postToNative", () => {
    const postToNativeSpy = vi.spyOn(bridge, "postToNative").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const boundary = new ErrorBoundary({ children: null });
    const error = new Error("Projection rendering failure");
    const errorInfo = { componentStack: "    at EditorCanvas\n    at App" };

    boundary.componentDidCatch(error, errorInfo);

    expect(postToNativeSpy).toHaveBeenCalledWith("error", {
      message: "Projection rendering failure",
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    postToNativeSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should invoke onReset callback and update state when handleReset is called", () => {
    const onReset = vi.fn();
    const boundary = new ErrorBoundary({ children: null, onReset });
    boundary.state = {
      hasError: true,
      error: new Error("Test crash"),
    };

    boundary.setState = vi.fn((updater) => {
      const nextState = typeof updater === "function" ? updater(boundary.state) : updater;
      boundary.state = { ...boundary.state, ...nextState };
    });

    boundary.handleReset();

    expect(boundary.setState).toHaveBeenCalledWith({ hasError: false, error: null });
    expect(boundary.state.hasError).toBe(false);
    expect(boundary.state.error).toBe(null);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
