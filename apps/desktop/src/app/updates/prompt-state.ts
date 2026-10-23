/**
 * @fileoverview 更新提示簿记的读写与规范化
 *
 * 只记录「已提示过的版本」与「用户跳过的版本」，用于同版本只打扰一次。
 * 持久化由 Rust 侧负责（`app_data_dir()/update-prompt.json`），这里保持 fail-soft：
 * 簿记失败最多导致多提示一次，绝不阻塞更新流程。
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

/** 更新提示簿记。字段缺省表示从未提示/从未跳过。 */
export interface UpdatePromptState {
  readonly lastNotifiedVersion?: string;
  readonly skippedVersion?: string;
}

const EMPTY_STATE: UpdatePromptState = Object.freeze({});

/**
 * 簿记变更广播：主窗口与设置窗口都会写「跳过此版本」，
 * 但每个窗口各自持有一份内存快照。没有这条事件时，
 * 设置窗口跳过某版本后主窗口仍会在同一会话的周期检查里再次提示。
 */
export const UPDATE_PROMPT_CHANGED_EVENT = "md-editor-update-prompt-changed";

/** 规范化版本号：去空白、去 `v` 前缀、空值视为缺省。 */
export function normalizeVersion(version: unknown): string | undefined {
  if (typeof version !== "string") {
    return undefined;
  }
  const normalized = version.trim().replace(/^v/iu, "");
  return normalized === "" ? undefined : normalized;
}

/** 规范化来自 Rust 或测试的任意输入；无法识别的字段直接丢弃。 */
export function normalizeUpdatePromptState(input: unknown): UpdatePromptState {
  if (!input || typeof input !== "object") {
    return EMPTY_STATE;
  }

  const record = input as Record<string, unknown>;
  const lastNotifiedVersion = normalizeVersion(record.lastNotifiedVersion);
  const skippedVersion = normalizeVersion(record.skippedVersion);

  if (!lastNotifiedVersion && !skippedVersion) {
    return EMPTY_STATE;
  }

  return {
    ...(lastNotifiedVersion ? { lastNotifiedVersion } : {}),
    ...(skippedVersion ? { skippedVersion } : {}),
  };
}

/** 读取簿记；非 Tauri 环境或读取失败时返回空状态。 */
export async function loadUpdatePromptState(): Promise<UpdatePromptState> {
  if (!isTauri()) {
    return EMPTY_STATE;
  }

  try {
    return normalizeUpdatePromptState(await invoke("load_update_prompt_state"));
  } catch (error) {
    console.warn("读取更新提示状态失败", error);
    return EMPTY_STATE;
  }
}

// 写入串行化：快速点击「稍后 / 跳过」时，后一次写入必须基于最新快照，避免旧值覆盖。
let writeQueue: Promise<void> = Promise.resolve();

/** 保存簿记；失败只告警，不影响调用方后续动作。 */
export function saveUpdatePromptState(state: UpdatePromptState): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }

  writeQueue = writeQueue.then(async () => {
    try {
      await invoke("save_update_prompt_state", { state });
      await emit(UPDATE_PROMPT_CHANGED_EVENT, state);
    } catch (error) {
      console.warn("保存更新提示状态失败", error);
    }
  });
  return writeQueue;
}

/**
 * 订阅其他窗口写入的簿记。
 * 返回取消订阅函数；非 Tauri 环境返回 undefined。
 */
export function listenUpdatePromptStateChanged(
  handler: (state: UpdatePromptState) => void,
): (() => void) | undefined {
  if (!isTauri()) {
    return undefined;
  }

  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<unknown>(UPDATE_PROMPT_CHANGED_EVENT, (event) => {
    handler(normalizeUpdatePromptState(event.payload));
  })
    .then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    })
    .catch((error: unknown) => {
      console.warn("订阅更新提示状态失败", error);
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
}
