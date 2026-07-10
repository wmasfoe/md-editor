import { useEffect, useRef } from "react";

export interface InlineInputProps {
  readonly defaultValue: string;
  readonly paddingLeft: number;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}

export function InlineInput({ defaultValue, paddingLeft, onCommit, onCancel }: InlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 选中不含扩展名的部分
    const dotIndex = el.value.lastIndexOf(".");
    el.setSelectionRange(0, dotIndex > 0 ? dotIndex : el.value.length);
  }, []);

  const commit = () => {
    const val = inputRef.current?.value ?? "";
    onCommit(val);
  };

  return (
    <div className="flex min-h-7 items-center" style={{ paddingLeft }}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        className="h-5.5 w-full min-w-0 rounded-[3px] border border-(--theme-accent,#4f8ef7) bg-(--theme-surface) px-1.5 text-[13px] leading-[1.35] text-(--theme-title) outline-none ring-2 ring-(--theme-accent,#4f8ef7)/20"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}
