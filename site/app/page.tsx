import Link from "next/link";
import { InstallCommand } from "../components/install-command";
import { getChangelogEntries } from "../lib/changelog";
import {
  buildMacosDmgUrl,
  GITHUB_RELEASES_URL
} from "../lib/site-links";

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh";

// 手动安装 DMG 时移除隔离标记；安装脚本会默认处理，此命令给手动下载用户备用。
const quarantineCommand =
  "xattr -dr com.apple.quarantine /Applications/Markdown\\ Editor.app";

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
  const dmgUrl = latest ? buildMacosDmgUrl(latest.version) : GITHUB_RELEASES_URL;

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
              href={dmgUrl}
              // 跨域时 download 属性可能被浏览器忽略；GitHub asset 仍会以 attachment 触发下载。
              download={latest ? `Markdown.Editor_${latest.version}_aarch64.dmg` : undefined}
              className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              下载 macOS 版本
            </a>
            <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong bg-surface px-6 text-sm font-medium text-ink-soft transition-colors hover:border-ink/20 hover:text-ink"
            >
              历史版本
            </a>
          </div>

          {/* 次要入口：版本说明 + 源码，保持一行不抢主 CTA。 */}
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted">
            {latest ? (
              <span>
                最新 v{latest.version}
                <span className="mx-1.5 text-line-strong">·</span>
                Apple Silicon
              </span>
            ) : null}
            <span
              className="text-ink-soft transition-colors"
            >
              Windows 版本敬请期待
            </span>
          </p>
        </div>

        <div className="mx-auto mt-14 flex max-w-2xl flex-col gap-4">
          <InstallCommand command={installCommand} recommended />
          <InstallCommand
            title="若提示「已损坏」· 移除隔离标记"
            command={quarantineCommand}
          />
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
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href={dmgUrl}
                  download={`Markdown.Editor_${latest.version}_aarch64.dmg`}
                  className="text-sm font-medium text-ink transition-opacity hover:opacity-80"
                >
                  下载 DMG
                </a>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted transition-colors hover:text-ink"
                >
                  历史版本
                </a>
              </div>
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
