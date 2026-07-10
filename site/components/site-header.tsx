import Link from "next/link";
import { getChangelogEntries } from "../lib/changelog";
import { buildMacosDmgUrl, GITHUB_REPO_URL } from "../lib/site-links";

export function SiteHeader() {
  const [latest] = getChangelogEntries();
  const dmgUrl = latest ? buildMacosDmgUrl(latest.version) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6 sm:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-[11px] font-bold tracking-tight text-white transition-transform group-hover:scale-[1.03]"
          >
            M
          </span>
          <span>Markdown Editor</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="主导航">
          <Link
            href="/changelog"
            className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
          >
            更新记录
          </Link>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
          >
            GitHub
          </a>
          {dmgUrl ? (
            <a
              href={dmgUrl}
              // 跨域时 download 属性可能被浏览器忽略；GitHub asset 仍会以 attachment 触发下载。
              download
              className="ml-1 inline-flex items-center rounded-full bg-ink px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              下载
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
