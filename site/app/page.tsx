import Link from "next/link";
import { InstallCommand } from "../components/install-command";
import { getChangelogEntries } from "../lib/changelog";

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh";

const features = [
  {
    title: "本地优先",
    description: "文件就在你的磁盘上。无需账号，也不依赖云同步。"
  },
  {
    title: "Markdown / MDX",
    description: "日常写作与组件化内容同一套编辑体验。"
  },
  {
    title: "桌面工作流",
    description: "文件树、最近文件、图片粘贴与原生菜单开箱即用。"
  }
] as const;

export default function HomePage() {
  const [latest] = getChangelogEntries();

  return (
    <main>
      {/* Hero：大量留白 + 克制字重，突出产品一句话价值。 */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-5 text-sm font-medium tracking-[0.08em] text-accent uppercase">
            Markdown / MDX Desktop
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl sm:leading-[1.1]">
            写得更专注
            <span className="mt-2 block font-normal text-ink-soft">本地 Markdown 编辑器</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            一个简洁的本地 Markdown 编辑器，用来处理日常写作、MDX 内容和桌面文件流。
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/wmasfoe/homebrew-tap/releases"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              下载 macOS 版本
            </a>
            <Link
              href="/changelog"
              className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong bg-surface px-6 text-sm font-medium text-ink-soft transition-colors hover:border-ink/20 hover:text-ink"
            >
              查看更新记录
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-2xl">
          <InstallCommand command={installCommand} />
        </div>
      </section>

      {/* 能力要点：三列等宽，弱化装饰。 */}
      <section
        aria-label="主要能力"
        className="border-y border-line/80 bg-surface/60"
      >
        <div className="mx-auto grid max-w-5xl gap-px bg-line/80 sm:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="bg-canvas px-6 py-10 sm:px-8 sm:py-12">
              <h2 className="text-base font-semibold tracking-tight text-ink">{feature.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 版本与状态：两列信息卡，密度低于 hero。 */}
      <section className="mx-auto grid max-w-5xl gap-6 px-6 py-16 sm:grid-cols-2 sm:px-8 sm:py-20">
        <article className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-muted">最新版本</h2>
            {latest ? (
              <Link
                href="/changelog"
                className="text-sm text-accent transition-opacity hover:opacity-80"
              >
                全部记录
              </Link>
            ) : null}
          </div>
          {latest ? (
            <>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">
                v{latest.version}
              </p>
              <p className="mt-1 text-sm text-muted">{latest.date}</p>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">{latest.items[0]}</p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">暂无更新记录</p>
          )}
        </article>

        <article className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="text-sm font-medium tracking-wide text-muted">Web App</h2>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">计划中</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            第一版官网只保留入口状态，不提供在线编辑器。桌面端仍是完整产品形态。
          </p>
          <span className="mt-6 inline-flex rounded-full border border-line bg-surface-soft px-3 py-1 text-xs font-medium text-muted">
            暂未开放
          </span>
        </article>
      </section>
    </main>
  );
}
