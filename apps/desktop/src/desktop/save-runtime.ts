/**
 * @file save-runtime.ts
 * @module apps/desktop/desktop/save-runtime
 * @description
 * 桌面端原生落盘运行时附着与初始化。
 *
 * 负责在主窗口启动或刷新后，向 Rust 后端申请挂载保存运行时凭证（Epoch, ID, Sequence Seed），
 * 确保前端与后端的保存并发状态机保持严格同步。
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NativeSaveRuntimeRegistration } from "@md-editor/file-system";
export { MAIN_WINDOW_LABEL } from "./window-labels";

/** 后端 `attach_save_runtime` 的原生响应类型 */
type NativeAttachSaveRuntimeResult =
  | {
      readonly status: "attached";
      readonly epoch: number;
      readonly id: number;
      readonly sequenceSeed: number;
    }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "indeterminate"; readonly errorCode: string };

/**
 * 附着保存运行时过程中抛出的结构化异常。
 */
export class SaveRuntimeAttachError extends Error {
  readonly code: "NOT_DESKTOP" | "REJECTED" | "INDETERMINATE" | "INVALID_PAYLOAD";

  constructor(code: SaveRuntimeAttachError["code"], message: string) {
    super(message);
    this.name = "SaveRuntimeAttachError";
    this.code = code;
  }
}

/**
 * 向后端注册并附着主窗口的保存运行时。
 *
 * 仅允许在 Tauri 主窗口环境中调用；若为从属窗口（如设置窗口）调用，后端将直接拒绝。
 *
 * @returns 注册成功的结构化凭证对象（包含纪元号、凭据 ID、序号种子）
 */
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
