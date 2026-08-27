import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bootstrapDesktopPlatform,
  type DesktopPlatformInitializationError,
} from "../src/app/platform-bootstrap";
import { MAIN_WINDOW_LABEL, SETTINGS_WINDOW_LABEL } from "../src/desktop/window-labels";

describe("desktop platform bootstrap", () => {
  it("orders main registration, FileService construction, and render exactly once", async () => {
    const calls: string[] = [];
    const registration = { epoch: 7 };
    const fileService = { id: "main-files" };
    const renderError = vi.fn();

    await bootstrapDesktopPlatform({
      surface: MAIN_WINDOW_LABEL,
      attachMainSaveRuntime: async () => {
        calls.push("attach");
        return registration;
      },
      createMainFileService: async (received) => {
        expect(received).toBe(registration);
        calls.push("factory");
        return fileService;
      },
      renderMain: (services) => {
        expect(services.fileService).toBe(fileService);
        calls.push("render-main");
      },
      renderSettings: () => calls.push("render-settings"),
      renderInitializationError: renderError,
    });

    expect(calls).toEqual(["attach", "factory", "render-main"]);
    expect(renderError).not.toHaveBeenCalled();
  });

  it("renders settings without evaluating main registration or factory callbacks", async () => {
    const attach = vi.fn();
    const factory = vi.fn();
    const renderMain = vi.fn();
    const renderSettings = vi.fn();

    await bootstrapDesktopPlatform({
      surface: SETTINGS_WINDOW_LABEL,
      attachMainSaveRuntime: attach,
      createMainFileService: factory,
      renderMain,
      renderSettings,
      renderInitializationError: vi.fn(),
    });

    expect(renderSettings).toHaveBeenCalledOnce();
    expect(attach).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(renderMain).not.toHaveBeenCalled();
  });

  it("fails closed for unknown labels and main attach failures", async () => {
    const unknownError = vi.fn();
    const unknownFactory = vi.fn();
    await bootstrapDesktopPlatform({
      surface: { kind: "unknown", label: "preview" },
      attachMainSaveRuntime: vi.fn(),
      createMainFileService: unknownFactory,
      renderMain: vi.fn(),
      renderSettings: vi.fn(),
      renderInitializationError: unknownError,
    });

    expect(unknownFactory).not.toHaveBeenCalled();
    expect(unknownError).toHaveBeenCalledWith(
      expect.objectContaining<Partial<DesktopPlatformInitializationError>>({
        code: "UNKNOWN_WINDOW",
      }),
    );

    const attachFailure = new Error("native attach rejected");
    const failureError = vi.fn();
    const failureFactory = vi.fn();
    await bootstrapDesktopPlatform({
      surface: MAIN_WINDOW_LABEL,
      attachMainSaveRuntime: async () => Promise.reject(attachFailure),
      createMainFileService: failureFactory,
      renderMain: vi.fn(),
      renderSettings: vi.fn(),
      renderInitializationError: failureError,
    });

    expect(failureFactory).not.toHaveBeenCalled();
    expect(failureError).toHaveBeenCalledWith(
      expect.objectContaining<Partial<DesktopPlatformInitializationError>>({
        code: "MAIN_INITIALIZATION_FAILED",
        cause: attachFailure,
      }),
    );
  });
});

describe("desktop bootstrap dependency boundaries", () => {
  const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const settingsSource = readFileSync(
    new URL("../src/app/SettingsWindowApp.tsx", import.meta.url),
    "utf8",
  );
  const settingsDialogSource = readFileSync(
    new URL("../src/components/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const fileServiceSource = readFileSync(
    new URL("../src/desktop/file-service.ts", import.meta.url),
    "utf8",
  );

  it("keeps main App, attach, and FileService behind dynamic imports", () => {
    expect(mainSource).not.toMatch(/^import .*\.\/app\/App/mu);
    expect(mainSource).toContain('await import("./app/App")');
    expect(mainSource).toContain('await import("./desktop/save-runtime")');
    expect(mainSource).toContain('await import("./desktop/file-service")');
  });

  it("keeps the settings graph outside main App and FileService modules", () => {
    expect(settingsSource).not.toContain('from "./App"');
    expect(settingsSource).not.toContain("file-service");
    expect(settingsSource).not.toContain("save-runtime");
    expect(settingsDialogSource).not.toContain('from "../app/App"');
  });

  it("exports only a side-effect-free desktop FileService factory", () => {
    expect(fileServiceSource).toContain("export function createDesktopRuntimeFileService");
    expect(fileServiceSource).not.toContain("export const fileService");
    expect(fileServiceSource).not.toContain("attachSaveRuntime");
    expect(fileServiceSource).not.toContain("invoke(");
  });
});
