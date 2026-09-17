import type { ReleaseInfo, ReleasesManifest } from "./types.ts";

/**
 * 官网风格边缘分发网关样式系统：
 * 1. 契合 Inkpoint 宣纸/石色暖调设计语言，自适应深色模式；
 * 2. 完美适配移动端（支持卡片式自适应流式排版、无水平溢出、44px 最小触控热区）；
 * 3. 桌面端提供清爽、高密度排版表格，微高光与细腻边框质感；
 * 4. 严格保留所有测试断言所需的核心关键字与路径。
 */
const BASE_STYLES = `
  :root {
    --bg: #faf9f6;
    --surface: #ffffff;
    --surface-soft: #f4f2eb;
    --surface-raised: #ffffff;
    --text: #14120f;
    --text-soft: #3f3a34;
    --text-muted: #7a736a;
    --border: #e8e4dc;
    --border-strong: #d6d0c4;
    --link: #1f6feb;
    --link-hover: #0952be;
    --accent: #1f6feb;
    --accent-soft: rgba(31, 111, 235, 0.08);
    --badge-latest-bg: rgba(31, 111, 235, 0.1);
    --badge-latest-text: #1f6feb;
    --badge-edge-bg: rgba(5, 150, 105, 0.1);
    --badge-edge-text: #059669;
    --badge-github-bg: rgba(122, 115, 106, 0.1);
    --badge-github-text: #5a5349;
    --shadow-sm: 0 1px 2px rgba(20, 18, 15, 0.04);
    --shadow-card: 0 4px 20px -2px rgba(28, 25, 23, 0.05), 0 1px 3px 0 rgba(28, 25, 23, 0.03);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121110;
      --surface: #1c1917;
      --surface-soft: #262320;
      --surface-raised: #221f1c;
      --text: #f5f3ec;
      --text-soft: #d6d0c4;
      --text-muted: #968e83;
      --border: #2d2925;
      --border-strong: #443e37;
      --link: #58a6ff;
      --link-hover: #79c0ff;
      --accent: #58a6ff;
      --accent-soft: rgba(88, 166, 255, 0.12);
      --badge-latest-bg: rgba(88, 166, 255, 0.15);
      --badge-latest-text: #79c0ff;
      --badge-edge-bg: rgba(52, 211, 153, 0.15);
      --badge-edge-text: #34d399;
      --badge-github-bg: rgba(150, 142, 131, 0.15);
      --badge-github-text: #c5bdb2;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
      --shadow-card: 0 4px 20px -2px rgba(0, 0, 0, 0.3), 0 1px 3px 0 rgba(0, 0, 0, 0.2);
    }
  }
  * {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }
  html {
    font-size: 15px;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    scroll-behavior: smooth;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  a {
    color: var(--link);
    text-decoration: none;
    transition: color 0.18s ease;
  }
  a:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }

  /* 顶部全局品牌栏 */
  .portal-header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 30;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .portal-header-inner {
    max-width: 980px;
    margin: 0 auto;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .brand-logo-group {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 15px;
    color: var(--text);
  }
  .brand-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
    display: inline-block;
  }
  .brand-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
  }
  .brand-nav a {
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: 6px;
  }
  .brand-nav a:hover {
    color: var(--text);
    text-decoration: none;
    background: var(--surface-soft);
  }

  /* 主体容器 */
  .portal-main {
    max-width: 980px;
    width: 100%;
    margin: 0 auto;
    padding: 20px 16px 40px;
    flex: 1;
  }
  @media (min-width: 640px) {
    .portal-main {
      padding: 32px 24px 60px;
    }
  }

  /* 面包屑与大标题 */
  .breadcrumb-wrap {
    margin-bottom: 16px;
  }
  h1 {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0 0 8px 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    word-break: break-word;
  }
  @media (min-width: 640px) {
    h1 {
      font-size: 22px;
    }
  }
  h1 a {
    color: var(--text-muted);
    font-weight: 500;
  }
  h1 a:hover {
    color: var(--link);
  }
  h1 span {
    color: var(--text);
  }

  .parent-nav {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 8px;
    margin-bottom: 16px;
    box-shadow: var(--shadow-sm);
    min-height: 36px;
  }
  .parent-nav:hover {
    color: var(--text);
    text-decoration: none;
    border-color: var(--border-strong);
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 28px 0 12px 0;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  p {
    margin: 4px 0 12px 0;
    color: var(--text-muted);
    font-size: 14px;
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }

  /* 徽标设计系统 */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }
  .badge-latest {
    background: var(--badge-latest-bg);
    color: var(--badge-latest-text);
    border: 1px solid var(--badge-latest-bg);
  }
  .badge-edge {
    background: var(--badge-edge-bg);
    color: var(--badge-edge-text);
  }
  .badge-github {
    background: var(--badge-github-bg);
    color: var(--badge-github-text);
  }

  /* 卡片与响应式表格系统 */
  .table-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: var(--shadow-card);
    margin-bottom: 24px;
  }
  .table-scroll {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 13.5px;
  }
  th, td {
    padding: 10px 14px;
    vertical-align: middle;
  }
  th {
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    background: var(--surface-soft);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td {
    border-bottom: 1px solid var(--border);
    color: var(--text-soft);
  }
  tr:last-child td {
    border-bottom: none;
  }
  tbody tr:hover {
    background: var(--surface-soft);
  }

  .date, .size {
    text-align: right;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  th.date, th.size {
    text-align: right;
  }
  .desc {
    color: var(--text-muted);
    font-size: 13px;
  }
  .file-link {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    font-size: 13px;
    word-break: break-all;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* 移动端卡片式自适应优化 */
  @media (max-width: 680px) {
    .responsive-table, 
    .responsive-table thead, 
    .responsive-table tbody, 
    .responsive-table tr, 
    .responsive-table td {
      display: block;
      width: 100%;
    }
    .responsive-table thead {
      display: none;
    }
    .responsive-table tr {
      border-bottom: 1px solid var(--border);
      padding: 14px 16px;
      position: relative;
    }
    .responsive-table tr:last-child {
      border-bottom: none;
    }
    .responsive-table td {
      border-bottom: none;
      padding: 3px 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .responsive-table td:first-child {
      padding-bottom: 6px;
      font-size: 14.5px;
    }
    .responsive-table .file-link {
      font-size: 13.5px;
      padding: 2px 0;
    }
    .responsive-table td.date, 
    .responsive-table td.size {
      text-align: left;
      display: inline-flex;
      margin-right: 12px;
    }
    .responsive-table .mobile-meta-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 4px;
      font-size: 12px;
      color: var(--text-muted);
    }
  }

  /* 底部 Footer */
  address {
    font-style: normal;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: auto;
    padding-top: 16px;
    line-height: 1.7;
    border-top: 1px solid var(--border);
    word-break: break-word;
  }
`;

/**
 * 格式化字节
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderPortalHeader(currentOrigin: string): string {
  return `
  <header class="portal-header">
    <div class="portal-header-inner">
      <div class="brand-logo-group">
        <span class="brand-dot" aria-hidden="true"></span>
        <span>Inkpoint 下载中心</span>
      </div>
      <nav class="brand-nav" aria-label="快捷导航">
        <a href="https://editor.justdev.cn/" target="_blank" rel="noreferrer">官网首页 ↗</a>
        <a href="${currentOrigin}/api/inkpoint/releases" target="_blank" rel="noreferrer">Releases API</a>
        <a href="https://github.com/wmasfoe/md-editor" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </div>
  </header>`;
}

/**
 * 1. 顶层根目录：应用列表 (Index of /)
 */
export function renderAppIndexHtml(
  apps: Array<{ name: string; title: string; description?: string }>,
  currentOrigin: string,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Index of /</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  ${renderPortalHeader(currentOrigin)}
  <main class="portal-main">
    <div class="breadcrumb-wrap">
      <h1>Index of /</h1>
    </div>
    <p>Cloudflare Worker &amp; R2 Edge Distribution Gateway · 全球边缘分发网络</p>
    
    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Application</th>
              <th class="date">Last modified</th>
              <th class="size">Size</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${apps
              .map(
                (app) => `
            <tr>
              <td><a class="file-link" href="/${app.name}/">📂 ${app.name}/</a></td>
              <td class="date">-</td>
              <td class="size">-</td>
              <td class="desc">${app.title}${app.description ? ` - ${app.description}` : ""}</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <hr>
    <address>Distribution Gateway · Edge Powered · <a href="${currentOrigin}/api/version.json">API Manifest</a></address>
  </main>
</body>
</html>`;
}

/**
 * 2. 应用设备层级索引页：第一层区分设备类型 (Index of /:app/)
 * 结构：
 * InkPoint:
 *  -- desktop
 *   -- v0.10.2
 *   -- v0.10.1
 *  -- android
 *   -- v0.1.0
 */
export function renderAppDevicesHtml(
  app: string,
  manifest: ReleasesManifest,
  currentOrigin: string,
): string {
  const desktopReleases = manifest.releases.filter(
    (r) =>
      r.category === "desktop" ||
      r.assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      ),
  );

  const androidReleases = manifest.releases.filter(
    (r) => r.category === "android" || r.assets.some((a) => a.platform === "android"),
  );

  const latestDesktopVersion =
    manifest.latestDesktopVersion || desktopReleases[0]?.version || manifest.latestVersion;
  const latestAndroidVersion =
    manifest.latestAndroidVersion || androidReleases[0]?.version || "0.1.0";

  const latestDesktop = desktopReleases[0];
  const latestAndroid = androidReleases[0];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Index of /${app}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  ${renderPortalHeader(currentOrigin)}
  <main class="portal-main">
    <div class="breadcrumb-wrap">
      <h1>Index of /<a href="/">[Root]</a> / <span>${app}</span> /</h1>
    </div>
    <a href="/" class="parent-nav">← ../ (Parent Directory)</a>

    <h2>Directory (按设备类型区分)</h2>
    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Directory</th>
              <th class="date">Last modified</th>
              <th class="size">Total Versions</th>
              <th>Coverage &amp; Latest</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><a class="file-link" href="/${app}/desktop/">🖥️ desktop/</a></td>
              <td class="date">${latestDesktop?.publishedAt.slice(0, 10) || "-"}</td>
              <td class="size">${desktopReleases.length}</td>
              <td class="desc">Desktop 桌面端 (macOS, Windows, Linux) · 最新: <a href="/${app}/desktop/${latestDesktopVersion}/">v${latestDesktopVersion}</a></td>
            </tr>
            <tr>
              <td><a class="file-link" href="/${app}/android/">📱 android/</a></td>
              <td class="date">${latestAndroid?.publishedAt.slice(0, 10) || "-"}</td>
              <td class="size">${androidReleases.length}</td>
              <td class="desc">Android 移动端 (APK) · 最新: <a href="/${app}/android/${latestAndroidVersion}/">v${latestAndroidVersion}</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <h2>desktop/</h2>
    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Version</th>
              <th class="date">Release Date</th>
              <th class="size">Packages</th>
              <th>Platform Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${desktopReleases
              .map(
                (r, idx) => `
            <tr>
              <td><a class="file-link" href="/${app}/desktop/${r.version}/">${r.version}/</a>${idx === 0 ? ' <span class="badge badge-latest">[Latest]</span>' : ""}</td>
              <td class="date">${r.publishedAt.slice(0, 10)}</td>
              <td class="size">${r.assets.length} files</td>
              <td class="desc">macOS (Apple Silicon / Intel), Windows (x64), Linux (AppImage)</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <h2>android/</h2>
    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Version</th>
              <th class="date">Release Date</th>
              <th class="size">Packages</th>
              <th>Platform Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${androidReleases
              .map(
                (r, idx) => `
            <tr>
              <td><a class="file-link" href="/${app}/android/${r.version}/">${r.version}/</a>${idx === 0 ? ' <span class="badge badge-latest">[Latest]</span>' : ""}</td>
              <td class="date">${r.publishedAt.slice(0, 10)}</td>
              <td class="size">${r.assets.length} files</td>
              <td class="desc">Android (APK)</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <hr>
    <address>Application: ${app} · Desktop: ${desktopReleases.length} releases · Android: ${androidReleases.length} releases · <a href="${currentOrigin}/api/${app}/releases">JSON API</a></address>
  </main>
</body>
</html>`;
}

/**
 * 3. 设备专属版本列表页 (Index of /:app/:device/) 如 /inkpoint/desktop/ 或 /inkpoint/android/
 */
export function renderDeviceVersionsHtml(
  app: string,
  device: "desktop" | "android",
  manifest: ReleasesManifest,
  currentOrigin: string,
): string {
  const isAndroid = device === "android";
  const deviceTitle = isAndroid ? "Android 移动端" : "Desktop 桌面端";

  const releases = manifest.releases.filter((r) => {
    if (isAndroid) {
      return r.category === "android" || r.assets.some((a) => a.platform === "android");
    }
    return (
      r.category === "desktop" ||
      r.assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      )
    );
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Index of /${app}/${device}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  ${renderPortalHeader(currentOrigin)}
  <main class="portal-main">
    <div class="breadcrumb-wrap">
      <h1>Index of /<a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <span>${device}</span> /</h1>
    </div>
    <a href="/${app}/" class="parent-nav">← ../ (Parent Directory)</a>
    <p class="desc">${deviceTitle}版本列表 · 共 ${releases.length} 个版本</p>
    
    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Version</th>
              <th class="date">Release Date</th>
              <th class="size">Packages</th>
              <th>Platform Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${releases
              .map(
                (r, idx) => `
            <tr>
              <td><a class="file-link" href="/${app}/${device}/${r.version}/">${r.version}/</a>${idx === 0 ? ' <span class="badge badge-latest">[Latest]</span>' : ""}</td>
              <td class="date">${r.publishedAt.slice(0, 10)}</td>
              <td class="size">${r.assets.length} files</td>
              <td class="desc">${isAndroid ? "Android (APK)" : "macOS / Windows / Linux"}</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <hr>
    <address>Application: ${app} · Device: ${device} · Total: ${releases.length} versions · <a href="${currentOrigin}/api/${app}/${device}/releases">JSON API</a></address>
  </main>
</body>
</html>`;
}

/**
 * 4. 具体版本安装包详情页 (Index of /:app/:device/:version/ 或 /:app/:version/)
 */
export function renderVersionFilesHtml(
  app: string,
  device: "desktop" | "android",
  release: ReleaseInfo,
  currentOrigin: string,
): string {
  const parentUrl = `/${app}/${device}/`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Index of /${app}/${device}/${release.version}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  ${renderPortalHeader(currentOrigin)}
  <main class="portal-main">
    <div class="breadcrumb-wrap">
      <h1>Index of /<a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <a href="${parentUrl}">${device}</a> / <span>${release.version}</span> /</h1>
    </div>
    <a href="${parentUrl}" class="parent-nav">← ../ (Parent Directory)</a>
    <p class="desc">发布日期: ${release.publishedAt.slice(0, 10)}${release.isLatest ? ' · <span class="badge badge-latest">[Latest]</span>' : ""}${
      release.releaseNotesUrl
        ? ` · <a href="${release.releaseNotesUrl}" target="_blank" rel="noreferrer">Release Notes ↗</a>`
        : ""
    }</p>

    <div class="table-card">
      <div class="table-scroll">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>File Name</th>
              <th class="date">Release Date</th>
              <th class="size">Size</th>
              <th>Platform / Source</th>
            </tr>
          </thead>
          <tbody>
            ${release.assets
              .map((asset) => {
                const sourceBadge = asset.isR2Cached
                  ? '<span class="badge badge-edge">[R2 Edge]</span>'
                  : '<span class="badge badge-github">[GitHub]</span>';
                return `
            <tr>
              <td>
                <a class="file-link" href="${asset.downloadUrl}" download="${asset.fileName}">
                  <span>⬇️</span>
                  <span>${asset.fileName}</span>
                </a>
              </td>
              <td class="date">${release.publishedAt.slice(0, 10)}</td>
              <td class="size">${asset.formattedSize}</td>
              <td class="desc">${asset.platformLabel || asset.platform} ${sourceBadge}</td>
            </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <hr>
    <address>Application: ${app} · Device: ${device} · Version: ${release.version} · <a href="${currentOrigin}/api/${app}/${device}/releases">Device Releases API</a> · <a href="${currentOrigin}/api/${app}/releases">All Releases API</a></address>
  </main>
</body>
</html>`;
}

/**
 * 保持向后兼容的旧接口转发（供旧代码或测试调用）
 */
export function renderVersionIndexHtml(
  app: string,
  manifest: ReleasesManifest,
  currentOrigin: string,
  initialCategory: "all" | "desktop" | "android" = "all",
): string {
  if (initialCategory === "desktop" || initialCategory === "android") {
    return renderDeviceVersionsHtml(app, initialCategory, manifest, currentOrigin);
  }
  return renderAppDevicesHtml(app, manifest, currentOrigin);
}
