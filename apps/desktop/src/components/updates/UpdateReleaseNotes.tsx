/**
 * @fileoverview 更新日志渲染组件
 *
 * 结构与官网 `/changelog` 对齐：版本号 + 日期 + PR 行 + 项目符号列表（支持嵌套），
 * 行内只渲染 `code` / `bold` / 安全链接三种 token；输出 React 元素，不生成 HTML 字符串。
 */

import type { ReactNode } from "react";
import {
  tokenizeInlineMarkdown,
  type ChangelogEntry,
  type ChangelogItem,
} from "@md-editor/changelog";

interface UpdateReleaseNotesProps {
  readonly entry: ChangelogEntry | null;
  /** notes 未命中版本区块时用于兜底展示的版本号 */
  readonly fallbackVersion: string;
  readonly notesTitle: string;
  readonly noNotesLabel: string;
}

export function UpdateReleaseNotes({
  entry,
  fallbackVersion,
  notesTitle,
  noNotesLabel,
}: UpdateReleaseNotesProps) {
  if (!entry || entry.items.length === 0) {
    return <p className="m-0 text-[12px] leading-5 text-[var(--theme-muted)]">{noNotesLabel}</p>;
  }

  return (
    <section aria-label={notesTitle} className="grid gap-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="m-0 text-[13px] font-semibold text-[var(--theme-title)]">{notesTitle}</h3>
        <span className="text-[12px] text-[var(--theme-muted)]">
          v{entry.version || fallbackVersion}
        </span>
        {entry.date ? (
          <time dateTime={entry.date} className="text-[12px] text-[var(--theme-muted)]">
            {entry.date}
          </time>
        ) : null}
        {entry.sourcePR && entry.sourcePR.length > 0 ? (
          <span className="text-[12px] text-[var(--theme-muted)]">
            {entry.sourcePR.map((pr) => `#${pr}`).join(" ")}
          </span>
        ) : null}
      </header>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {entry.items.map((item, index) => (
          <UpdateReleaseNoteItem key={index} item={item} />
        ))}
      </ul>
    </section>
  );
}

function UpdateReleaseNoteItem({ item }: { readonly item: ChangelogItem }) {
  return (
    <li className="grid gap-1 text-[12px] leading-[1.55] text-[var(--theme-text)]">
      <span className="flex gap-2">
        <span aria-hidden="true" className="select-none text-[var(--theme-muted)]">
          •
        </span>
        <span>{renderInline(item.text)}</span>
      </span>
      {item.items && item.items.length > 0 ? (
        <ul className="m-0 ml-3 grid list-none gap-1 border-l border-[var(--theme-border)] pl-3">
          {item.items.map((child, index) => (
            <UpdateReleaseNoteItem key={index} item={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function renderInline(text: string): ReactNode[] {
  return tokenizeInlineMarkdown(text).map((token, index) => {
    switch (token.kind) {
      case "code":
        return (
          <code
            key={index}
            className="rounded-[3px] border border-[var(--theme-border)] bg-[var(--theme-code-bg)] px-1 py-px font-mono text-[11px] text-[var(--theme-text)]"
          >
            {token.text}
          </code>
        );
      case "bold":
        return (
          <strong key={index} className="font-semibold text-[var(--theme-title)]">
            {token.text}
          </strong>
        );
      case "link":
        return (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--theme-primary)] underline underline-offset-2"
          >
            {token.text}
          </a>
        );
      default:
        return token.text;
    }
  });
}
