import Link from "next/link";
import { getChangelogEntries } from "../lib/changelog";
import { buildMacosDmgUrl, GITHUB_REPO_URL } from "../lib/site-links";
import { LiquidGlass, LiquidGlassGroup } from "./liquid-glass-link";

export function SiteHeader() {
  const [latest] = getChangelogEntries();
  const dmgUrl = latest ? buildMacosDmgUrl(latest.version) : null;

  return (
    <header className="site-header-bar sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-ink sm:gap-2.5"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-[11px] font-bold tracking-tight text-white ring-1 ring-white/25 transition-transform group-hover:scale-[1.03]"
          >
            M
          </span>
          {/* 极窄屏只显示缩写，避免与右侧导航抢宽度 */}
          <span className="truncate max-[360px]:hidden">Markdown Editor</span>
          <span className="truncate min-[361px]:hidden">MD Editor</span>
        </Link>

        <nav className="shrink-0" aria-label="主导航">
          <LiquidGlassGroup className="flex items-center gap-1.5 sm:gap-2">
            <LiquidGlass href="/changelog" tone="nav">
              <span className="sm:hidden">更新</span>
              <span className="hidden sm:inline">更新记录</span>
            </LiquidGlass>
            <span className="hidden sm:inline-flex">
              <LiquidGlass href={GITHUB_REPO_URL} tone="nav" external>
                GitHub
              </LiquidGlass>
            </span>
            {dmgUrl ? (
              <LiquidGlass
                href={dmgUrl}
                tone="nav"
                className="site-liquid-link--nav-wide"
                // 跨域时 download 属性可能被浏览器忽略；GitHub asset 仍会以 attachment 触发下载。
                download
              >
                下载
              </LiquidGlass>
            ) : null}
          </LiquidGlassGroup>
        </nav>
      </div>
    </header>
  );
}
