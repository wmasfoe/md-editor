import type { ReleasesManifest, ReleaseAssetInfo } from "./types.ts";

/**
 * 格式化字节大小为人类可读格式 (如 30.7 MB)
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 获取平台对应的图标与分类标签
 */
function getPlatformIcon(platform: ReleaseAssetInfo["platform"]): string {
  switch (platform) {
    case "macos-arm64":
    case "macos-x64":
      return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.61 1.34-.55.63-1.03 1.67-.9 2.69 1 .08 2.03-.51 2.59-1.18z"/></svg>`;
    case "windows-x64":
    case "windows-arm64":
      return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>`;
    case "linux-appimage":
    case "linux-deb":
      return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 2.02c-2.32 0-4.22 1.9-4.22 4.22 0 .5.09.98.25 1.42-.09.04-.17.1-.25.16-1.56 1.13-2.14 3.05-1.42 4.67.24.53.58.98 1 1.32-.05.32-.08.65-.08.98 0 3.73 2.11 6.8 4.72 6.8 2.61 0 4.72-3.07 4.72-6.8 0-.33-.03-.66-.08-.98.42-.34.76-.79 1-1.32.72-1.62.14-3.54-1.42-4.67-.08-.06-.16-.12-.25-.16.16-.44.25-.92.25-1.42 0-2.32-1.9-4.22-4.22-4.22zm-1.8 5.61c.42 0 .76.34.76.76 0 .42-.34.76-.76.76-.42 0-.76-.34-.76-.76 0-.42.34-.76.76-.76zm3.6 0c.42 0 .76.34.76.76 0 .42-.34.76-.76.76-.42 0-.76-.34-.76-.76 0-.42.34-.76.76-.76z"/></svg>`;
    case "android":
      return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5898 8.4116 13.8443 8 12 8s-3.5898.4116-5.1368.9507L4.841 5.4477a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9974 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"/></svg>`;
    default:
      return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;
  }
}

/**
 * 渲染 Releases Web Portal 单页 HTML
 */
export function renderReleasesPortalHtml(
  manifest: ReleasesManifest,
  currentOrigin: string,
): string {
  const latest = manifest.releases[0];
  const totalCount = manifest.releases.length;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inkpoint (墨点) 全球版本分发中心 · 历史安装包归档</title>
  <meta name="description" content="Inkpoint 官方边缘分发网关与历史版本下载。提供 macOS、Windows、Linux 与 Android 全平台历史安装包高速直出与更新清单。">
  <link rel="icon" href="https://editor.justdev.cn/favicon.ico">
  <style>
    :root {
      --bg-base: #0a0c10;
      --bg-surface: #11141a;
      --bg-surface-soft: #161b22;
      --bg-surface-raised: #1c2128;
      --line: #30363d;
      --line-subtle: #21262d;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --accent: #10b981;
      --accent-soft: rgba(16, 185, 129, 0.12);
      --accent-hover: #059669;
      --blue: #38bdf8;
      --blue-soft: rgba(56, 189, 248, 0.12);
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-base);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.5;
      min-height: 100vh;
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16, 185, 129, 0.15), transparent),
        radial-gradient(circle at 100% 100%, rgba(56, 189, 248, 0.08), transparent);
      background-attachment: fixed;
    }

    a { color: inherit; text-decoration: none; }
    button { font-family: inherit; }

    .container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px 20px 80px;
    }

    /* 顶部导航 */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: linear-gradient(135deg, #10b981, #0284c7);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .brand-logo svg {
      width: 22px;
      height: 22px;
      fill: #fff;
    }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #fff;
    }
    .brand-tag {
      font-size: 0.72rem;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-weight: 600;
    }
    .nav-links {
      display: flex;
      gap: 16px;
      align-items: center;
      font-size: 0.88rem;
    }
    .nav-link {
      color: var(--text-muted);
      transition: color 0.2s;
    }
    .nav-link:hover {
      color: var(--text);
    }

    /* Hero / 概览 */
    .hero {
      margin-top: 36px;
      text-align: center;
      padding: 10px 0 32px;
    }
    .hero-title {
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(180deg, #fff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    .hero-desc {
      font-size: 1rem;
      color: var(--text-muted);
      max-width: 640px;
      margin: 0 auto;
    }
    .hero-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .edge-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.1);
      color: var(--accent);
      border: 1px solid rgba(16, 185, 129, 0.25);
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 500;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
    }

    /* 快捷最新卡片 */
    .latest-card {
      margin-top: 24px;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
      position: relative;
      overflow: hidden;
    }
    .latest-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, #10b981, #38bdf8);
    }
    .latest-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 20px;
    }
    .latest-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .latest-tag {
      background: #10b981;
      color: #000;
      font-weight: 700;
      font-size: 0.72rem;
      padding: 2px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .latest-version {
      font-size: 1.4rem;
      font-weight: 800;
      color: #fff;
    }
    .latest-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .quick-btn {
      background: var(--bg-surface-raised);
      border: 1px solid var(--line);
      padding: 14px 16px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s;
    }
    .quick-btn:hover {
      background: var(--bg-surface-soft);
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.15);
    }
    .quick-btn-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .quick-btn-info .icon {
      width: 22px;
      height: 22px;
      color: #cbd5e1;
    }
    .quick-btn-title {
      font-size: 0.92rem;
      font-weight: 600;
      color: #fff;
    }
    .quick-btn-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .quick-btn-arrow {
      color: var(--accent);
      font-weight: 700;
    }

    /* 筛选与搜索工具条 */
    .toolbar {
      margin-top: 48px;
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-count {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 400;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .search-box {
      position: relative;
    }
    .search-box input {
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 12px 8px 32px;
      color: #fff;
      font-size: 0.85rem;
      outline: none;
      width: 220px;
      transition: all 0.2s;
    }
    .search-box input:focus {
      border-color: var(--accent);
      width: 260px;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }
    .search-box svg {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 15px;
      height: 15px;
      color: var(--text-muted);
    }
    .tabs {
      display: flex;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover {
      color: #fff;
    }
    .tab-btn.active {
      background: var(--bg-surface-raised);
      color: #fff;
      font-weight: 600;
    }

    /* 版本卡片列表 */
    .releases-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .release-card {
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .release-card:hover {
      border-color: #484f58;
    }
    .release-card-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.015);
    }
    .release-card-header:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .release-version-block {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .release-ver-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
    }
    .release-date {
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .release-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .notes-link {
      font-size: 0.82rem;
      color: var(--blue);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 6px;
      background: var(--blue-soft);
      transition: background 0.2s;
    }
    .notes-link:hover {
      background: rgba(56, 189, 248, 0.22);
    }
    .toggle-icon {
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }
    .release-card.open .toggle-icon {
      transform: rotate(180deg);
    }

    /* 安装包表格 / 网格 */
    .assets-table-wrap {
      padding: 0 20px 18px;
      border-top: 1px solid var(--line-subtle);
    }
    .assets-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    .assets-table th {
      text-align: left;
      font-size: 0.76rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 8px 12px;
      border-bottom: 1px solid var(--line-subtle);
    }
    .assets-table td {
      padding: 12px;
      font-size: 0.86rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .assets-table tr:last-child td {
      border-bottom: none;
    }
    .asset-platform {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      color: #fff;
    }
    .asset-platform .icon {
      width: 16px;
      height: 16px;
      color: #94a3b8;
    }
    .asset-filename {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      color: #cbd5e1;
      word-break: break-all;
    }
    .asset-size {
      color: var(--text-muted);
      font-size: 0.82rem;
      white-space: nowrap;
    }
    .asset-tag-r2 {
      font-size: 0.68rem;
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent);
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
      font-weight: 600;
    }
    .asset-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      white-space: nowrap;
    }
    .btn-download {
      background: var(--accent);
      color: #000;
      font-weight: 600;
      font-size: 0.8rem;
      padding: 6px 14px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-download:hover {
      background: var(--accent-hover);
      color: #fff;
    }
    .btn-copy {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--text-muted);
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-copy:hover {
      color: #fff;
      border-color: #6e7681;
    }

    /* 浮动 Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #161b22;
      border: 1px solid var(--accent);
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s;
      pointer-events: none;
      z-index: 100;
    }
    #toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* 页脚 */
    footer {
      margin-top: 64px;
      padding-top: 24px;
      border-top: 1px solid var(--line-subtle);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .footer-api a {
      color: var(--blue);
      text-decoration: underline;
    }

    @media (max-width: 640px) {
      .hero-title { font-size: 1.6rem; }
      .toolbar { flex-direction: column; align-items: stretch; }
      .controls { flex-direction: column; align-items: stretch; }
      .search-box input { width: 100%; }
      .search-box input:focus { width: 100%; }
      .tabs { overflow-x: auto; }
      .assets-table th:nth-child(3), .assets-table td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
        </div>
        <div>
          <div class="brand-title">Inkpoint · 墨点</div>
        </div>
        <span class="brand-tag">边缘全球分发</span>
      </div>
      <nav class="nav-links">
        <a href="https://editor.justdev.cn" class="nav-link" target="_blank">官网首页</a>
        <a href="https://editor.justdev.cn/changelog" class="nav-link" target="_blank">更新日志</a>
        <a href="https://editor.justdev.cn/playground" class="nav-link" target="_blank">在线体验</a>
        <a href="https://github.com/wmasfoe/md-editor" class="nav-link" target="_blank">GitHub</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <h1 class="hero-title">版本分发中心 · 安装包归档</h1>
        <p class="hero-desc">基于 Cloudflare Worker & R2 边缘存储，提供 Inkpoint macOS、Windows、Linux 与 Android 全平台安装包的高速下载与全量历史归档。</p>
        <div class="hero-meta">
          <span class="edge-badge"><span class="pulse-dot"></span> Cloudflare R2 毫秒级直出</span>
          <span>已归档 ${totalCount} 个版本</span>
          <span>支持断点续传 & 校验和</span>
        </div>
      </section>

      ${
        latest
          ? `
      <section class="latest-card">
        <div class="latest-header">
          <div class="latest-badge">
            <span class="latest-tag">Latest Release</span>
            <span class="latest-version">v${latest.version}</span>
          </div>
          <a href="${latest.releaseNotesUrl}" target="_blank" class="notes-link">
            <span>查看 v${latest.version} 更新日志</span>
            <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
          </a>
        </div>
        <div class="latest-grid">
          <a href="${currentOrigin}/inkpoint/desktop/macos/latest" class="quick-btn">
            <div class="quick-btn-info">
              ${getPlatformIcon("macos-arm64")}
              <div>
                <div class="quick-btn-title">macOS</div>
                <div class="quick-btn-sub">Apple Silicon / Intel · DMG</div>
              </div>
            </div>
            <span class="quick-btn-arrow">↓</span>
          </a>
          <a href="${currentOrigin}/inkpoint/desktop/windows/latest" class="quick-btn">
            <div class="quick-btn-info">
              ${getPlatformIcon("windows-x64")}
              <div>
                <div class="quick-btn-title">Windows</div>
                <div class="quick-btn-sub">x64 / ARM64 · Setup.exe</div>
              </div>
            </div>
            <span class="quick-btn-arrow">↓</span>
          </a>
          <a href="${currentOrigin}/inkpoint/desktop/linux/latest" class="quick-btn">
            <div class="quick-btn-info">
              ${getPlatformIcon("linux-appimage")}
              <div>
                <div class="quick-btn-title">Linux</div>
                <div class="quick-btn-sub">x86_64 · AppImage</div>
              </div>
            </div>
            <span class="quick-btn-arrow">↓</span>
          </a>
          <a href="${currentOrigin}/inkpoint/android/latest" class="quick-btn">
            <div class="quick-btn-info">
              ${getPlatformIcon("android")}
              <div>
                <div class="quick-btn-title">Android (Beta)</div>
                <div class="quick-btn-sub">通用架构 · APK</div>
              </div>
            </div>
            <span class="quick-btn-arrow">↓</span>
          </a>
        </div>
      </section>
      `
          : ""
      }

      <div class="toolbar">
        <div class="section-title">
          <span>历史版本清单</span>
          <span class="section-count">共 ${totalCount} 个已发布版本</span>
        </div>
        <div class="controls">
          <div class="tabs" role="tablist">
            <button class="tab-btn active" onclick="setFilter('all', this)">全部</button>
            <button class="tab-btn" onclick="setFilter('macos', this)">macOS</button>
            <button class="tab-btn" onclick="setFilter('windows', this)">Windows</button>
            <button class="tab-btn" onclick="setFilter('linux', this)">Linux</button>
            <button class="tab-btn" onclick="setFilter('android', this)">Android</button>
          </div>
          <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" id="searchInput" placeholder="搜索版本号 (如 0.10)..." oninput="handleSearch(this.value)">
          </div>
        </div>
      </div>

      <div class="releases-list" id="releasesList">
        ${manifest.releases
          .map(
            (release, index) => `
        <article class="release-card ${index === 0 ? "open" : ""}" data-version="${release.version}">
          <div class="release-card-header" onclick="toggleCard(this)">
            <div class="release-version-block">
              <span class="release-ver-title">v${release.version}</span>
              ${index === 0 ? '<span class="latest-tag">Latest</span>' : ""}
              <time class="release-date">${release.publishedAt.slice(0, 10)}</time>
            </div>
            <div class="release-actions" onclick="event.stopPropagation()">
              <a href="${release.releaseNotesUrl}" target="_blank" class="notes-link" title="在 GitHub 查看版本发布详情">
                <span>Release Notes</span>
                <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
              </a>
              <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" onclick="toggleCard(this.closest('.release-card-header'))"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>
          <div class="assets-table-wrap" style="${index === 0 ? "" : "display:none;"}">
            <table class="assets-table">
              <thead>
                <tr>
                  <th>平台 / 类型</th>
                  <th>文件名</th>
                  <th>文件大小</th>
                  <th style="text-align:right;">下载操作</th>
                </tr>
              </thead>
              <tbody>
                ${release.assets
                  .map(
                    (asset) => `
                <tr class="asset-row" data-platform="${asset.platform}">
                  <td>
                    <div class="asset-platform">
                      ${getPlatformIcon(asset.platform)}
                      <span>${asset.platformLabel}</span>
                      ${asset.isR2Cached ? '<span class="asset-tag-r2">R2 边缘直出</span>' : ""}
                    </div>
                  </td>
                  <td>
                    <span class="asset-filename">${asset.fileName}</span>
                  </td>
                  <td>
                    <span class="asset-size">${asset.formattedSize}</span>
                  </td>
                  <td>
                    <div class="asset-actions">
                      <button class="btn-copy" onclick="copyLink('${asset.downloadUrl}')" title="复制直链">复制链接</button>
                      <a href="${asset.downloadUrl}" download="${asset.fileName}" class="btn-download">下载</a>
                    </div>
                  </td>
                </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
        `,
          )
          .join("")}
      </div>
    </main>

    <footer>
      <div>
        <p>© ${new Date().getFullYear()} Inkpoint (墨点) · Powered by Cloudflare Workers & R2 Storage</p>
      </div>
      <div class="footer-api">
        <span>机器接口: </span>
        <a href="${currentOrigin}/api/inkpoint/releases" target="_blank">/api/inkpoint/releases</a> ·
        <a href="${currentOrigin}/api/inkpoint/version.json" target="_blank">/api/inkpoint/version.json</a>
      </div>
    </footer>
  </div>

  <div id="toast">链接已复制到剪贴板</div>

  <script>
    let activeFilter = 'all';
    let searchQuery = '';

    function toggleCard(headerEl) {
      const card = headerEl.closest('.release-card');
      const tableWrap = card.querySelector('.assets-table-wrap');
      const isOpen = card.classList.contains('open');
      if (isOpen) {
        card.classList.remove('open');
        tableWrap.style.display = 'none';
      } else {
        card.classList.add('open');
        tableWrap.style.display = 'block';
      }
    }

    function setFilter(platform, btn) {
      activeFilter = platform;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    }

    function handleSearch(val) {
      searchQuery = val.trim().toLowerCase();
      applyFilters();
    }

    function applyFilters() {
      const cards = document.querySelectorAll('.release-card');
      cards.forEach(card => {
        const ver = (card.getAttribute('data-version') || '').toLowerCase();
        const matchesSearch = !searchQuery || ver.includes(searchQuery);

        let visibleRows = 0;
        const rows = card.querySelectorAll('.asset-row');
        rows.forEach(row => {
          const plat = row.getAttribute('data-platform') || '';
          const matchesPlatform = activeFilter === 'all' || plat.includes(activeFilter);
          if (matchesPlatform) {
            row.style.display = '';
            visibleRows++;
          } else {
            row.style.display = 'none';
          }
        });

        if (matchesSearch && (visibleRows > 0 || rows.length === 0)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    }

    function copyLink(url) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => showToast());
      } else {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast();
      }
    }

    function showToast() {
      const t = document.getElementById('toast');
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }
  </script>
</body>
</html>`;
}
