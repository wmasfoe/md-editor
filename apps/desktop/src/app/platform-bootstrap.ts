import {
  MAIN_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  type DesktopWindowSurface,
} from "../desktop/window-labels";

export interface MainPlatformServices<TFileService> {
  readonly fileService: TFileService;
}

export interface DesktopPlatformBootstrap<TRegistration, TFileService> {
  readonly surface: DesktopWindowSurface;
  readonly attachMainSaveRuntime: () => Promise<TRegistration>;
  readonly createMainFileService: (registration: TRegistration) => Promise<TFileService>;
  readonly renderMain: (services: MainPlatformServices<TFileService>) => Promise<void> | void;
  readonly renderSettings: () => Promise<void> | void;
  readonly renderInitializationError: (error: DesktopPlatformInitializationError) => void;
}

export class DesktopPlatformInitializationError extends Error {
  readonly code: "UNKNOWN_WINDOW" | "MAIN_INITIALIZATION_FAILED";
  readonly cause?: unknown;

  constructor(
    code: DesktopPlatformInitializationError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = "DesktopPlatformInitializationError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export async function bootstrapDesktopPlatform<TRegistration, TFileService>(
  input: DesktopPlatformBootstrap<TRegistration, TFileService>,
): Promise<void> {
  if (input.surface === SETTINGS_WINDOW_LABEL) {
    await input.renderSettings();
    return;
  }

  if (input.surface !== MAIN_WINDOW_LABEL) {
    input.renderInitializationError(
      new DesktopPlatformInitializationError(
        "UNKNOWN_WINDOW",
        `Unsupported desktop window label: ${input.surface.label}`,
      ),
    );
    return;
  }

  try {
    // Registration and the single scheduler instance belong to the platform
    // lifecycle. React StrictMode may remount adapters without recreating either.
    const registration = await input.attachMainSaveRuntime();
    const fileService = await input.createMainFileService(registration);
    await input.renderMain(Object.freeze({ fileService }));
  } catch (cause) {
    input.renderInitializationError(
      new DesktopPlatformInitializationError(
        "MAIN_INITIALIZATION_FAILED",
        "Markdown Editor could not initialize the desktop file runtime.",
        { cause },
      ),
    );
  }
}
