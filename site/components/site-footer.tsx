import { GITHUB_REPO_URL } from "../lib/site-links";

export function SiteFooter() {
  return (
    <footer className="site-header-bar mt-auto pb-[env(safe-area-inset-bottom,0px)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-10">
        <p className="text-pretty">本地优先的 Markdown / MDX 桌面编辑器</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center text-ink-soft transition-colors hover:text-ink sm:min-h-0"
          >
            GitHub
          </a>
          <p className="text-muted/80">© {new Date().getFullYear()} Markdown Editor</p>
        </div>
      </div>
    </footer>
  );
}
