import type { TocTarget } from "./types";

export interface OutlineItem {
  readonly id: string;
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface OutlinePanelProps {
  readonly outline: readonly OutlineItem[];
  readonly onJump: (target: Omit<TocTarget, "nonce">) => void;
}

export function OutlinePanel({ outline, onJump }: OutlinePanelProps) {
  if (outline.length === 0) {
    return <div className="p-3 text-[13px] text-[var(--theme-control-subtle)]">当前文档没有标题。</div>;
  }

  return (
    <nav className="sidebar-scrollbar min-h-0 flex-1 overflow-auto pb-4 pt-2" aria-label="大纲目录">
      {outline.map((item) => (
        <button
          type="button"
          key={`${item.id}-${item.line}`}
          className="flex min-h-7 w-full items-center overflow-hidden border-0 bg-transparent py-0 text-left text-[13px] leading-[1.35] text-ellipsis whitespace-nowrap text-[var(--theme-control-text)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none"
          style={{ paddingLeft: 16 + (item.level - 1) * 14 }}
          onClick={() => onJump({ line: item.line, level: item.level, text: item.text })}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
