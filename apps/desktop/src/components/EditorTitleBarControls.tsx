/**
 * @file EditorTitleBarControls.tsx
 * @module apps/desktop/components/EditorTitleBarControls
 * @description
 * macOS 风格编辑器自定义标题栏控制区组件。
 *
 * 位于主窗口右上角，包含：
 * 1. 软件更新提示与快速升级触发按钮；
 * 2. AI 智能写作快捷助手菜单（语法纠错、行内续写、AI 设置）；
 * 3. 实时文档统计信息微件（字数、行数、字符数切换）；
 * 4. 大纲导航 Popover 弹窗（点击跳转到文档各级标题）；
 * 5. 工作空间侧边栏显隐切换按钮。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@md-editor/i18n";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import {
  ChevronUpDownIcon,
  ListBulletIcon,
  RectangleGroupIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import {
  calculateDocumentMetrics,
  getDocumentMetricLabel,
  type DocumentMetricKind,
} from "../app/document-metrics";
import { useDocumentSnapshot } from "../app/document-store";
import { useAppSettings } from "../app/settings-context";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { useSidebarStore } from "../app/stores/sidebar-store";
import { isUpdateActionBusy, shouldShowEditorUpdateAction } from "../app/updates/update-status";
import { useEditorUiActions, useEditorUiState } from "@md-editor/editor-ui";
import { editorUpdateActionLabel } from "./settings/settingsUtils";
import { cx } from "../lib/cx";

/** 标题栏次要图标按钮通用 CSS 类 */
const titleBarSecondaryButtonClassName =
  "invisible grid size-[28px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] opacity-0 transition-[visibility,opacity,background-color,color] duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] group-hover/titlebar-controls:visible group-hover/titlebar-controls:opacity-100 group-focus-within/titlebar-controls:visible group-focus-within/titlebar-controls:opacity-100 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

/** 支持的文档度量指标列表 */
const documentMetricKinds: readonly DocumentMetricKind[] = ["words", "lines", "characters"];

/**
 * 编辑器标题栏控制组件。
 */
export function EditorTitleBarControls() {
  const { t } = useTranslation();
  const { updateStatus, openSettings } = useAppSettings();
  const { outline, activeOutlineId } = useEditorUiState();
  const { jumpToTocItem } = useEditorUiActions();
  const { hasActiveDocument } = useDocumentUiStore();
  const { runEditorUpdateAction, dispatchCommand } = useDesktopEditorActions();
  const { isSidebarVisible, setIsSidebarVisible } = useSidebarStore();

  const showUpdateAction = shouldShowEditorUpdateAction(updateStatus);
  const updateBusy = isUpdateActionBusy(updateStatus);
  const updateActionLabel = editorUpdateActionLabel(updateStatus);

  const [metricKind, setMetricKind] = useState<DocumentMetricKind>("words");
  const { markdown } = useDocumentSnapshot();
  const metrics = useMemo(() => calculateDocumentMetrics(markdown), [markdown]);

  return (
    <div className="group/titlebar-controls flex h-[30px] items-center gap-1 text-[var(--theme-control-text)] focus-within:[--titlebar-secondary-opacity:1] hover:[--titlebar-secondary-opacity:1]">
      {showUpdateAction ? (
        <button
          type="button"
          className="h-[22px] cursor-pointer rounded-[5px] border border-[var(--theme-primary)] bg-[var(--theme-primary)] px-2 text-[12px] font-medium leading-none text-white shadow-[0_1px_0_rgba(0,0,0,0.12)] hover:bg-[color-mix(in_srgb,var(--theme-primary)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] disabled:cursor-default disabled:opacity-70"
          onClick={() => void runEditorUpdateAction()}
          disabled={updateBusy}
        >
          {updateActionLabel}
        </button>
      ) : null}
      {hasActiveDocument ? (
        <>
          <AiWritingMenu
            onFixGrammar={() => void dispatchCommand("ai.fixGrammar")}
            onContinueWriting={() => void dispatchCommand("ai.continueWriting")}
            onOpenSettings={openSettings}
          />
          <DocumentMetricMenu
            metricKind={metricKind}
            metrics={metrics}
            onMetricKindChange={setMetricKind}
          />
          <OutlinePopover
            outline={outline}
            activeOutlineId={activeOutlineId}
            onJumpToOutlineItem={jumpToTocItem}
          />
        </>
      ) : null}
      <button
        type="button"
        className={titleBarSecondaryButtonClassName}
        aria-label={
          isSidebarVisible ? t("editor.titleBar.hideSidebar") : t("editor.titleBar.showSidebar")
        }
        title={
          isSidebarVisible ? t("editor.titleBar.hideSidebar") : t("editor.titleBar.showSidebar")
        }
        onClick={() => setIsSidebarVisible(!isSidebarVisible)}
      >
        <RectangleGroupIcon aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * AI 智能写作快捷助手菜单微件。
 */
function AiWritingMenu({
  onFixGrammar,
  onContinueWriting,
  onOpenSettings,
}: {
  /** 触发语法纠错指令 */
  readonly onFixGrammar: () => void;
  /** 触发续写指令 */
  readonly onContinueWriting: () => void;
  /** 打开设置面板 */
  readonly onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className={cx(titleBarSecondaryButtonClassName, "focus-visible:opacity-100")}
        aria-label={t("editor.titleBar.aiAssistant")}
        title={t("editor.titleBar.aiAssistant")}
      >
        <SparklesIcon aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 6, padding: 8 }}
        className="z-[70] min-w-[200px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 text-[13px] text-[var(--theme-control-text)] shadow-[var(--theme-shadow)] outline-none backdrop-blur-xl"
      >
        <MenuItem>
          {({ focus }) => (
            <button
              type="button"
              className={cx(
                "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-control-text)]",
                focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
              )}
              onClick={onFixGrammar}
            >
              <span>{t("editor.titleBar.aiFixGrammar")}</span>
              <kbd className="text-[11px] font-sans text-[var(--theme-muted)]">⇧⌘G</kbd>
            </button>
          )}
        </MenuItem>
        <MenuItem>
          {({ focus }) => (
            <button
              type="button"
              className={cx(
                "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-control-text)]",
                focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
              )}
              onClick={onContinueWriting}
            >
              <span>{t("editor.titleBar.aiContinueWriting")}</span>
              <kbd className="text-[11px] font-sans text-[var(--theme-muted)]">⇧⌘A</kbd>
            </button>
          )}
        </MenuItem>
        <div className="my-1 border-t border-[var(--theme-border)]" />
        <MenuItem>
          {({ focus }) => (
            <button
              type="button"
              className={cx(
                "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-muted)]",
                focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
              )}
              onClick={onOpenSettings}
            >
              <span>{t("editor.titleBar.aiSettings")}</span>
            </button>
          )}
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}

/**
 * 文档度量指标切换微件（词数、行数、字符数）。
 */
function DocumentMetricMenu({
  metricKind,
  metrics,
  onMetricKindChange,
}: {
  /** 当前选中的度量指标类别 */
  readonly metricKind: DocumentMetricKind;
  /** 文档实时度量数值集合 */
  readonly metrics: ReturnType<typeof calculateDocumentMetrics>;
  /** 指标切换回调 */
  readonly onMetricKindChange: (kind: DocumentMetricKind) => void;
}) {
  const { t } = useTranslation();
  const metricLabels: Record<DocumentMetricKind, string> = {
    words: t("editor.metrics.words"),
    lines: t("editor.metrics.lines"),
    characters: t("editor.metrics.characters"),
  };

  return (
    <Menu as="div" className="relative">
      <MenuButton className="flex h-[28px] min-w-[76px] items-center justify-center gap-1 rounded-[5px] border-0 bg-transparent px-2 text-[13px] font-medium leading-none text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]">
        <span>{getDocumentMetricLabel(metricKind, metrics)}</span>
        <ChevronUpDownIcon className="size-3.5 shrink-0 stroke-[1.5]" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 6, padding: 8 }}
        className="z-[70] min-w-[132px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 text-[13px] text-[var(--theme-control-text)] shadow-[var(--theme-shadow)] outline-none backdrop-blur-xl"
      >
        {documentMetricKinds.map((kind) => (
          <MenuItem key={kind}>
            {({ focus }) => (
              <button
                type="button"
                className={cx(
                  "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-control-text)]",
                  focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
                  metricKind === kind && "font-[560] text-[var(--theme-title)]",
                )}
                onClick={() => onMetricKindChange(kind)}
              >
                <span>{metricLabels[kind]}</span>
                <span className="text-[12px] text-[var(--theme-muted)]">
                  {getDocumentMetricLabel(kind, metrics)}
                </span>
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

/**
 * 文档大纲（TOC）气泡微件。
 */
function OutlinePopover({
  outline,
  activeOutlineId,
  onJumpToOutlineItem,
}: {
  /** 提取的大纲条目列表 */
  readonly outline: readonly {
    readonly id: string;
    readonly level: number;
    readonly text: string;
    readonly line: number;
  }[];
  /** 当前阅读位置对应的活跃标题 ID */
  readonly activeOutlineId: string | null;
  /** 点击标题跳转回调 */
  readonly onJumpToOutlineItem: (target: {
    readonly line: number;
    readonly level: number;
    readonly text: string;
  }) => void;
}) {
  const { t } = useTranslation();

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton
            className={titleBarSecondaryButtonClassName}
            aria-label={t("editor.outline.title")}
            title={t("editor.outline.title")}
          >
            <ListBulletIcon aria-hidden="true" />
          </PopoverButton>
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 12, padding: 12 }}
            className="z-[70] w-[min(360px,calc(100vw_-_32px))] rounded-[12px] border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-[var(--theme-shadow)] outline-none backdrop-blur-xl"
          >
            <span
              className="absolute right-[16px] top-[-6px] size-3 rotate-45 border-l border-t border-[var(--theme-border)] bg-[var(--theme-surface)]"
              aria-hidden="true"
            />
            <div className="relative z-10 flex h-[48px] items-center border-b border-[var(--theme-border)] px-4">
              <h2 className="m-0 text-[17px] font-semibold leading-none text-[var(--theme-title)]">
                {t("editor.outline.title")}
              </h2>
            </div>
            {outline.length === 0 ? (
              <p className="m-0 px-4 py-5 text-[13px] leading-5 text-[var(--theme-control-subtle)]">
                {t("editor.outline.empty")}
              </p>
            ) : (
              <nav
                className="max-h-[min(420px,calc(100vh_-_120px))] overflow-auto p-2"
                aria-label={t("editor.outline.navAria")}
              >
                {outline.map((item) => {
                  const active = item.id === activeOutlineId;
                  return (
                    <button
                      type="button"
                      key={`${item.id}-${item.line}`}
                      className={cx(
                        "flex min-h-8 w-full items-center rounded-[6px] border-0 bg-transparent py-1 pr-2 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
                        active &&
                          "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]",
                      )}
                      style={{ paddingLeft: 10 + (item.level - 1) * 14 }}
                      title={item.text}
                      aria-current={active ? "location" : undefined}
                      onClick={() => {
                        close();
                        requestAnimationFrame(() => {
                          onJumpToOutlineItem({
                            line: item.line,
                            level: item.level,
                            text: item.text,
                          });
                        });
                      }}
                    >
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
