import { cx } from "../../lib/cx";

export interface FileKindIconProps {
  readonly kind: "markdown" | "asset";
  readonly name?: string;
  readonly isActive?: boolean;
}

/**
 * 苹果 macOS 风格文件类型图标：
 * 1. Markdown (.md)：折角纸张与细密横线（Paper Document with Folded Dog-ear）；
 * 2. MDX (.mdx)：带有代码微标记与主题高亮；
 * 3. Asset (.png/.jpg)：微型相框与景物（Media Asset）；
 * 4. 活动打开状态（isActive）：跟随主题主色高亮。
 */
export function FileKindIcon({ kind, name = "", isActive = false }: FileKindIconProps) {
  const isMdx = kind === "markdown" && name.toLowerCase().endsWith(".mdx");
  const title = isMdx ? "MDX 文件" : kind === "markdown" ? "Markdown 文件" : "图片文件";

  if (isMdx) {
    return (
      <span
        className="file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-primary)]"
        title={title}
        aria-label={title}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
          {/* 折角纸张底 */}
          <path
            d="M3.5 2.25A1.25 1.25 0 0 1 4.75 1h5l3.75 3.75v8.5A1.25 1.25 0 0 1 12.25 14.5h-7.5A1.25 1.25 0 0 1 3.5 13.25v-11Z"
            className="fill-[var(--theme-surface)] stroke-[var(--theme-primary)] stroke-[1.25]"
          />
          <path
            d="M9.75 1v3a.75.75 0 0 0 .75.75h3"
            className="fill-[var(--theme-primary-soft)] stroke-[var(--theme-primary)] stroke-[1.25]"
          />
          {/* 代码微括号 */}
          <path
            d="M6 7.5L4.8 8.7 6 9.9M10 7.5l1.2 1.2-1.2 1.2"
            className="stroke-[var(--theme-primary)] stroke-[1.3] stroke-linecap-round stroke-linejoin-round"
          />
        </svg>
      </span>
    );
  }

  if (kind === "markdown") {
    return (
      <span
        className={cx(
          "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center transition-colors",
          isActive
            ? "text-[var(--theme-primary)]"
            : "text-[var(--theme-control-subtle)] group-hover:text-[var(--theme-control-text)]",
        )}
        title={title}
        aria-label={title}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
          <path
            d="M3.5 2.25A1.25 1.25 0 0 1 4.75 1h5l3.75 3.75v8.5A1.25 1.25 0 0 1 12.25 14.5h-7.5A1.25 1.25 0 0 1 3.5 13.25v-11Z"
            className="fill-[var(--theme-surface)] stroke-current stroke-[1.2]"
          />
          <path
            d="M9.75 1v3a.75.75 0 0 0 .75.75h3"
            className={cx(
              "stroke-current stroke-[1.2]",
              isActive ? "fill-[var(--theme-primary-soft)]" : "fill-[var(--theme-control-hover)]",
            )}
          />
          <path
            d="M6 7.5h4M6 10h2.8"
            className="stroke-current stroke-[1.2] stroke-linecap-round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={cx(
        "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center transition-colors",
        isActive ? "text-[var(--theme-primary)]" : "text-[var(--theme-control-subtle)]",
      )}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
        <rect
          x="2.5"
          y="2.5"
          width="11"
          height="11"
          rx="2"
          className="fill-[var(--theme-surface)] stroke-current stroke-[1.2]"
        />
        <circle cx="5.5" cy="5.5" r="1" className="fill-current" />
        <path
          d="M3.5 12l3.2-3.2 2.3 2.3 2-2 2.5 2.9"
          className="stroke-current stroke-[1.2] stroke-linecap-round stroke-linejoin-round"
        />
      </svg>
    </span>
  );
}
