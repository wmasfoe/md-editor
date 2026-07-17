import React from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeFileService } from "@md-editor/file-system";
import {
  bootstrapDesktopPlatform,
  type DesktopPlatformInitializationError,
  type MainPlatformServices,
} from "./app/platform-bootstrap";
import { resolveDesktopWindowSurface } from "./desktop/window-labels";
import "./styles.css";

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === "e2e") {
    const search = new URLSearchParams(window.location.search);
    if (search.get("surface") === "codemirror-editor") {
      const { installCodeMirrorEditorHarness } =
        await import("./testing/codemirror-editor-harness");
      installCodeMirrorEditorHarness(
        document.getElementById("root")!,
        search.get("strict") === "true",
      );
      return;
    }
  }

  const surface = resolveDesktopWindowSurface();
  const isE2e = import.meta.env.MODE === "e2e";

  await bootstrapDesktopPlatform({
    surface,
    attachMainSaveRuntime: async () => {
      if (isE2e) {
        const { attachE2eSaveRuntime } = await import("./testing/e2e-platform");
        return attachE2eSaveRuntime();
      }
      const { attachSaveRuntime } = await import("./desktop/save-runtime");
      return attachSaveRuntime();
    },
    createMainFileService: async (registration) => {
      if (isE2e) {
        const { createE2eRuntimeFileService } = await import("./testing/e2e-platform");
        return createE2eRuntimeFileService(registration);
      }
      const { createDesktopRuntimeFileService } = await import("./desktop/file-service");
      return createDesktopRuntimeFileService(registration);
    },
    renderMain: renderMainSurface,
    renderSettings: renderSettingsSurface,
    renderInitializationError,
  });
}

async function renderMainSurface(
  services: MainPlatformServices<RuntimeFileService>,
): Promise<void> {
  const { App } = await import("./app/App");
  let testingCallbacks:
    | {
        readonly onDesktopActionsChange: NonNullable<
          React.ComponentProps<typeof App>["onDesktopActionsChange"]
        >;
        readonly onRendererPortsChange: NonNullable<
          React.ComponentProps<typeof App>["onRendererPortsChange"]
        >;
      }
    | undefined;
  if (import.meta.env.MODE === "e2e") {
    const { installEditorE2eBridge } = await import("./testing/e2e-bridge");
    testingCallbacks = installEditorE2eBridge(services.fileService);
  }
  createRoot(requireRootElement()).render(
    <React.StrictMode>
      <App
        fileService={services.fileService}
        onDesktopActionsChange={testingCallbacks?.onDesktopActionsChange}
        onRendererPortsChange={testingCallbacks?.onRendererPortsChange}
      />
    </React.StrictMode>,
  );
}

async function renderSettingsSurface(): Promise<void> {
  const { SettingsWindowApp } = await import("./app/SettingsWindowApp");
  createRoot(requireRootElement()).render(
    <React.StrictMode>
      <SettingsWindowApp />
    </React.StrictMode>,
  );
}

function renderInitializationError(error: DesktopPlatformInitializationError): void {
  console.error(error, error.cause);
  createRoot(requireRootElement()).render(
    <main className="grid h-full place-items-center bg-[var(--theme-bg)] p-8 text-[var(--theme-text)]">
      <section className="max-w-[520px] text-center" role="alert">
        <h1 className="m-0 text-xl text-[var(--theme-title)]">平台初始化失败</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--theme-muted)]">{error.message}</p>
      </section>
    </main>,
  );
}

function requireRootElement(): HTMLElement {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Desktop root element is missing.");
  }
  return root;
}

void bootstrap();
