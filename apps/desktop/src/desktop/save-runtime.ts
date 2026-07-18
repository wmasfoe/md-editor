import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NativeSaveRuntimeRegistration } from "@md-editor/file-system";
export { MAIN_WINDOW_LABEL } from "./window-labels";

type NativeAttachSaveRuntimeResult =
  | {
      readonly status: "attached";
      readonly epoch: number;
      readonly id: number;
      readonly sequenceSeed: number;
    }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "indeterminate"; readonly errorCode: string };

export class SaveRuntimeAttachError extends Error {
  readonly code: "NOT_DESKTOP" | "REJECTED" | "INDETERMINATE" | "INVALID_PAYLOAD";

  constructor(code: SaveRuntimeAttachError["code"], message: string) {
    super(message);
    this.name = "SaveRuntimeAttachError";
    this.code = code;
  }
}

export async function attachSaveRuntime(): Promise<NativeSaveRuntimeRegistration> {
  if (!isTauri()) {
    throw new SaveRuntimeAttachError(
      "NOT_DESKTOP",
      "The native save runtime is only available in the Tauri main WebView.",
    );
  }

  const payload = await invoke<NativeAttachSaveRuntimeResult>("attach_save_runtime");
  if (payload.status === "rejected") {
    throw new SaveRuntimeAttachError("REJECTED", payload.reason);
  }
  if (payload.status === "indeterminate") {
    throw new SaveRuntimeAttachError("INDETERMINATE", payload.errorCode);
  }
  if (
    payload.status !== "attached" ||
    !isPositiveSafeInteger(payload.epoch) ||
    !isPositiveSafeInteger(payload.id) ||
    !isNonNegativeSafeInteger(payload.sequenceSeed)
  ) {
    throw new SaveRuntimeAttachError(
      "INVALID_PAYLOAD",
      "The native save runtime returned an invalid registration payload.",
    );
  }

  return Object.freeze({
    epoch: payload.epoch,
    id: payload.id,
    sequenceSeed: payload.sequenceSeed,
  });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
