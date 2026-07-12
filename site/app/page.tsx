import Link from "next/link";
import { InstallCommand } from "../components/install-command";
import { LiquidGlass, LiquidGlassGroup } from "../components/liquid-glass-link";
import { getChangelogEntries } from "../lib/changelog";
import { buildMacosDmgUrl, GITHUB_RELEASES_URL } from "../lib/site-links";

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh";

// 手动安装 DMG 时移除隔离标记；安装脚本会默认处理，此命令给手动下载用户备用。
const quarantineCommand = "xattr -dr com.apple.quarantine /Applications/Markdown\\ Editor.app";

const features = [
  {
    title: "本地优先",
    description: "文件就在你的磁盘上。无需账号，也不依赖云同步。",
  },
  {
    title: "Markdown / MDX",
    description: "日常写作与组件化内容同一套编辑体验。",
  },
  {
    title: "桌面工作流",
    description: "文件树、最近文件、图片粘贴与原生菜单开箱即用。",
  },
] as const;

export default function HomePage() {
  const [latest] = getChangelogEntries();
  const dmgUrl = latest ? buildMacosDmgUrl(latest.version) : GITHUB_RELEASES_URL;

  return (
    <main>
      {/* Hero：文案保持克制；液态玻璃 CTA 叠在高饱和 backdrop 上才可见折射 */}
      <section className="mx-auto max-w-5xl px-4 pb-14 pt-12 sm:px-8 sm:pb-28 sm:pt-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-4 text-xs font-medium tracking-[0.08em] text-accent uppercase sm:mb-5 sm:text-sm">
            Markdown / MDX Desktop
          </p>
          <h1 className="text-balance text-[2rem] font-semibold leading-[1.15] tracking-tight text-ink sm:text-5xl sm:leading-[1.1]">
            写得更专注
            <span className="mt-1.5 block font-normal text-ink-soft sm:mt-2">
              本地 Markdown 编辑器
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-muted sm:mt-6 sm:text-lg">
            一个简洁的本地 Markdown 编辑器，用来处理日常写作、MDX 内容和桌面文件流。
          </p>

          {/* 固定槽位 + 居中锚点，避免 liquid-glass-react 的 -50% transform 打散 flex */}
          <LiquidGlassGroup className="site-hero-ctas mt-8 sm:mt-10">
            <LiquidGlass
              href={dmgUrl}
              tone="primary"
              download={
                latest ? `Markdown.Editor_${latest.version}_aarch64.dmg` : true
              }
            >
              下载 macOS 版本
            </LiquidGlass>
            <LiquidGlass href={GITHUB_RELEASES_URL} tone="secondary" external>
              历史版本
            </LiquidGlass>
          </LiquidGlassGroup>

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm text-muted">
            {latest ? (
              <span>
                最新 v{latest.version}
                <span className="mx-1.5 text-line-strong">·</span>
                Apple Silicon
              </span>
            ) : null}
            <span className="text-ink-soft transition-colors">Windows 版本敬请期待</span>
          </p>
        </div>

        <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 sm:mt-14 sm:gap-4">
          <InstallCommand command={installCommand} recommended />
          <InstallCommand title="若提示「已损坏」· 移除隔离标记" command={quarantineCommand} />
        </div>
      </section>

      <section aria-label="主要能力" className="px-4 py-2 sm:px-8 sm:py-4">
        <div className="site-panel-soft mx-auto grid max-w-5xl overflow-hidden rounded-3xl sm:grid-cols-3">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={[
                "px-5 py-9 sm:px-8 sm:py-12",
                index > 0
                  ? "border-t border-white/10 sm:border-t-0 sm:border-l sm:border-white/10"
                  : "",
              ].join(" ")}
            >
              <h2 className="text-base font-semibold tracking-tight text-ink">{feature.title}</h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted sm:mt-3 sm:text-[15px]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 sm:gap-6 sm:px-8 sm:py-20">
        <article className="site-panel rounded-2xl p-5 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-muted">最新版本</h2>
            {latest ? (
              <Link
                href="/changelog"
                className="inline-flex min-h-10 items-center text-sm text-accent transition-opacity hover:opacity-80 sm:min-h-0"
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
              <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
                <a
                  href={dmgUrl}
                  download={`Markdown.Editor_${latest.version}_aarch64.dmg`}
                  className="inline-flex min-h-10 items-center text-sm font-medium text-ink transition-opacity hover:opacity-80 sm:min-h-0"
                >
                  下载 DMG
                </a>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center text-sm text-muted transition-colors hover:text-ink sm:min-h-0"
                >
                  历史版本
                </a>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">暂无更新记录</p>
          )}
        </article>

        <article className="site-panel rounded-2xl p-5 sm:p-8">
          <h2 className="text-sm font-medium tracking-wide text-muted">Web App</h2>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">计划中</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            第一版官网只保留入口状态，不提供在线编辑器。桌面端仍是完整产品形态。
          </p>
          <span className="mt-6 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-muted">
            暂未开放
          </span>
        </article>
      </section>
    </main>
  );
}
