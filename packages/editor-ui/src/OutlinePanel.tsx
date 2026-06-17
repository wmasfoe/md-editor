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
    return <div className="p-4 text-[13px] text-[var(--theme-muted)]">当前文档没有标题。</div>;
  }

  return (
    <nav className="min-h-0 flex-1 overflow-auto py-2" aria-label="大纲目录">
      {outline.map((item) => (
        <button
          type="button"
          key={`${item.id}-${item.line}`}
          className="flex min-h-7 w-full items-center overflow-hidden border-0 bg-transparent text-left text-[13px] leading-[1.35] text-ellipsis whitespace-nowrap text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] focus-visible:bg-[var(--theme-primary-soft)] focus-visible:text-[var(--theme-text)]"
          style={{ paddingLeft: 12 + (item.level - 1) * 14 }}
          onClick={() => onJump({ line: item.line, level: item.level, text: item.text })}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
