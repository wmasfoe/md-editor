// apps/utools/src/components/Icons.tsx
// 对齐主站 (apps/desktop) 苹果 macOS 设计语言的轻量极简 SVG 图标库
// 彻底去除 Emoji 与 AI 痕迹，统一采用原子化矢量线条与原生质感

import type { SVGProps } from "react";

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function PanelLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
  );
}

export function FolderIcon({
  isExpanded = false,
  ...props
}: SVGProps<SVGSVGElement> & { isExpanded?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M2 3.75A1.25 1.25 0 0 1 3.25 2.5h2.4a1.25 1.25 0 0 1 .88.37l1.1 1.13h5.12A1.25 1.25 0 0 1 14 5.25v7.5A1.25 1.25 0 0 1 12.75 14H3.25A1.25 1.25 0 0 1 2 12.75v-9Z"
        className="fill-[var(--theme-control-hover)] stroke-current"
      />
      {isExpanded ? (
        <path
          d="M1.75 6.5h12.5l-1.2 6.2a1 1 0 0 1-.98.8H3.93a1 1 0 0 1-.98-.8L1.75 6.5Z"
          className="fill-[var(--theme-surface)] stroke-current"
        />
      ) : (
        <path d="M2 5.5h12" className="stroke-current" />
      )}
    </svg>
  );
}

export function FileMarkdownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M3.5 2.25A1.25 1.25 0 0 1 4.75 1h5l3.75 3.75v8.5A1.25 1.25 0 0 1 12.25 14.5h-7.5A1.25 1.25 0 0 1 3.5 13.25v-11Z"
        className="fill-[var(--theme-surface)] stroke-current"
      />
      <path d="M9.75 1v3a.75.75 0 0 0 .75.75h3" />
      <path d="M6 7.5h4M6 10h2.8" />
    </svg>
  );
}

export function FileKindIcon({
  kind,
  name = "",
  isActive = false,
}: {
  kind: "markdown" | "directory" | "asset";
  name?: string;
  isActive?: boolean;
}) {
  const isMdx = kind === "markdown" && name.toLowerCase().endsWith(".mdx");
  const title = isMdx ? "MDX 文件" : kind === "markdown" ? "Markdown 文件" : "资源文件";

  if (isMdx) {
    return (
      <span
        className="file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-primary)]"
        title={title}
        aria-label={title}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
          <path
            d="M3.5 2.25A1.25 1.25 0 0 1 4.75 1h5l3.75 3.75v8.5A1.25 1.25 0 0 1 12.25 14.5h-7.5A1.25 1.25 0 0 1 3.5 13.25v-11Z"
            className="fill-[var(--theme-surface)] stroke-[var(--theme-primary)] stroke-[1.25]"
          />
          <path
            d="M9.75 1v3a.75.75 0 0 0 .75.75h3"
            className="fill-[var(--theme-primary-soft)] stroke-[var(--theme-primary)] stroke-[1.25]"
          />
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
        className={`file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center transition-colors ${
          isActive
            ? "text-[var(--theme-primary)]"
            : "text-[var(--theme-control-subtle)] group-hover:text-[var(--theme-control-text)]"
        }`}
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
            className={`stroke-current stroke-[1.2] ${
              isActive ? "fill-[var(--theme-primary-soft)]" : "fill-[var(--theme-control-hover)]"
            }`}
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
      className={`file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center transition-colors ${
        isActive ? "text-[var(--theme-primary)]" : "text-[var(--theme-control-subtle)]"
      }`}
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

export function NewFileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.5 1.5H4.25A1.25 1.25 0 0 0 3 2.75v10.5A1.25 1.25 0 0 0 4.25 14.5h7.5A1.25 1.25 0 0 0 13 13.25V6L8.5 1.5Z" />
      <path d="M8.5 1.5V6H13" />
      <path d="M8 8.5v4M6 10.5h4" strokeWidth="1.3" />
    </svg>
  );
}

export function NewFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 3.75A1.25 1.25 0 0 1 3.25 2.5h2.4a1.25 1.25 0 0 1 .88.37l1.1 1.13h5.12A1.25 1.25 0 0 1 14 5.25v7.5A1.25 1.25 0 0 1 12.75 14H3.25A1.25 1.25 0 0 1 2 12.75v-9Z" />
      <path d="M8 7v4M6 9h4" strokeWidth="1.3" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M12.5 4.5v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9" />
      <path d="M6.5 7.5v4M9.5 7.5v4" />
    </svg>
  );
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.5 2.5v4h-4" />
      <path d="M2.5 13.5v-4h4" />
      <path d="M12.93 6.5A5.5 5.5 0 0 0 3.5 5.1L2.5 6.5m11 3-1 1.4A5.5 5.5 0 0 1 3.07 9.5" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function KeyboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path
        d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M4.5 9h.01M6.5 9.5h3M12 9h.01"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 2.5h3.5V6M6.5 9.5l7-7" />
      <path d="M12.5 9v4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

export function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m5 4.5-3 3.5 3 3.5M11 4.5l3 3.5-3 3.5" />
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v.5" />
    </svg>
  );
}

export function PasteToAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 2.5h2.25A1.25 1.25 0 0 1 13.5 3.75v8.5a1.25 1.25 0 0 1-1.25 1.25H3.75A1.25 1.25 0 0 1 2.5 12.25v-8.5A1.25 1.25 0 0 1 3.75 2.5H6" />
      <rect x="6" y="1" width="4" height="2.5" rx=".75" />
      <path d="M5.5 8h5M8 5.5v5" />
    </svg>
  );
}

export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 5h.01" strokeWidth="1.5" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="2.25" />
      <path d="M6.6 2.3A1.5 1.5 0 0 1 9.4 2.3l.18.42a1.5 1.5 0 0 0 1.56.9l.45-.07a1.5 1.5 0 0 1 1.98 1.98l-.07.45a1.5 1.5 0 0 0 .9 1.56l.42.18a1.5 1.5 0 0 1 0 2.8l-.42.18a1.5 1.5 0 0 0-.9 1.56l.07.45a1.5 1.5 0 0 1-1.98 1.98l-.45-.07a1.5 1.5 0 0 0-1.56.9l-.18.42a1.5 1.5 0 0 1-2.8 0l-.18-.42a1.5 1.5 0 0 0-1.56-.9l-.45.07a1.5 1.5 0 0 1-1.98-1.98l.07-.45a1.5 1.5 0 0 0-.9-1.56l-.42-.18a1.5 1.5 0 0 1 0-2.8l.42-.18a1.5 1.5 0 0 0 .9-1.56l-.07-.45a1.5 1.5 0 0 1 1.98-1.98l.45.07a1.5 1.5 0 0 0 1.56-.9z" />
    </svg>
  );
}

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M2.5 8H4m8 0h1.5M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" />
    </svg>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.5 9.2A5.5 5.5 0 1 1 6.8 2.5a4.5 4.5 0 0 0 6.7 6.7z" />
    </svg>
  );
}

export function LaptopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="10" height="7" rx="1" />
      <path d="M1.5 13h13a.5.5 0 0 0 .5-.5v-.5H1v.5a.5.5 0 0 0 .5.5z" />
    </svg>
  );
}
