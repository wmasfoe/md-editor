import { useEffect, useRef } from "react";

export interface InlineInputProps {
  readonly defaultValue: string;
  readonly paddingLeft: number;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}

/**
 * 苹果风格行内编辑输入框：
 * 1. 自动选中文件名主干（保留扩展名）；
 * 2. 具有柔和内阴影与主题主色聚焦环；
 * 3. 支持 Enter 提交与 Escape 撤销。
 */
export function InlineInput({ defaultValue, paddingLeft, onCommit, onCancel }: InlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 自动选中主干文件名（排除 .md / .mdx 等后缀）
    const dotIndex = el.value.lastIndexOf(".");
    el.setSelectionRange(0, dotIndex > 0 ? dotIndex : el.value.length);
  }, []);

  const commit = () => {
    const val = inputRef.current?.value ?? "";
    onCommit(val);
  };

  return (
    <div className="flex h-7 min-h-7 items-center pr-2" style={{ paddingLeft }}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        className="h-6 w-full min-w-0 rounded-[5px] border border-[var(--theme-primary)] bg-[var(--theme-surface)] px-2 text-[13px] leading-tight text-[var(--theme-title)] shadow-xs ring-2 ring-[var(--theme-primary-soft)] outline-none"
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
