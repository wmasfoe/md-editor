import type { Metadata } from "next";
import Link from "next/link";
import { getChangelogEntries } from "../../lib/changelog";

export const metadata: Metadata = {
  title: "更新记录",
};

export default function ChangelogPage() {
  const entries = getChangelogEntries();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8 sm:py-20">
      <header className="site-panel mb-10 rounded-3xl p-6 sm:mb-14 sm:p-8">
        <p className="mb-3 text-xs font-medium tracking-[0.08em] text-accent uppercase sm:text-sm">
          Releases
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-4xl">更新记录</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted sm:mt-4 sm:text-base">
          每个版本的变更说明。内容来自仓库根目录{" "}
          <code className="rounded-md border border-white/15 bg-white/10 px-1.5 py-0.5 text-[13px] break-all text-ink-soft">
            CHANGELOG.md
          </code>
          。
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">暂无更新记录。</p>
      ) : (
        <ol
          className="site-panel relative overflow-hidden rounded-3xl px-5 sm:px-8"
          aria-label="更新记录列表"
        >
          {entries.map((entry, index) => (
            <li
              key={entry.version}
              className="relative border-b border-white/10 py-8 pl-6 last:border-b-0 sm:py-10 sm:pl-10"
            >
              <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-white/20" />
              <span
                aria-hidden
                className={[
                  "absolute top-10 left-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white/30 sm:top-12",
                  index === 0 ? "bg-accent" : "bg-white/35",
                ].join(" ")}
              />

              <article>
                <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                    v{entry.version}
                  </h2>
                  <time className="text-sm text-muted" dateTime={entry.date}>
                    {entry.date}
                  </time>
                  {index === 0 ? (
                    <span className="rounded-full border border-accent/25 bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                      最新
                    </span>
                  ) : null}
                </header>

                <ul className="space-y-2.5">
                  {entry.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 text-[15px] leading-relaxed text-ink-soft"
                    >
                      <span
                        aria-hidden
                        className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-muted/60"
                      />
                      <span className="min-w-0 text-pretty break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-10 sm:mt-12">
        <Link
          href="/"
          className="site-panel inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-ink-soft transition-opacity hover:opacity-95 sm:min-h-0"
        >
          <span aria-hidden>←</span>
          <span>返回首页</span>
        </Link>
      </div>
    </main>
  );
}
