"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ChangelogEntry, ChangelogItem } from "../lib/changelog";
import { useI18n } from "../lib/i18n/context";
import type { TranslationSchema } from "../lib/i18n/types";
import {
  asDisplayText,
  asJsonRecord,
  asJsonRecordArray,
  asPrNumbers,
  buildModelPrUrl,
  MODEL_CHANGELOG_URL,
  type JsonRecord,
} from "../lib/model-changelog";
import { buildAppPrUrl } from "../lib/site-links";

interface ChangelogContentProps {
  entries: ChangelogEntry[];
  modelChangelog: unknown;
}

type ChangelogSource = "client" | "model";
type ChangelogLabels = TranslationSchema["changelog"];

const ITEM_TYPE_STYLES: Record<string, string> = {
  feat: "border-emerald-600/20 bg-emerald-600/10 text-emerald-700",
  perf: "border-sky-600/20 bg-sky-600/10 text-sky-700",
  fix: "border-amber-600/25 bg-amber-500/10 text-amber-800",
  refactor: "border-line-strong bg-surface-soft text-ink-soft",
  breaking: "border-rose-600/20 bg-rose-600/10 text-rose-700",
  other: "border-line-strong bg-surface-soft text-muted",
};

export function ChangelogContent({ entries, modelChangelog }: ChangelogContentProps) {
  const { t } = useI18n();
  const [source, setSource] = useState<ChangelogSource>("client");
  const clientTabRef = useRef<HTMLButtonElement>(null);
  const modelTabRef = useRef<HTMLButtonElement>(null);
  const isClient = source === "client";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      const tabParam = url.searchParams.get("tab") ?? url.searchParams.get("source");
      if (tabParam === "model" || window.location.hash === "#model") {
        setSource("model");
      } else if (tabParam === "client" || window.location.hash === "#client") {
        setSource("client");
      }
    };

    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  function selectSource(nextSource: ChangelogSource, moveFocus = false) {
    setSource(nextSource);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      url.searchParams.delete("source");
      url.hash = nextSource === "model" ? "#model" : "#client";
      window.history.replaceState(null, "", url.toString());
    }
    if (moveFocus) {
      const target = nextSource === "client" ? clientTabRef : modelTabRef;
      requestAnimationFrame(() => target.current?.focus());
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextSource =
      event.key === "Home"
        ? "client"
        : event.key === "End"
          ? "model"
          : source === "client"
            ? "model"
            : "client";
    selectSource(nextSource, true);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8 sm:py-20">
      <header className="mb-10 border-b border-line pb-8 sm:mb-14 sm:pb-10">
        <p className="mb-3 text-xs font-medium tracking-[0.08em] text-accent uppercase sm:text-sm">
          {t.changelog.badge}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t.changelog.title}
        </h1>

        {isClient ? (
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted sm:mt-4 sm:text-base">
            {t.changelog.descriptionPrefix}{" "}
            <code className="rounded-md bg-surface-soft px-1.5 py-0.5 text-[13px] break-all text-ink-soft">
              CHANGELOG.md
            </code>
            {t.changelog.descriptionSuffix}
          </p>
        ) : (
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted sm:mt-4 sm:text-base">
            {t.changelog.modelDescriptionPrefix}{" "}
            <a
              href={MODEL_CHANGELOG_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[13px] break-all text-ink-soft transition-colors hover:text-ink"
            >
              changelog.json
            </a>{" "}
            {t.changelog.modelDescriptionSuffix}
          </p>
        )}

        <div
          className="mt-6 inline-flex rounded-lg border border-line bg-surface-soft p-1"
          role="tablist"
          aria-label={t.changelog.tabsAria}
          onKeyDown={handleTabKeyDown}
        >
          <ChangelogTab
            active={isClient}
            buttonRef={clientTabRef}
            controls="client-changelog-panel"
            id="client-changelog-tab"
            onSelect={() => selectSource("client")}
          >
            {t.changelog.clientTab}
          </ChangelogTab>
          <ChangelogTab
            active={!isClient}
            buttonRef={modelTabRef}
            controls="model-changelog-panel"
            id="model-changelog-tab"
            onSelect={() => selectSource("model")}
          >
            {t.changelog.modelTab}
          </ChangelogTab>
        </div>
      </header>

      <section
        id="client-changelog-panel"
        role="tabpanel"
        aria-labelledby="client-changelog-tab"
        hidden={!isClient}
        className={isClient ? undefined : "hidden"}
      >
        <ClientChangelogTimeline entries={entries} labels={t.changelog} />
      </section>
      <section
        id="model-changelog-panel"
        role="tabpanel"
        aria-labelledby="model-changelog-tab"
        hidden={isClient}
        className={!isClient ? undefined : "hidden"}
      >
        {t.changelog.modelOriginalLanguage ? (
          <p className="mb-5 text-sm text-muted">{t.changelog.modelOriginalLanguage}</p>
        ) : null}
        <ModelChangelogTimeline payload={modelChangelog} labels={t.changelog} />
      </section>

      <div className="mt-10 sm:mt-12">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink sm:min-h-0"
        >
          <span aria-hidden>←</span>
          {t.changelog.backHome}
        </Link>
      </div>
    </main>
  );
}

function ChangelogTab({
  active,
  buttonRef,
  children,
  controls,
  id,
  onSelect,
}: {
  active: boolean;
  buttonRef: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
  controls: string;
  id: string;
  onSelect: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={[
        "min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ClientChangelogTimeline({
  entries,
  labels,
}: {
  entries: ChangelogEntry[];
  labels: ChangelogLabels;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">{labels.empty}</p>;
  }

  return (
    <ol className="relative" aria-label={labels.listAria}>
      {entries.map((entry, index) => (
        <li
          key={entry.version}
          className="relative border-b border-line/80 py-8 pl-6 last:border-b-0 sm:py-10 sm:pl-10"
        >
          <TimelineMarker latest={index === 0} />
          <article>
            <header className="mb-3.5 sm:mb-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                  v{entry.version}
                </h2>
                <time className="text-sm text-muted" dateTime={entry.date}>
                  {entry.date}
                </time>
                {index === 0 ? <StatusBadge>{labels.latestBadge}</StatusBadge> : null}
              </div>
              <PullRequestLine
                prs={entry.sourcePR ?? []}
                buildUrl={buildAppPrUrl}
                labels={labels}
              />
            </header>
            <ul className="space-y-3">
              {entry.items.map((item, itemIndex) => (
                <ClientChangelogItemView key={itemIndex} item={item} />
              ))}
            </ul>
          </article>
        </li>
      ))}
    </ol>
  );
}

function ModelChangelogTimeline({
  payload,
  labels,
}: {
  payload: unknown;
  labels: ChangelogLabels;
}) {
  const root = asJsonRecord(payload);
  const releases = asJsonRecordArray(root?.releases);
  const declaredLatestVersion = asDisplayText(root?.latestVersion);

  if (releases.length === 0) {
    return <p className="text-sm text-muted">{labels.modelEmpty}</p>;
  }

  return (
    <ol className="relative" aria-label={labels.modelListAria}>
      {releases.map((release, releaseIndex) => {
        const version = asDisplayText(release.version);
        const date = asDisplayText(release.date);
        const summary = asDisplayText(release.summary);
        const impact = asDisplayText(release.impact);
        const sourcePR = asPrNumbers(release.sourcePR ?? release.sourcePr);
        const sections = asJsonRecordArray(release.sections);
        const isLatest = declaredLatestVersion
          ? version === declaredLatestVersion
          : releaseIndex === 0;

        return (
          <li
            key={`${version ?? "release"}-${releaseIndex}`}
            className="relative border-b border-line/80 py-8 pl-6 last:border-b-0 sm:py-10 sm:pl-10"
          >
            <TimelineMarker latest={isLatest} />
            <article>
              <header className="mb-3.5 sm:mb-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {version ? (
                    <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                      v{version}
                    </h2>
                  ) : null}
                  {date ? (
                    <time className="text-sm text-muted" dateTime={date}>
                      {date}
                    </time>
                  ) : null}
                  {isLatest ? <StatusBadge>{labels.latestBadge}</StatusBadge> : null}
                  {impact === "major" ? (
                    <StatusBadge tone="important">{labels.importantBadge}</StatusBadge>
                  ) : null}
                </div>
                <PullRequestLine prs={sourcePR} buildUrl={buildModelPrUrl} labels={labels} />
              </header>

              {summary ? (
                <p className="text-[15px] leading-relaxed text-ink-soft">{summary}</p>
              ) : null}

              {sections.map((section, sectionIndex) => (
                <ModelChangelogSection
                  key={`${asDisplayText(section.title) ?? "section"}-${sectionIndex}`}
                  section={section}
                  labels={labels}
                />
              ))}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function ModelChangelogSection({
  section,
  labels,
}: {
  section: JsonRecord;
  labels: ChangelogLabels;
}) {
  const title = asDisplayText(section.title);
  const items = asJsonRecordArray(section.items);

  if (!title && items.length === 0) {
    return null;
  }

  return (
    <section className="mt-6 first:mt-5">
      {title ? <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3> : null}
      {items.length > 0 ? (
        <ul className="space-y-3.5">
          {items.map((item, itemIndex) => (
            <ModelChangelogItem
              key={`${asDisplayText(item.title) ?? "item"}-${itemIndex}`}
              item={item}
              labels={labels}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ModelChangelogItem({ item, labels }: { item: JsonRecord; labels: ChangelogLabels }) {
  const title = asDisplayText(item.title);
  const description = asDisplayText(item.description);
  const type = asDisplayText(item.type);
  const badge = type ? getItemTypeBadge(type, labels) : null;

  if (!title && !description && !badge) {
    return null;
  }

  return (
    <li className="flex gap-2.5 text-[15px] leading-relaxed text-ink-soft">
      <Bullet />
      <div className="min-w-0 flex-1 text-pretty break-words">
        <div className="flex flex-wrap items-center gap-2">
          {badge ? (
            <span
              className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          ) : null}
          {title ? <span className="font-medium text-ink">{title}</span> : null}
        </div>
        {description ? <p className={title || badge ? "mt-1" : ""}>{description}</p> : null}
      </div>
    </li>
  );
}

function getItemTypeBadge(type: string, labels: ChangelogLabels) {
  const label =
    type === "feat"
      ? labels.itemTypes.feat
      : type === "perf"
        ? labels.itemTypes.perf
        : type === "fix"
          ? labels.itemTypes.fix
          : type === "refactor"
            ? labels.itemTypes.refactor
            : type === "breaking"
              ? labels.itemTypes.breaking
              : type === "other"
                ? labels.itemTypes.other
                : null;

  const className = ITEM_TYPE_STYLES[type];
  return label && className ? { label, className } : null;
}

function TimelineMarker({ latest }: { latest: boolean }) {
  return (
    <>
      {/* 每条版本记录共享同一时间轴；最新版本使用强调色。 */}
      <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-line" />
      <span
        aria-hidden
        className={[
          "absolute top-10 left-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-canvas sm:top-12",
          latest ? "bg-accent" : "bg-line-strong",
        ].join(" ")}
      />
    </>
  );
}

function StatusBadge({
  children,
  tone = "latest",
}: {
  children: React.ReactNode;
  tone?: "latest" | "important";
}) {
  return (
    <span
      className={[
        "rounded-md px-2 py-0.5 text-xs font-medium",
        tone === "important" ? "bg-seal/10 text-seal" : "bg-accent/10 text-accent",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function Bullet({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full ${
        active ? "bg-accent/85" : "bg-muted/60"
      }`}
    />
  );
}

function ClientChangelogItemView({ item }: { item: ChangelogItem }) {
  const hasChildren = Boolean(item.items && item.items.length > 0);

  return (
    <li className="space-y-2">
      <div className="flex gap-2.5 text-[15px] leading-relaxed text-ink-soft">
        <Bullet active={hasChildren} />
        <span
          className={`min-w-0 flex-1 text-pretty break-words ${
            hasChildren ? "font-medium text-ink" : ""
          }`}
        >
          {renderInlineMarkdown(item.text)}
        </span>
      </div>
      {hasChildren ? (
        <ul className="mt-2 ml-4.5 space-y-2 border-l border-line/80 pl-3.5 sm:ml-5 sm:pl-4">
          {item.items!.map((child, childIndex) => (
            <ClientChangelogSubItemView key={childIndex} item={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ClientChangelogSubItemView({ item }: { item: ChangelogItem }) {
  const hasChildren = Boolean(item.items && item.items.length > 0);

  return (
    <li className="space-y-1.5">
      <div className="flex gap-2.5 text-[14px] leading-relaxed text-ink-soft/90">
        <span
          aria-hidden
          className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full border border-muted/70 bg-surface"
        />
        <span
          className={`min-w-0 flex-1 text-pretty break-words ${
            hasChildren ? "font-medium text-ink" : ""
          }`}
        >
          {renderInlineMarkdown(item.text)}
        </span>
      </div>
      {hasChildren ? (
        <ul className="mt-1.5 ml-3 space-y-1.5 border-l border-line/60 pl-2.5">
          {item.items!.map((child, childIndex) => (
            <ClientChangelogSubItemView key={childIndex} item={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PullRequestLine({
  prs,
  buildUrl,
  labels,
}: {
  prs: number[];
  buildUrl: (pr: number) => string;
  labels: ChangelogLabels;
}) {
  if (!prs || prs.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
      <span className="font-medium text-muted/80">PR:</span>
      <div className="inline-flex flex-wrap items-center">
        {prs.map((prNumber, idx) => (
          <span key={prNumber} className="inline-flex items-center">
            <a
              href={buildUrl(prNumber)}
              target="_blank"
              rel="noreferrer"
              aria-label={labels.pullRequestAria.replace("{number}", String(prNumber))}
              className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              <PullRequestIcon className="h-3.5 w-3.5 text-accent/80 transition-transform group-hover:scale-110" />
              <span className="underline decoration-accent/40 underline-offset-2 group-hover:decoration-accent">
                #{prNumber}
              </span>
            </a>
            {idx < prs.length - 1 ? <span className="text-muted/60 select-none">、</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function PullRequestIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.5 5.396V7.5a.75.75 0 0 1-1.5 0V5.707L6.823 4.53a.75.75 0 0 1 .354-1.457Zm4.573 5.304a2.25 2.25 0 1 1 1.5 0v2.246a2.25 2.25 0 1 1-1.5 0V8.377ZM3 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm0 9.5a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm9.5-4.123a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 4.123a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
    </svg>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokenRegex =
    /((?<!`)`([^`\n]+)`(?!`)|(?<!`)\*\*([^*]+)\*\*(?!\*)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/gu;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    const codeMatch = match[2];
    const boldMatch = match[3];
    const linkText = match[4];
    const linkUrl = match[5];

    if (codeMatch !== undefined) {
      result.push(
        <code
          key={match.index}
          className="rounded-md border border-line/70 bg-surface-soft px-1.5 py-0.5 font-mono text-[13px] text-ink"
        >
          {codeMatch}
        </code>,
      );
    } else if (boldMatch !== undefined) {
      result.push(
        <strong key={match.index} className="font-semibold text-ink">
          {boldMatch}
        </strong>,
      );
    } else if (linkText !== undefined && linkUrl !== undefined) {
      result.push(
        <a
          key={match.index}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-80"
        >
          {linkText}
        </a>,
      );
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
