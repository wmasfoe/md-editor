/**
 * @fileoverview 跨端统一设置窗口/弹窗骨架容器 (Settings Shell)
 */

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "../ConfirmActionDialog";
import { settingsDescriptionClassName } from "./settings-styles";

export interface SettingsTabItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly panel: ReactNode;
}

export interface SettingsShellProps {
  /** 呈现形态：page 铺满容器（桌面主窗口/独立窗口），modal 居中弹窗遮罩（Web/uTools） */
  readonly variant?: "page" | "modal";
  /** 模态框是否可见（仅 variant="modal" 时有效） */
  readonly open?: boolean;
  /** 设置窗口大标题（默认：设置） */
  readonly title?: string;
  /** 设置窗口副标题（可选，不传则仅展示单行标题） */
  readonly subtitle?: string;
  /** 标签页清单 */
  readonly tabs: readonly SettingsTabItem[];
  /** 当前激活的标签页索引 */
  readonly selectedTabIndex: number;
  /** 切换标签页回调 */
  readonly onSelectTab: (index: number) => void;
  /** 取消/关闭回调 */
  readonly onClose: () => void;
  /** 保存回调（若提供则展示保存按钮） */
  readonly onSave?: () => void;
  /** 保存中状态 */
  readonly isSaving?: boolean;
  /** 错误信息提示横幅 */
  readonly errorMessage?: string | null;
  /** 拖拽窗口事件回调（供 Tauri 原生窗体拖拽） */
  readonly onStartWindowDrag?: (event: MouseEvent<HTMLElement>) => void;
  /** 顶栏右侧额外操作区（例如 uTools 的右上角关闭图标） */
  readonly headerExtra?: ReactNode;
  /** 底栏左侧额外操作区 */
  readonly footerExtra?: ReactNode;
  readonly cancelText?: string;
  readonly saveText?: string;
  readonly loadingText?: string;
}

export function SettingsShell({
  variant = "page",
  open = true,
  title = "设置",
  subtitle,
  tabs,
  selectedTabIndex,
  onSelectTab,
  onClose,
  onSave,
  isSaving = false,
  errorMessage,
  onStartWindowDrag,
  headerExtra,
  footerExtra,
  cancelText = "取消",
  saveText = "保存",
  loadingText = "保存中…",
}: SettingsShellProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, onClose]);

  if (variant === "modal" && !open) {
    return null;
  }

  const content = (
    <section
      className={`flex h-full min-h-0 w-full flex-col bg-[var(--theme-surface)] text-[var(--theme-text)] ${
        variant === "modal"
          ? "h-[min(640px,calc(100vh-32px))] w-[min(880px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-[var(--theme-border)] shadow-[var(--theme-shadow)] select-none"
          : ""
      }`}
      aria-labelledby="settings-shell-title"
    >
      <header
        data-tauri-drag-region={onStartWindowDrag ? true : undefined}
        className="flex min-h-[54px] shrink-0 items-center justify-between gap-4 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5"
        onMouseDown={onStartWindowDrag}
      >
        <div data-tauri-drag-region={onStartWindowDrag ? true : undefined} className="min-w-0">
          <h1
            id="settings-shell-title"
            className="m-0 text-[17px] font-semibold leading-[1.35] text-[var(--theme-title)]"
          >
            {title}
          </h1>
          {subtitle ? <p className={settingsDescriptionClassName}>{subtitle}</p> : null}
        </div>
        {headerExtra ? <div className="shrink-0">{headerExtra}</div> : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabGroup
          vertical
          selectedIndex={selectedTabIndex}
          onChange={onSelectTab}
          className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]"
        >
          <aside className="min-h-0 border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-4 max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:py-2">
            <TabList
              className="flex flex-col gap-1 max-[720px]:flex-row max-[720px]:overflow-x-auto"
              aria-label={title}
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  className={({ selected }) =>
                    [
                      "grid min-h-[46px] w-full min-w-0 grid-cols-1 rounded-[6px] border-0 px-3 py-2 text-left outline-none transition-colors max-[720px]:min-w-[132px]",
                      selected
                        ? "bg-[var(--theme-control-active)] text-[var(--theme-title)]"
                        : "bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]",
                    ].join(" ")
                  }
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-[1.3]">
                    {tab.label}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.35] text-[var(--theme-muted)]">
                    {tab.description}
                  </span>
                </Tab>
              ))}
            </TabList>
          </aside>
          <TabPanels className="min-h-0 overflow-auto bg-[var(--theme-surface)]">
            {tabs.map((tab) => (
              <TabPanel key={tab.id} className="min-h-full outline-none">
                <div className="mx-auto grid w-full max-w-[760px] gap-5 px-7 py-6 max-[760px]:px-4">
                  {tab.panel}
                </div>
              </TabPanel>
            ))}
          </TabPanels>
        </TabGroup>

        {errorMessage ? (
          <p
            className="mx-auto mb-0 mt-[-2px] w-[min(920px,calc(100%_-_48px))] rounded-md border border-[rgba(227,15,46,0.22)] bg-[var(--theme-danger-bg)] px-2.5 py-2 text-xs text-[var(--theme-danger-text)] max-[760px]:w-[calc(100%_-_32px)]"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-3.5">
          <div>{footerExtra}</div>
          <div className="flex items-center gap-2">
            <button type="button" className={dialogButtonClassName} onClick={onClose}>
              {cancelText}
            </button>
            {onSave ? (
              <button
                type="button"
                className={primaryDialogButtonClassName}
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? loadingText : saveText}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </section>
  );

  if (variant === "modal") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 select-none"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {content}
      </div>
    );
  }

  return content;
}
