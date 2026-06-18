import { useEffect, useRef } from "react";
import type { TocTarget } from "./types";

export interface OutlineItem {
  readonly id: string;
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface OutlinePanelProps {
  readonly outline: readonly OutlineItem[];
  readonly activeId?: string | null;
  readonly onJump: (target: Omit<TocTarget, "nonce">) => void;
}

export function OutlinePanel({ outline, activeId = null, onJump }: OutlinePanelProps) {
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    // Keep the active section visible while the user scrolls the editor, but do
    // not steal page focus; this mirrors IDE outline behavior.
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  if (outline.length === 0) {
    return <div className="p-3 text-[13px] text-[var(--theme-control-subtle)]">当前文档没有标题。</div>;
  }

  return (
    <nav className="sidebar-scrollbar min-h-0 flex-1 overflow-auto pb-4 pt-2" aria-label="大纲目录">
      {outline.map((item) => {
        const active = item.id === activeId;

        return (
          <button
            type="button"
            key={`${item.id}-${item.line}`}
            ref={active ? activeItemRef : undefined}
            aria-current={active ? "location" : undefined}
            className={classNames(
              "flex min-h-7 w-full items-center overflow-hidden border-0 bg-transparent py-0 text-left text-[13px] leading-[1.35] text-ellipsis whitespace-nowrap text-[var(--theme-control-text)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
              active && "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]"
            )}
            style={{ paddingLeft: 16 + (item.level - 1) * 14 }}
            onClick={() => onJump({ line: item.line, level: item.level, text: item.text })}
            title={item.text}
          >
            {item.text}
          </button>
        );
      })}
    </nav>
  );
}

function classNames(...values: Array<string | false>): string {
  return values.filter(Boolean).join(" ");
}
