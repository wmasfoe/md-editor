import Link from "next/link";
import { getChangelogEntries } from "../lib/changelog";
import { buildMacosDmgUrl, GITHUB_REPO_URL } from "../lib/site-links";

export function SiteHeader() {
  const [latest] = getChangelogEntries();
  const dmgUrl = latest ? buildMacosDmgUrl(latest.version) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/80 backdrop-blur-md pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-3 px-4 sm:h-14 sm:px-8">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-ink sm:gap-2.5"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[11px] font-bold tracking-tight text-white transition-transform group-hover:scale-[1.03]"
          >
            M
          </span>
          {/* 极窄屏只显示缩写，避免与右侧导航抢宽度 */}
          <span className="truncate max-[360px]:hidden">Markdown Editor</span>
          <span className="truncate min-[361px]:hidden">MD Editor</span>
        </Link>

        <nav
          className="flex shrink-0 items-center gap-0.5 sm:gap-2"
          aria-label="主导航"
        >
          <Link
            href="/changelog"
            className="inline-flex min-h-10 items-center rounded-full px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink sm:min-h-0 sm:px-3 sm:text-sm"
          >
            <span className="sm:hidden">更新</span>
            <span className="hidden sm:inline">更新记录</span>
          </Link>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden min-h-10 items-center rounded-full px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink sm:inline-flex sm:min-h-0 sm:px-3 sm:text-sm"
          >
            GitHub
          </a>
          {dmgUrl ? (
            <a
              href={dmgUrl}
              // 跨域时 download 属性可能被浏览器忽略；GitHub asset 仍会以 attachment 触发下载。
              download
              className="ml-0.5 inline-flex min-h-10 items-center rounded-full bg-ink px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 sm:ml-1 sm:min-h-0 sm:px-3.5 sm:text-sm"
            >
              下载
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
