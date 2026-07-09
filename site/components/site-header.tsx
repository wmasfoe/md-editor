import Link from "next/link";

const navItems = [
  { href: "/changelog", label: "更新记录" },
  {
    href: "https://github.com/wmasfoe/homebrew-tap/releases",
    label: "下载",
    external: true
  }
] as const;

export function SiteHeader() {
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
          {navItems.map((item) =>
            "external" in item && item.external ? (
              <a
                key={item.href}
                href={item.href}
                rel="noreferrer"
                className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
