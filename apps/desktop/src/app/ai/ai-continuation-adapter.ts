import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  type AiCompletionContext,
  type AiSettings,
  requestAiContinuation,
  type AiContinuationRequestOptions,
} from "@md-editor/ai";

export async function requestDesktopAiContinuation(
  settings: AiSettings,
  context: AiCompletionContext,
  options: AiContinuationRequestOptions = {},
) {
  return requestAiContinuation(settings, context, {
    ...options,
    ...(settings.provider === "local" ? { localInvokeImpl: invokeLocalAiContinuation } : {}),
  });
}

async function invokeLocalAiContinuation(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  if (!isTauri()) {
    throw new Error("桌面端才能调用本地模型。");
  }

  return invoke(command, args);
}
