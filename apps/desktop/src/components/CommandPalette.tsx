import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandDescriptor } from "@md-editor/editor-core";
import { runtime } from "../app/runtime/editor-runtime";

export interface CommandPaletteProps {
  /** 面板是否打开(由 Ctrl+K 等快捷键驱动) */
  readonly open: boolean;
  /** 关闭请求(面板自身不直接改全局状态,统一走此回调) */
  readonly onClose: () => void;
  /** 执行命令(走宿主 dispatchCommand,命令逻辑不在此复制) */
  readonly onRun: (commandId: string) => void | Promise<void>;
}

interface PaletteItem {
  readonly command: CommandDescriptor;
  readonly group: string;
}

/**
 * 命令面板(G007 P3-9 统一 UI 入口)。
 *
 * 数据源 = editor runtime 的 CommandRegistry(单一事实来源,不复制命令逻辑):
 * - 列表:`runtime.commands.listAvailable(context, "command-palette")` 按 when 过滤 + 分组排序;
 * - 执行:回调给宿主 `dispatchCommand`,由宿主构建完整 actions 上下文。
 *
 * 交互:输入框搜索(title + keywords,大小写不敏感)、↑/↓ 导航、Enter 执行、
 * Escape 关闭(HeadlessUI Dialog 内置)、点击执行、空态提示。
 */
export function CommandPalette({ open, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 面板每次打开时重置搜索与选中项(避免残留上次状态)
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // 打开后聚焦输入框(HeadlessUI 的 initialFocus 需要 stable ref,这里用微任务兜底)
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  // 从 registry 拉取可用命令(placement = command-palette;when 未配置的内置命令默认可用)。
  // context 只提供 document;actions 由宿主 dispatch 时注入,列表阶段不需要。
  const allCommands = useMemo(
    () =>
      runtime.commands.listAvailable(
        { document: runtime.document, actions: {} },
        "command-palette",
      ),
    [],
  );

  // 按 title + keywords 过滤(大小写不敏感)
  const items = useMemo<readonly PaletteItem[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return allCommands.map((command) => ({
        command,
        group: command.group ?? "其他",
      }));
    }
    return allCommands
      .filter(
        (command) =>
          command.title.toLowerCase().includes(needle) ||
          (command.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)),
      )
      .map((command) => ({ command, group: command.group ?? "其他" }));
  }, [allCommands, query]);

  // 选中项越界保护(过滤结果变少时回退到最后一项)
  useEffect(() => {
    if (activeIndex >= items.length && items.length > 0) {
      setActiveIndex(items.length - 1);
    }
  }, [activeIndex, items.length]);

  const handleRun = useCallback(
    (commandId: string) => {
      onClose();
      void onRun(commandId);
    },
    [onClose, onRun],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, items.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) {
          handleRun(item.command.id);
        }
      }
    },
    [activeIndex, handleRun, items],
  );

  // 分组展示:按 group 顺序(registry 已按 group 排序),组内保持原顺序;
  // 每组的 start 记录全局扁平索引起点,供 ↑/↓ 导航与选中高亮定位
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PaletteItem[]>();
    for (const item of items) {
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
  }, [items]);

  return (
    // Dialog 自身占满视口(否则内部 fixed 容器不占布局空间,外层 div 高度为 0,
    // 无障碍/自动化判定会把整个面板当作不可见)
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.2)]" />
      <div className="fixed inset-0 grid place-items-start justify-center pt-[12vh]">
        <DialogPanel className="w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[10px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] shadow-[var(--theme-shadow)]">
          {/* 搜索输入框 */}
          <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-3">
            <svg
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--theme-muted)]"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
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
              placeholder="输入命令或关键词…"
              aria-label="命令搜索"
              className="w-full bg-transparent text-sm text-[var(--theme-title)] outline-none placeholder:text-[var(--theme-muted)]"
            />
            <span className="shrink-0 rounded border border-[var(--theme-border)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
              ESC
            </span>
          </div>

          {/* 命令列表(分组) */}
          <ul ref={listRef} className="max-h-[min(52vh,420px)] overflow-y-auto py-2">
            {groups.length === 0 ? (
              <li className="px-4 py-6 text-center text-[13px] text-[var(--theme-muted)]">
                没有匹配的命令
              </li>
            ) : (
              groups.map(({ group, groupItems, start }) => (
                <li key={group}>
                  <div className="px-4 pb-1 pt-3 text-[11px] font-[600] uppercase tracking-wide text-[var(--theme-muted)]">
                    {group}
                  </div>
                  <ul>
                    {groupItems.map((item, groupIndex) => {
                      // 组内索引 + 组起点 = 全局扁平索引,供 ↑/↓ 导航定位
                      const flat = start + groupIndex;
                      const active = flat === activeIndex;
                      return (
                        <li key={item.command.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] ${
                              active
                                ? "bg-[var(--theme-selection-soft,rgba(59,130,246,0.12))] text-[var(--theme-title)]"
                                : "text-[var(--theme-text)]"
                            }`}
                            onMouseEnter={() => setActiveIndex(flat)}
                            onClick={() => handleRun(item.command.id)}
                          >
                            <span className="truncate">{item.command.title}</span>
                            {/* 关键词命中时展示命令 id,帮助用户熟悉命令标识 */}
                            <span className="shrink-0 text-[11px] text-[var(--theme-muted)]">
                              {item.command.id}
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

          {/* 底部提示 */}
          <div className="flex items-center gap-3 border-t border-[var(--theme-border)] px-4 py-2 text-[11px] text-[var(--theme-muted)]">
            <span>↑↓ 导航</span>
            <span>Enter 执行</span>
            <span className="ml-auto">{allCommands.length} 个命令</span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
