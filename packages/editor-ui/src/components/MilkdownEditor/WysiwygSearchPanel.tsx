import type { RefObject } from "react";

export interface WysiwygSearchPanelProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly result: { readonly matchCount: number; readonly activeIndex: number };
  readonly caseSensitive: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onCaseSensitiveChange: (caseSensitive: boolean) => void;
  readonly onSearch: (query: string, index: number, caseSensitive?: boolean) => void;
  readonly onClose: () => void;
}

export function WysiwygSearchPanel({
  inputRef,
  query,
  result,
  caseSensitive,
  onQueryChange,
  onCaseSensitiveChange,
  onSearch,
  onClose,
}: WysiwygSearchPanelProps) {
  return (
    <div className="wysiwyg-search-panel" role="search" aria-label="在文档中查找">
      <input
        ref={inputRef}
        value={query}
        aria-label="查找内容"
        placeholder="查找"
        onChange={(event) => {
          const nextQuery = event.target.value;
          onQueryChange(nextQuery);
          onSearch(nextQuery, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            onSearch(query, result.activeIndex + (event.shiftKey ? -1 : 1));
          }
        }}
      />
      <span className="wysiwyg-search-panel__count" aria-live="polite">
        {result.matchCount === 0 ? "无匹配" : `${result.activeIndex + 1} / ${result.matchCount}`}
      </span>
      <button
        type="button"
        aria-label="上一个匹配"
        onClick={() => onSearch(query, result.activeIndex - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="下一个匹配"
        onClick={() => onSearch(query, result.activeIndex + 1)}
      >
        ↓
      </button>
      <label>
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => {
            const checked = event.target.checked;
            onCaseSensitiveChange(checked);
            onSearch(query, 0, checked);
          }}
        />
        区分大小写
      </label>
      <button type="button" aria-label="关闭查找" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
