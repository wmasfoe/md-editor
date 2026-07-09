import type { Metadata } from "next";
import Link from "next/link";
import { getChangelogEntries } from "../../lib/changelog";

export const metadata: Metadata = {
  title: "更新记录"
};

export default function ChangelogPage() {
  const entries = getChangelogEntries();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-8 sm:py-20">
      <header className="mb-14 border-b border-line pb-10">
        <p className="mb-3 text-sm font-medium tracking-[0.08em] text-accent uppercase">
          Releases
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">更新记录</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          每个版本的变更说明。内容来自仓库根目录{" "}
          <code className="rounded-md bg-surface-soft px-1.5 py-0.5 text-[13px] text-ink-soft">
            CHANGELOG.md
          </code>
          。
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">暂无更新记录。</p>
      ) : (
        <ol className="relative" aria-label="更新记录列表">
          {entries.map((entry, index) => (
            <li
              key={entry.version}
              className="relative border-b border-line/80 py-10 pl-8 last:border-b-0 sm:pl-10"
            >
              {/* 时间轴竖线与节点：最新版本用 accent 强调。 */}
              <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-line" />
              <span
                aria-hidden
                className={[
                  "absolute top-12 left-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-canvas",
                  index === 0 ? "bg-accent" : "bg-line-strong"
                ].join(" ")}
              />

              <article>
                <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-xl font-semibold tracking-tight text-ink">
                    v{entry.version}
                  </h2>
                  <time className="text-sm text-muted" dateTime={entry.date}>
                    {entry.date}
                  </time>
                  {index === 0 ? (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
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
                      <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-muted/50" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <span aria-hidden>←</span>
          返回首页
        </Link>
      </div>
    </main>
  );
}
