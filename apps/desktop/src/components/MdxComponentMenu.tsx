import { useEffect, useMemo, useState } from "react";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog } from "@headlessui/react";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";
import { cx } from "../lib/cx";

export interface MdxComponentMenuProps {
  readonly plugins: readonly MdxComponentPlugin[];
  readonly onInsert: (plugin: MdxComponentPlugin) => void;
  readonly onClose: () => void;
}

export function MdxComponentMenu({ plugins, onInsert, onClose }: MdxComponentMenuProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredPlugins = useMemo(() => filterPlugins(plugins, query), [plugins, query]);
  const activePlugin = filteredPlugins[activeIndex] ?? filteredPlugins[0] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  return (
    <Dialog open onClose={onClose} className="relative z-[65]">
      <div className="fixed inset-0 bg-transparent" aria-hidden="true" />
      <Dialog.Panel className="fixed left-1/2 top-[22vh] w-[min(420px,calc(100vw_-_32px))] -translate-x-1/2 overflow-hidden rounded-[12px] border border-[rgba(0,0,0,0.08)] bg-[rgba(255,255,255,0.92)] text-[var(--theme-text)] shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl">
        <Combobox
          value={null}
          onChange={(plugin: MdxComponentPlugin | null) => {
            if (plugin) onInsert(plugin);
          }}
          immediate
        >
          <ComboboxInput
            autoFocus
            className="h-11 w-full border-0 border-b border-[var(--theme-border)] bg-transparent px-3.5 text-[14px] leading-none text-[var(--theme-title)] outline-none placeholder:text-[var(--theme-control-subtle)]"
            displayValue={() => query}
            placeholder="插入 MDX 组件"
            aria-label="搜索 MDX 组件"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => wrapIndex(current + 1, filteredPlugins.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => wrapIndex(current - 1, filteredPlugins.length));
              } else if (event.key === "Enter" && activePlugin) {
                event.preventDefault();
                onInsert(activePlugin);
              }
            }}
          />
          <ComboboxOptions static className="max-h-[260px] overflow-auto p-1.5">
            {filteredPlugins.length > 0 ? (
              filteredPlugins.map((plugin, index) => (
                <ComboboxOption
                  key={plugin.id}
                  value={plugin}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onInsert(plugin)}
                  className={({ focus }) =>
                    cx(
                      "grid cursor-default grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[8px] px-2.5 py-2 text-left",
                      (focus || index === activeIndex) && "bg-[var(--theme-control-hover)]"
                    )
                  }
                >
                  <span className="min-w-0">
                    <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-[1.3] text-[var(--theme-title)]">
                      {plugin.insert?.label ?? plugin.component.displayName}
                    </strong>
                    {plugin.insert?.description ? (
                      <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[1.35] text-[var(--theme-muted)]">
                        {plugin.insert.description}
                      </small>
                    ) : null}
                  </span>
                  {plugin.insert?.group ? (
                    <span className="self-center rounded-[999px] bg-[var(--theme-bg-muted)] px-2 py-0.5 text-[11px] leading-none text-[var(--theme-control-subtle)]">
                      {plugin.insert.group}
                    </span>
                  ) : null}
                </ComboboxOption>
              ))
            ) : (
              <p className="m-0 px-2.5 py-3 text-[13px] text-[var(--theme-control-subtle)]">
                没有匹配的组件
              </p>
            )}
          </ComboboxOptions>
        </Combobox>
      </Dialog.Panel>
    </Dialog>
  );
}

function filterPlugins(plugins: readonly MdxComponentPlugin[], query: string): readonly MdxComponentPlugin[] {
  const q = query.trim().toLowerCase();
  if (!q) return plugins;
  return plugins.filter((plugin) => {
    const insert = plugin.insert;
    return [
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
      .toLowerCase()
      .includes(q);
  });
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return (index + length) % length;
}
