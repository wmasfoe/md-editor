import { useMemo, useState } from "react";
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
} from "@heroicons/react/24/outline";
import {
  calculateDocumentMetrics,
  getDocumentMetricLabel,
  type DocumentMetricKind,
} from "../app/document-metrics";
import { useDocumentSnapshot } from "../app/document-store";
import { useAppSettings } from "../app/settings-context";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { useOutlineStore } from "../app/stores/outline-store";
import { useSidebarStore } from "../app/stores/sidebar-store";
import {
  isUpdateActionBusy,
  shouldShowEditorUpdateAction,
} from "../app/updates/update-status";
import { editorUpdateActionLabel } from "./settings/settingsUtils";
import { cx } from "../lib/cx";

const titleBarSecondaryButtonClassName =
  "invisible grid size-[28px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] opacity-0 transition-[visibility,opacity,background-color,color] duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] group-hover/titlebar-controls:visible group-hover/titlebar-controls:opacity-100 group-focus-within/titlebar-controls:visible group-focus-within/titlebar-controls:opacity-100 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

const documentMetricOptions: readonly { readonly kind: DocumentMetricKind; readonly label: string }[] = [
  { kind: "words", label: "词数" },
  { kind: "lines", label: "行数" },
  { kind: "characters", label: "字符数" },
];

export function EditorTitleBarControls() {
  const { updateStatus } = useAppSettings();
  const { outline, activeOutlineId, jumpToTocItem } = useOutlineStore();
  const { hasActiveDocument, runEditorUpdateAction } = useDocumentUiStore();
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
        aria-label={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        title={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        onClick={() => setIsSidebarVisible(!isSidebarVisible)}
      >
        <RectangleGroupIcon aria-hidden="true" />
      </button>
    </div>
  );
}

function DocumentMetricMenu({
  metricKind,
  metrics,
  onMetricKindChange,
}: {
  readonly metricKind: DocumentMetricKind;
  readonly metrics: ReturnType<typeof calculateDocumentMetrics>;
  readonly onMetricKindChange: (kind: DocumentMetricKind) => void;
}) {
  return (
    <Menu as="div" className="relative">
      <MenuButton className="flex h-[28px] min-w-[76px] items-center justify-center gap-1 rounded-[5px] border-0 bg-transparent px-2 text-[13px] font-medium leading-none text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]">
        <span>{getDocumentMetricLabel(metricKind, metrics)}</span>
        <ChevronUpDownIcon className="size-3.5 shrink-0 stroke-[1.5]" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 6, padding: 8 }}
        className="z-[70] min-w-[132px] rounded-[8px] border border-[var(--theme-border)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)] p-1 text-[13px] text-[var(--theme-control-text)] shadow-[0_14px_44px_rgba(0,0,0,0.16)] outline-none backdrop-blur-xl"
      >
        {documentMetricOptions.map((option) => (
          <MenuItem key={option.kind}>
            {({ focus }) => (
              <button
                type="button"
                className={cx(
                  "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-control-text)]",
                  focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
                  metricKind === option.kind && "font-[560] text-[var(--theme-title)]"
                )}
                onClick={() => onMetricKindChange(option.kind)}
              >
                <span>{option.label}</span>
                <span className="text-[12px] text-[var(--theme-muted)]">
                  {getDocumentMetricLabel(option.kind, metrics)}
                </span>
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

function OutlinePopover({
  outline,
  activeOutlineId,
  onJumpToOutlineItem,
}: {
  readonly outline: readonly { readonly id: string; readonly level: number; readonly text: string; readonly line: number }[];
  readonly activeOutlineId: string | null;
  readonly onJumpToOutlineItem: (target: { readonly line: number; readonly level: number; readonly text: string }) => void;
}) {
  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton className={titleBarSecondaryButtonClassName} aria-label="打开大纲浮层" title="大纲">
            <ListBulletIcon aria-hidden="true" />
          </PopoverButton>
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 12, padding: 12 }}
            className="z-[70] w-[min(360px,calc(100vw_-_32px))] rounded-[12px] border border-[var(--theme-border-strong)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)] text-[var(--theme-text)] shadow-[0_18px_56px_rgba(0,0,0,0.18)] outline-none backdrop-blur-xl"
          >
            <span
              className="absolute right-[16px] top-[-6px] size-3 rotate-45 border-l border-t border-[var(--theme-border-strong)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)]"
              aria-hidden="true"
            />
            <div className="relative z-10 flex h-[48px] items-center border-b border-[var(--theme-border)] px-4">
              <h2 className="m-0 text-[17px] font-semibold leading-none text-[var(--theme-title)]">大纲</h2>
            </div>
            {outline.length === 0 ? (
              <p className="m-0 px-4 py-5 text-[13px] leading-5 text-[var(--theme-control-subtle)]">
                当前文档没有标题。
              </p>
            ) : (
              <nav className="max-h-[min(420px,calc(100vh_-_120px))] overflow-auto p-2" aria-label="文章大纲">
                {outline.map((item) => {
                  const active = item.id === activeOutlineId;
                  return (
                    <button
                      type="button"
                      key={`${item.id}-${item.line}`}
                      className={cx(
                        "flex min-h-8 w-full items-center rounded-[6px] border-0 bg-transparent py-1 pr-2 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
                        active && "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]"
                      )}
                      style={{ paddingLeft: 10 + (item.level - 1) * 14 }}
                      title={item.text}
                      aria-current={active ? "location" : undefined}
                      onClick={() => {
                        onJumpToOutlineItem({ line: item.line, level: item.level, text: item.text });
                        close();
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
