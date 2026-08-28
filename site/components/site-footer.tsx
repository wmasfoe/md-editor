"use client";

import { useI18n } from "../lib/i18n/context";
import { APP_DISPLAY_NAME, GITHUB_REPO_URL } from "../lib/site-links";

export function SiteFooter() {
  const { t } = useI18n();

  return (
    <footer className="mt-auto border-t border-line/80 pb-[env(safe-area-inset-bottom,0px)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-10">
        <p className="text-pretty">{t.footer.summary}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center text-ink-soft transition-colors hover:text-ink sm:min-h-0"
          >
            {t.footer.github}
          </a>
          <p className="text-muted/80">
            © {new Date().getFullYear()} {APP_DISPLAY_NAME}
          </p>
        </div>
      </div>
    </footer>
  );
}
