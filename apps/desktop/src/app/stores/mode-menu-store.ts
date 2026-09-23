/**
 * @file mode-menu-store.ts
 * @description 视图模式（专注/打字机）**菜单勾选态请求**的记录。
 *
 * 背景（S1(b)）：原生 macOS 菜单的勾选态由 Rust 侧镜像渲染（`set_mode_menu_checked` + 重建读回），
 * 浏览器内 E2E **无法断言原生菜单**。为让「两条切换路径（原生菜单事件 / 命令面板）都写到同一镜像」
 * 可被自动化验证，宿主在每次请求写入时同时记录在这里，并由 E2E 桥面暴露（`getModeMenuChecks`）。
 *
 * 语义：仅记录**最近一次请求**的真实开关态（不是猜测）；真实权威仍在 renderer 的
 * `focusModeField` / `typewriterModeField`（见 docs/agent/product/editor_view_modes.md）。
 */

export interface ModeMenuChecks {
  focus: boolean;
  typewriter: boolean;
}

const state: ModeMenuChecks = { focus: false, typewriter: false };

/** 记录一次勾选态请求（mode 未知时忽略，不静默产生错误状态） */
export function recordModeMenuChecked(mode: "focus" | "typewriter", checked: boolean): void {
  state[mode] = checked;
}

/** 读取当前镜像请求态（E2E/调试用；返回副本，调用方不可改内部状态） */
export function getModeMenuChecks(): ModeMenuChecks {
  return { ...state };
}
