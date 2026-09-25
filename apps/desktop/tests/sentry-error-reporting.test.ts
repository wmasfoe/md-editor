import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSentryStateForTesting,
  ensureSentryInitialized,
  handleBeforeSend,
  isDevelopmentEnvironment,
  isSentryInitialized,
  isSentryReportingEnabled,
  sanitizeBreadcrumbs,
  syncSentryWithSettings,
} from "../src/app/error-reporting/sentry";

const mockSentryInit = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => mockSentryInit(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
}));

describe("sentry error reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSentryStateForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetSentryStateForTesting();
  });

  describe("isDevelopmentEnvironment", () => {
    it("returns true in standard dev/test mode", () => {
      // Vitest defaults to MODE='test'
      expect(isDevelopmentEnvironment()).toBe(true);
    });

    it("returns false in production mode", () => {
      vi.stubEnv("DEV", "");
      vi.stubEnv("MODE", "production");
      vi.stubEnv("NODE_ENV", "production");

      // In Vitest, import.meta.env.DEV might still be true unless overridden,
      // so let's verify with explicit production settings
      const originalEnv = { ...import.meta.env };
      try {
        Object.assign(import.meta.env, {
          DEV: false,
          PROD: true,
          MODE: "production",
          VITE_ENABLE_SENTRY: undefined,
        });
        expect(isDevelopmentEnvironment()).toBe(false);
      } finally {
        Object.assign(import.meta.env, originalEnv);
      }
    });

    it("returns false when VITE_ENABLE_SENTRY is explicitly 'true'", () => {
      const originalEnv = { ...import.meta.env };
      try {
        Object.assign(import.meta.env, {
          DEV: true,
          MODE: "development",
          VITE_ENABLE_SENTRY: "true",
        });
        expect(isDevelopmentEnvironment()).toBe(false);
      } finally {
        Object.assign(import.meta.env, originalEnv);
      }
    });

    it("identifies e2e mode as development environment", () => {
      const originalEnv = { ...import.meta.env };
      try {
        Object.assign(import.meta.env, {
          DEV: false,
          MODE: "e2e",
          VITE_ENABLE_SENTRY: undefined,
        });
        expect(isDevelopmentEnvironment()).toBe(true);
      } finally {
        Object.assign(import.meta.env, originalEnv);
      }
    });
  });

  describe("sanitizeBreadcrumbs", () => {
    it("removes console.log, info, and debug while retaining error, warn and non-console breadcrumbs", () => {
      const breadcrumbs = [
        { category: "console", level: "log", message: "Sensitive doc content" },
        { category: "console", level: "info", message: "User typed text" },
        { category: "console", level: "debug", message: "AST tree dump" },
        { category: "console", level: "warn", message: "Warning: deprecated API" },
        { category: "console", level: "error", message: "Failed to render" },
        { category: "navigation", to: "/settings" },
        { category: "ui.click", message: "button.save" },
      ];

      const sanitized = sanitizeBreadcrumbs(breadcrumbs);

      expect(sanitized).toEqual([
        { category: "console", level: "warn", message: "Warning: deprecated API" },
        { category: "console", level: "error", message: "Failed to render" },
        { category: "navigation", to: "/settings" },
        { category: "ui.click", message: "button.save" },
      ]);
    });
  });

  describe("handleBeforeSend", () => {
    it("drops events completely in development environment", () => {
      const event = {
        message: "Test error in dev",
        breadcrumbs: [{ category: "console", level: "error" }],
      };

      const result = handleBeforeSend(event, { isDev: true, isEnabled: true });
      expect(result).toBeNull();
    });

    it("drops events when error reporting is disabled by user", () => {
      const event = {
        message: "Test error",
        breadcrumbs: [{ category: "console", level: "error" }],
      };

      const result = handleBeforeSend(event, { isDev: false, isEnabled: false });
      expect(result).toBeNull();
    });

    it("allows events and sanitizes breadcrumbs in production with error reporting enabled", () => {
      const event = {
        message: "Crash in production",
        breadcrumbs: [
          { category: "console", level: "log", message: "leaked line" },
          { category: "console", level: "error", message: "network timeout" },
        ],
      };

      const result = handleBeforeSend(event, { isDev: false, isEnabled: true });
      expect(result).not.toBeNull();
      expect(result?.message).toBe("Crash in production");
      expect(result?.breadcrumbs).toEqual([
        { category: "console", level: "error", message: "network timeout" },
      ]);
    });
  });

  describe("syncSentryWithSettings & ensureSentryInitialized", () => {
    it("does NOT initialize Sentry in development environment even if enabled", async () => {
      // Default Vitest environment is development/test
      syncSentryWithSettings({ enabled: true });
      await ensureSentryInitialized();

      expect(mockSentryInit).not.toHaveBeenCalled();
      expect(isSentryInitialized()).toBe(false);
    });

    it("initializes Sentry in production environment when enabled is true", async () => {
      const originalEnv = { ...import.meta.env };
      try {
        Object.assign(import.meta.env, {
          DEV: false,
          PROD: true,
          MODE: "production",
          VITE_ENABLE_SENTRY: undefined,
        });

        syncSentryWithSettings({ enabled: true });
        await ensureSentryInitialized();

        expect(mockSentryInit).toHaveBeenCalledTimes(1);
        expect(isSentryInitialized()).toBe(true);
        expect(isSentryReportingEnabled()).toBe(true);

        const initCall = mockSentryInit.mock.calls[0][0];
        expect(initCall.enabled).toBe(true);
        expect(initCall.environment).toBe("web");
        expect(initCall.tracesSampleRate).toBe(0);
        expect(initCall.sendDefaultPii).toBe(false);
      } finally {
        Object.assign(import.meta.env, originalEnv);
      }
    });

    it("updates reporting enabled state when user toggles setting", async () => {
      syncSentryWithSettings({ enabled: false });
      expect(isSentryReportingEnabled()).toBe(false);

      syncSentryWithSettings({ enabled: true });
      expect(isSentryReportingEnabled()).toBe(true);
    });
  });
});
