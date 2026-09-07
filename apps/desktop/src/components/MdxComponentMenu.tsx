import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";

export interface MdxComponentMenuProps {
  /** 面板是否处于打开状态 */
  readonly open: boolean;
  /** 可插入的组件插件列表 */
  readonly plugins: readonly MdxComponentPlugin[];
  /** 确认插入回调 */
  readonly onInsert: (plugin: MdxComponentPlugin) => void;
  /** 关闭面板回调 */
  readonly onClose: () => void;
}

interface FilteredPluginItem {
  readonly plugin: MdxComponentPlugin;
  readonly group: string;
}

/**
 * MDX 组件插入面板。
 * 遵循现代 UI 设计规范与 CommandPalette 一致的设计语言：
 * - 模糊背景遮罩与居中浮层
 * - 实时搜索过滤（名称、标签、描述、关键词）
 * - 键盘方向键 ↑/↓ 导航、Enter 确认插入、Escape 取消退出
 * - 组件分类分组展示
 */
export function MdxComponentMenu({ open, plugins, onInsert, onClose }: MdxComponentMenuProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // 打开时重置搜索关键词与高亮索引
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  // 根据搜索关键词过滤候选组件列表
  const filteredItems = useMemo<readonly FilteredPluginItem[]>(() => {
    const needle = query.trim().toLowerCase();
    const insertable = plugins.filter((p) => p.insert !== undefined);
    if (!needle) {
      return insertable.map((plugin) => ({
        plugin,
        group: plugin.insert?.group ?? "组件",
      }));
    }
    return insertable
      .filter((plugin) => {
        const insert = plugin.insert;
        const haystack = [
          plugin.id,
          plugin.component.name,
          plugin.component.displayName,
          insert?.label,
          insert?.description,
          insert?.group,
          ...(insert?.keywords ?? []),
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .map((plugin) => ({
        plugin,
        group: plugin.insert?.group ?? "组件",
      }));
  }, [plugins, query]);

  // 避免过滤后选中索引越界
  useEffect(() => {
    if (activeIndex >= filteredItems.length && filteredItems.length > 0) {
      setActiveIndex(filteredItems.length - 1);
    }
  }, [activeIndex, filteredItems.length]);

  const handleInsert = useCallback(
    (plugin: MdxComponentPlugin) => {
      onClose();
      onInsert(plugin);
    },
    [onClose, onInsert],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, filteredItems.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = filteredItems[activeIndex];
        if (item) {
          handleInsert(item.plugin);
        }
      }
    },
    [activeIndex, filteredItems, handleInsert],
  );

  // 按分组整理列表
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, FilteredPluginItem[]>();
    for (const item of filteredItems) {
      let bucket = byGroup.get(item.group);
      if (!bucket) {
        bucket = [];
        byGroup.set(item.group, bucket);
        order.push(item.group);
      }
      bucket.push(item);
    }
    let offset = 0;
    return order.map((group) => {
      const groupItems = byGroup.get(group) ?? [];
      const start = offset;
      offset += groupItems.length;
      return { group, groupItems, start };
    });
  }, [filteredItems]);

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.2)]" />
      <div className="fixed inset-0 grid place-items-start justify-center pt-[15vh]">
        <DialogPanel className="w-[min(480px,calc(100vw-2rem))] overflow-hidden rounded-[10px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] shadow-[var(--theme-shadow)]">
          {/* 顶部搜索框 */}
          <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-3">
            <svg
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--theme-muted)]"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                clipRule="evenodd"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="搜索并插入 MDX 组件…"
              aria-label="搜索并插入 MDX 组件"
              className="w-full bg-transparent text-sm text-[var(--theme-title)] outline-none placeholder:text-[var(--theme-muted)]"
            />
            <span className="shrink-0 rounded border border-[var(--theme-border)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
              ESC
            </span>
          </div>

          {/* 组件列表 */}
          <ul ref={listRef} className="max-h-[min(48vh,360px)] overflow-y-auto py-2">
            {groups.length === 0 ? (
              <li className="px-4 py-6 text-center text-[13px] text-[var(--theme-muted)]">
                没有匹配的 MDX 组件
              </li>
            ) : (
              groups.map(({ group, groupItems, start }) => (
                <li key={group}>
                  <div className="px-4 pb-1 pt-3 text-[11px] font-[600] uppercase tracking-wide text-[var(--theme-muted)]">
                    {group}
                  </div>
                  <ul>
                    {groupItems.map((item, groupIndex) => {
                      const flat = start + groupIndex;
                      const active = flat === activeIndex;
                      const label = item.plugin.insert?.label ?? item.plugin.component.displayName;
                      const description = item.plugin.insert?.description;
                      return (
                        <li key={item.plugin.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] ${
                              active
                                ? "bg-[var(--theme-selection-soft,rgba(59,130,246,0.12))] text-[var(--theme-title)]"
                                : "text-[var(--theme-text)]"
                            }`}
                            onMouseEnter={() => setActiveIndex(flat)}
                            onClick={() => handleInsert(item.plugin)}
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">{label}</div>
                              {description ? (
                                <div className="truncate text-[12px] text-[var(--theme-muted)]">
                                  {description}
                                </div>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-[11px] text-[var(--theme-muted)]">
                              &lt;{item.plugin.component.name} /&gt;
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>

          {/* 底部按键提示 */}
          <div className="flex items-center gap-3 border-t border-[var(--theme-border)] px-4 py-2 text-[11px] text-[var(--theme-muted)]">
            <span>↑↓ 导航</span>
            <span>Enter 插入</span>
            <span className="ml-auto">{filteredItems.length} 个组件可用</span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
