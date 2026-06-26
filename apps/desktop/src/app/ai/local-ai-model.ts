import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_AI_MODEL_PROGRESS_EVENT,
  toLocalAiModelCommandStatus,
  type LocalAiModelCommandStatus
} from "./local-ai-model-state";

export type { LocalAiModelCommandStatus } from "./local-ai-model-state";
export { mergeLocalAiModelStatus } from "./local-ai-model-state";

export async function readLocalAiModelStatus(modelId = DEFAULT_LOCAL_MODEL_ID): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    return toLocalAiModelCommandStatus({ modelId });
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("get_local_ai_model_status", { modelId })
  );
}

export async function downloadLocalAiModel(modelId = DEFAULT_LOCAL_MODEL_ID): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持下载本地模型，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("download_local_ai_model", { modelId })
  );
}

export async function cancelLocalAiModelDownload(modelId = DEFAULT_LOCAL_MODEL_ID): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持取消本地模型下载，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("cancel_local_ai_model_download", { modelId })
  );
}

export async function deleteLocalAiModel(modelId = DEFAULT_LOCAL_MODEL_ID): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持删除本地模型，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("delete_local_ai_model", { modelId })
  );
}

export function listenToLocalAiModelProgress(
  handler: (status: LocalAiModelCommandStatus) => void
): (() => void) | undefined {
  let unlisten: (() => void) | undefined;
  let disposed = false;

  if (!isTauri()) {
    return undefined;
  }

  void listen<Partial<LocalAiModelCommandStatus>>(LOCAL_AI_MODEL_PROGRESS_EVENT, (event) => {
    handler(toLocalAiModelCommandStatus(event.payload));
  }).then((dispose) => {
    if (disposed) {
      dispose();
      return;
    }
    unlisten = dispose;
  });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = undefined;
  };
}
