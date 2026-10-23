import { useTranslation } from "@md-editor/i18n";
import { openExternalTarget } from "../../desktop/link-service";
import { APP_DISPLAY_NAME } from "../../lib/app-name";

/**
 * @fileoverview 关于窗口内容
 *
 * 与设置窗口共享同一套主题变量与排版基线；内容固定为「应用身份 + 定位 + 功能要点 + 链接 + 版权」，
 * 不承担更新检查职责（那属于「设置 → 更新」）。
 */

/** 只允许已登记的四条外链，保证 i18n key 与界面按钮一一对应。 */
type AboutLinkKey =
  "about.links.site" | "about.links.changelog" | "about.links.github" | "about.links.license";

interface AboutLink {
  readonly id: string;
  readonly labelKey: AboutLinkKey;
  readonly href: string;
}

const ABOUT_LINKS: readonly AboutLink[] = [
  { id: "site", labelKey: "about.links.site", href: "https://editor.jiaqi.im" },
  {
    id: "changelog",
    labelKey: "about.links.changelog",
    href: "https://editor.jiaqi.im/changelog",
  },
  { id: "github", labelKey: "about.links.github", href: "https://github.com/wmasfoe/md-editor" },
  {
    id: "license",
    labelKey: "about.links.license",
    href: "https://github.com/wmasfoe/md-editor/blob/main/LICENSE",
  },
];

const ABOUT_HIGHLIGHTS = [
  "about.highlights.localFirst",
  "about.highlights.wysiwyg",
  "about.highlights.mdxAndDiagrams",
  "about.highlights.aiCompletion",
] as const;

export function AboutContent({ version }: { readonly version: string }) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-5 px-7 pb-7 pt-2">
      <header className="grid justify-items-center gap-2 text-center">
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          className="size-16 rounded-[14px] border border-[var(--theme-border)] shadow-[0_6px_18px_rgba(0,0,0,0.12)]"
        />
        <h1 className="m-0 text-[22px] font-[650] leading-tight text-[var(--theme-title)]">
          {APP_DISPLAY_NAME}
        </h1>
        <p className="m-0 text-[12px] text-[var(--theme-muted)]">
          {t("about.version", { version })}
        </p>
        <p className="m-0 max-w-[320px] text-[12px] leading-[1.6] text-[var(--theme-text)]">
          {t("about.tagline")}
        </p>
      </header>

      <section aria-labelledby="about-highlights" className="grid gap-2">
        <h2
          id="about-highlights"
          className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]"
        >
          {t("about.highlightsTitle")}
        </h2>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {ABOUT_HIGHLIGHTS.map((key) => (
            <li
              key={key}
              className="flex gap-2 text-[12px] leading-[1.55] text-[var(--theme-control-text)]"
            >
              <span aria-hidden="true" className="select-none text-[var(--theme-muted)]">
                •
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label={t("about.linksTitle")} className="grid gap-1.5">
        {ABOUT_LINKS.map((link) => (
          <button
            key={link.id}
            type="button"
            className="flex items-center justify-between rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-left text-[12px] text-[var(--theme-control-text)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
            onClick={() => void openExternalTarget(link.href)}
          >
            <span>{t(link.labelKey)}</span>
            <span aria-hidden="true" className="text-[var(--theme-muted)]">
              ↗
            </span>
          </button>
        ))}
      </nav>

      <footer className="grid gap-1 border-t border-[var(--theme-border)] pt-3 text-center">
        <p className="m-0 text-[11px] leading-[1.5] text-[var(--theme-muted)]">
          {t("about.copyright")}
        </p>
        <p className="m-0 text-[11px] leading-[1.5] text-[var(--theme-muted)]">
          {t("about.license")}
        </p>
      </footer>
    </div>
  );
}
