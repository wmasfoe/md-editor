"use client";

import Link from "next/link";
import type { DownloadCatalog } from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { GITHUB_REPO_URL, PLAYGROUND_PATH } from "../lib/site-links";
import { HeaderDownloadButton } from "./header-download-button";
import { InkpointWordmark } from "./inkpoint-wordmark";
import { LanguageSwitcher } from "./language-switcher";

type SiteHeaderProps = {
  catalog: DownloadCatalog | null;
};

export function SiteHeader({ catalog }: SiteHeaderProps) {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/80 backdrop-blur-md pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-2 px-3 sm:h-14 sm:gap-3 sm:px-8">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-ink sm:gap-2.5"
        >
          <img
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            aria-hidden
            className="h-6 w-6 shrink-0 rounded-lg transition-transform group-hover:scale-[1.03] sm:h-7 sm:w-7"
          />
          <InkpointWordmark className="min-w-0 max-sm:text-[0.95rem]" />
        </Link>

        <nav className="flex shrink-0 items-center gap-1 sm:gap-2.5" aria-label={t.header.navAria}>
          <Link
            href="/changelog"
            className="inline-flex min-h-10 items-center rounded-full px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink sm:min-h-0 sm:px-3 sm:text-sm"
          >
            <span className="sm:hidden">{t.header.changelogShort}</span>
            <span className="hidden sm:inline">{t.header.changelog}</span>
          </Link>
          <a
            href={PLAYGROUND_PATH}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex min-h-10 items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink sm:min-h-0 sm:px-3 sm:text-sm"
          >
            <span className="sm:hidden">{t.header.playgroundShort}</span>
            <span className="hidden sm:inline">{t.header.playground}</span>
            <svg
              className="h-3 w-3 opacity-60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden min-h-10 items-center rounded-full px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink sm:inline-flex sm:min-h-0 sm:px-3 sm:text-sm"
          >
            {t.header.github}
          </a>
          {catalog ? <HeaderDownloadButton catalog={catalog} /> : null}
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  );
}
