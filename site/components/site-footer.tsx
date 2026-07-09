import { GITHUB_REPO_URL } from "../lib/site-links";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line/80">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>本地优先的 Markdown / MDX 桌面编辑器</p>
        <div className="flex items-center gap-4">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft transition-colors hover:text-ink"
          >
            GitHub
          </a>
          <p className="text-muted/80">© {new Date().getFullYear()} Markdown Editor</p>
        </div>
      </div>
    </footer>
  );
}
