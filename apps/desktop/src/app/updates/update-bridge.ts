/**
 * @fileoverview 主窗口与设置窗口之间的更新状态桥
 *
 * tauri-plugin-updater 把待安装的更新与下载好的字节存放在**发起调用的 webview** 的资源表里，
 * 两个窗口各自调用就会各下一份、各装一次。因此约定：
 * - 主窗口是更新流程的唯一执行者，状态变化后广播快照；
 * - 设置窗口只订阅快照，按钮动作通过命令事件交给主窗口执行。
 */

import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { safeUnlisten } from "../../desktop/safe-unlisten";
import type { UpdateStatus } from "../settings/app-settings";

/** 主窗口广播的更新状态快照。 */
export interface UpdateSnapshot {
  readonly status: UpdateStatus;
  /** 最近一次检查完成时间（ISO 字符串）；从未检查为 null */
  readonly lastCheckedAt: string | null;
}

/**
 * 设置窗口发给主窗口的动作。
 * - `sync`：设置窗口刚打开，请主窗口重发一次快照；
 * - `check` / `download`：手动检查、手动下载；
 * - `apply`：安装并重启，由主窗口完成未保存文档确认后执行。
 */
export type UpdateCommand = "sync" | "check" | "download" | "apply";

const UPDATE_SNAPSHOT_EVENT = "md-editor-update-snapshot";
const UPDATE_COMMAND_EVENT = "md-editor-update-command";
const UPDATE_COMMANDS: readonly UpdateCommand[] = ["sync", "check", "download", "apply"];

/** 主窗口：广播当前快照。失败只告警，不影响主窗口自身流程。 */
export function publishUpdateSnapshot(snapshot: UpdateSnapshot): void {
  if (!isTauri()) return;
  void emit(UPDATE_SNAPSHOT_EVENT, snapshot).catch((error: unknown) => {
    console.warn("广播更新状态失败", error);
  });
}

/** 设置窗口：把动作交给主窗口执行。 */
export function sendUpdateCommand(command: UpdateCommand): void {
  if (!isTauri()) return;
  void emit(UPDATE_COMMAND_EVENT, command).catch((error: unknown) => {
    console.warn("发送更新命令失败", error);
  });
}

/**
 * 设置窗口：订阅主窗口的快照，订阅生效后立即请求一次当前快照。
 * 先订阅再请求，避免主窗口的回复早于监听注册而丢失。返回取消订阅函数。
 */
export function listenUpdateSnapshot(
  handler: (snapshot: UpdateSnapshot) => void,
): (() => void) | undefined {
  return listenTauriEvent<UpdateSnapshot>(
    UPDATE_SNAPSHOT_EVENT,
    (payload) => {
      if (payload && typeof payload === "object" && "status" in payload) {
        handler(payload);
      }
    },
    () => sendUpdateCommand("sync"),
  );
}

/** 主窗口：订阅设置窗口的动作。未知动作直接丢弃。 */
export function listenUpdateCommands(
  handler: (command: UpdateCommand) => void,
): (() => void) | undefined {
  return listenTauriEvent<unknown>(UPDATE_COMMAND_EVENT, (payload) => {
    if (UPDATE_COMMANDS.includes(payload as UpdateCommand)) {
      handler(payload as UpdateCommand);
    }
  });
}

/** 订阅一个 Tauri 事件，处理「注册完成前就已卸载」的竞态；`onReady` 在订阅生效后调用。 */
function listenTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
  onReady?: () => void,
): (() => void) | undefined {
  if (!isTauri()) return undefined;

  let disposed = false;
  let unlisten: (() => void | Promise<void>) | undefined;
  void listen<T>(event, (message) => handler(message.payload))
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
      onReady?.();
    })
    .catch((error: unknown) => {
      console.warn(`订阅 ${event} 失败`, error);
    });

  return () => {
    disposed = true;
    const fn = unlisten;
    unlisten = undefined;
    safeUnlisten(fn);
  };
}
