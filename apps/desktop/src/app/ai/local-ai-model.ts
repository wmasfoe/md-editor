import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BUILTIN_LOCAL_MODELS,
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_AI_MODEL_PROGRESS_EVENT,
  toLocalAiModelCommandStatus,
  type LocalAiModelCommandStatus,
  type SystemSpecs,
} from "./local-ai-model-state";

export type { LocalAiModelCommandStatus, SystemSpecs } from "./local-ai-model-state";
export {
  BUILTIN_LOCAL_MODELS,
  formatSystemSpecsLabel,
  getRecommendedModelId,
  mergeLocalAiModelStatus,
} from "./local-ai-model-state";

export const desktopLocalAiInvokeImpl = async (
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> => {
  if (!isTauri()) {
    throw new Error("Web 预览模式不支持本地模型推理，请在桌面端使用。");
  }
  const isDev = import.meta.env.DEV;
  const isCompletion = command === "request_local_ai_continuation";
  const startTime = isDev && isCompletion ? performance.now() : 0;

  const options = (args?.options as Record<string, unknown>) || {};
  const intent = String(options.intent ?? "unknown");
  const taskLabel =
    intent === "editing"
      ? "【阶段 1：语法修复审校 (GEC)】"
      : intent === "continuation"
        ? "【阶段 2：行内续写补全 (FIM)】"
        : `【综合分析 (${intent})】`;

  if (isDev && isCompletion) {
    console.groupCollapsed(`🤖 [Local LLM 发起请求] ${taskLabel}`);
    console.log("模型 ID:", options.modelId);
    console.log("任务类型 (Intent):", intent);
    console.log("停用词 (Stop Tokens):", options.stop);
    console.log("输入 Prompt:\n" + String(options.prompt ?? ""));
    console.groupEnd();
  }

  const result = await invoke(command, args);

  if (isDev && isCompletion) {
    const elapsedMs = (performance.now() - startTime).toFixed(1);
    console.group(`✨ [Local LLM 响应结果] ${taskLabel} (${elapsedMs}ms)`);
    console.log("【LLM 原样返回 (Raw Output)】:\n", result);
    console.debug("调用详情:", {
      modelId: options.modelId,
      intent,
      elapsedMs: `${elapsedMs}ms`,
    });
    console.groupEnd();
  }

  return result;
};

export async function readSystemSpecs(): Promise<SystemSpecs | null> {
  if (!isTauri()) {
    return {
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      cpuArch: "aarch64",
      os: "macos",
      cpuCores: 8,
    };
  }

  try {
    return await invoke<SystemSpecs>("get_system_specs");
  } catch (error) {
    console.warn("读取系统硬件配置失败", error);
    return null;
  }
}

export async function readLocalAiModelStatus(
  modelId = DEFAULT_LOCAL_MODEL_ID,
): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    return toLocalAiModelCommandStatus({ modelId });
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("get_local_ai_model_status", { modelId }),
  );
}

export async function readAllLocalAiModelsStatus(): Promise<LocalAiModelCommandStatus[]> {
  if (!isTauri()) {
    return BUILTIN_LOCAL_MODELS.map((descriptor) =>
      toLocalAiModelCommandStatus({
        modelId: descriptor.id,
        displayName: descriptor.displayName,
        isAvailableTier: descriptor.isAvailable,
        totalBytes: descriptor.downloadSizeBytes,
      }),
    );
  }

  try {
    const statuses = await invoke<Array<Partial<LocalAiModelCommandStatus>>>(
      "get_all_local_ai_models_status",
    );
    return statuses.map((status) => toLocalAiModelCommandStatus(status));
  } catch {
    const fallback = await readLocalAiModelStatus(DEFAULT_LOCAL_MODEL_ID);
    return [fallback];
  }
}

export async function checkLocalAiModelsRemoteUpdate(): Promise<LocalAiModelCommandStatus[]> {
  if (!isTauri()) {
    return readAllLocalAiModelsStatus();
  }

  try {
    const statuses = await invoke<Array<Partial<LocalAiModelCommandStatus>>>(
      "check_local_ai_model_updates",
    );
    return statuses.map((status) => toLocalAiModelCommandStatus(status));
  } catch {
    return readAllLocalAiModelsStatus();
  }
}


export async function downloadLocalAiModel(
  modelId = DEFAULT_LOCAL_MODEL_ID,
): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持下载本地模型，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("download_local_ai_model", { modelId }),
  );
}

export async function cancelLocalAiModelDownload(
  modelId = DEFAULT_LOCAL_MODEL_ID,
): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持取消本地模型下载，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("cancel_local_ai_model_download", { modelId }),
  );
}

export async function deleteLocalAiModel(
  modelId = DEFAULT_LOCAL_MODEL_ID,
): Promise<LocalAiModelCommandStatus> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持删除本地模型，请在桌面端使用。");
  }

  return toLocalAiModelCommandStatus(
    await invoke<Partial<LocalAiModelCommandStatus>>("delete_local_ai_model", { modelId }),
  );
}

export function listenToLocalAiModelProgress(
  handler: (status: LocalAiModelCommandStatus) => void,
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
