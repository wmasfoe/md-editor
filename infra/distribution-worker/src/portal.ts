import type { ReleaseInfo, ReleasesManifest } from "./types.ts";

/**
 * 基础 CSS 样式：极简目录索引风格，支持深色自适应，无 emoji，排版清晰规范
 */
const BASE_STYLES = `
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --border-subtle: #21262d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --link: #58a6ff;
    --link-hover: #79c0ff;
    --accent: #2ea043;
    --badge-bg: rgba(56, 139, 253, 0.15);
    --badge-text: #58a6ff;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.6;
    padding: 24px;
    min-height: 100vh;
  }

  .wrapper {
    max-width: 960px;
    margin: 0 auto;
  }

  /* 顶部导航与面包屑 */
  header {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .breadcrumb {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    word-break: break-all;
  }
  .breadcrumb a {
    color: var(--link);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  .subtitle {
    margin-top: 6px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  /* 操作栏 */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
  }
  .search-input {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 12px;
    font-size: 0.85rem;
    font-family: inherit;
    outline: none;
    min-width: 240px;
  }
  .search-input:focus {
    border-color: var(--link);
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
  }
  .badge-latest {
    font-size: 0.72rem;
    font-weight: 600;
    color: #2ea043;
    background: rgba(46, 160, 67, 0.15);
    border: 1px solid rgba(46, 160, 67, 0.3);
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    vertical-align: middle;
  }

  /* 目录表格 */
  .index-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .index-table th {
    text-align: left;
    padding: 10px 14px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
    background: #13171f;
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .index-table td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .index-table tr:last-child td {
    border-bottom: none;
  }
  .index-table tr:hover td {
    background: rgba(255, 255, 255, 0.02);
  }

  .file-name {
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
  .file-name a {
    color: var(--link);
    text-decoration: none;
    font-weight: 500;
  }
  .file-name a:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }
  .file-size, .file-date {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .file-platform {
    font-size: 0.85rem;
    color: var(--text);
  }
  .btn-download {
    display: inline-block;
    background: #21262d;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.78rem;
    text-decoration: none;
    transition: all 0.15s;
  }
  .btn-download:hover {
    background: var(--link);
    border-color: var(--link);
    color: #000;
    font-weight: 600;
  }

  .parent-link {
    font-family: var(--font-mono);
    font-weight: 600;
  }

  /* 最新版本快捷直达面板 */
  .latest-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
  }
  .latest-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .latest-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .latest-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .latest-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
  }
  .latest-card {
    background: #11151c;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .latest-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .platform-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text);
  }
  .version-tag {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .badge-beta {
    font-size: 0.7rem;
    font-weight: 600;
    color: #e3b341;
    background: rgba(227, 179, 65, 0.15);
    border: 1px solid rgba(227, 179, 65, 0.3);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .badge-tag {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .badge-tag-desktop {
    color: var(--link);
    background: var(--badge-bg);
    border: 1px solid rgba(88, 166, 255, 0.25);
  }
  .badge-tag-android {
    color: #2ea043;
    background: rgba(46, 160, 67, 0.15);
    border: 1px solid rgba(46, 160, 67, 0.3);
  }
  .quick-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .btn-quick {
    display: inline-block;
    background: #21262d;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 0.78rem;
    text-decoration: none;
    transition: all 0.15s;
  }
  .btn-quick:hover {
    background: var(--link);
    border-color: var(--link);
    color: #000;
    font-weight: 600;
  }
  .btn-accent {
    background: rgba(46, 160, 67, 0.15);
    border-color: rgba(46, 160, 67, 0.4);
    color: #3fb950;
    font-weight: 600;
  }
  .btn-accent:hover {
    background: #2ea043;
    border-color: #2ea043;
    color: #ffffff;
  }
  .card-more {
    font-size: 0.8rem;
    color: var(--link);
    text-decoration: none;
    align-self: flex-start;
  }
  .card-more:hover {
    text-decoration: underline;
  }

  /* 分类切换 Tab 按钮 */
  .category-filter {
    display: inline-flex;
    background: #11151c;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .cat-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: inherit;
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cat-btn:hover {
    color: var(--text);
  }
  .cat-btn.active {
    background: #21262d;
    color: var(--text);
    font-weight: 600;
  }

  /* 跨端友好提示条 */
  .cross-notice {
    background: #161b22;
    border: 1px solid var(--border);
    border-left: 3px solid #2ea043;
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 16px;
    font-size: 0.82rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .cross-notice a {
    color: var(--link);
    text-decoration: none;
    font-weight: 500;
  }
  .cross-notice a:hover {
    text-decoration: underline;
  }

  /* 页脚 */
  footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  footer a {
    color: var(--link);
    text-decoration: none;
  }
  footer a:hover {
    text-decoration: underline;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of / · 全球分发中心</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">Index of /</div>
      <div class="subtitle">Cloudflare Worker &amp; R2 Edge Distribution Gateway</div>
    </header>

    <main>
      <table class="index-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Description</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${apps
            .map(
              (app) => `
          <tr>
            <td class="file-name">
              <a href="/${app.name}/">${app.name}/</a>
            </td>
            <td>
              <span>${app.title}</span>
              ${app.description ? `<span style="color:var(--text-muted); font-size:0.8rem;"> - ${app.description}</span>` : ""}
            </td>
            <td style="text-align:right;">
              <a href="/${app.name}/" class="btn-download">进入版本目录</a>
            </td>
          </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </main>

    <footer>
      <div>Distribution Gateway · Edge Powered</div>
      <div>
        <a href="${currentOrigin}/api/version.json">API Manifest</a>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * 2. 应用版本索引页：列出所有版本链接 (Index of /:app/)
 * 增加“全平台最新稳定版直达”卡片、平台分类切换（全部 / 桌面端 / 安卓端）与直达导航
 */
export function renderVersionIndexHtml(
  app: string,
  manifest: ReleasesManifest,
  currentOrigin: string,
  initialCategory: "all" | "desktop" | "android" = "all",
): string {
  const latestVersion = manifest.latestVersion;

  // 1. 提取最新桌面版与最新 Android 版
  const desktopRelease = manifest.releases.find(
    (r) =>
      r.category === "desktop" ||
      r.assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      ),
  );

  const androidRelease = manifest.releases.find(
    (r) => r.category === "android" || r.assets.some((a) => a.platform === "android"),
  );

  const latestDesktopVersion =
    manifest.latestDesktopVersion || desktopRelease?.version || latestVersion;
  const latestAndroidVersion = manifest.latestAndroidVersion || androidRelease?.version || "0.1.0";

  const macArmAsset = desktopRelease?.assets.find(
    (a) => a.platform === "macos-arm64" || a.fileName.toLowerCase().includes("aarch64.dmg"),
  );
  const winX64Asset = desktopRelease?.assets.find(
    (a) => a.platform === "windows-x64" || a.fileName.toLowerCase().includes("x64-setup.exe"),
  );
  const linuxAppAsset = desktopRelease?.assets.find(
    (a) => a.platform === "linux-appimage" || a.fileName.toLowerCase().includes("appimage"),
  );

  const androidApkAsset = androidRelease?.assets.find(
    (a) => a.platform === "android" || a.fileName.toLowerCase().endsWith(".apk"),
  );
  const androidDownloadUrl =
    androidApkAsset?.downloadUrl || `${currentOrigin}/${app}/android/latest`;
  const androidFileName = androidApkAsset?.fileName || `Inkpoint_${latestAndroidVersion}.apk`;
  const androidSize = androidApkAsset?.formattedSize || "42.9 MB";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of /${app}/ · 版本清单</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">
        <a href="/">[Root]</a> / <span>${app}</span> /
      </div>
      <div class="subtitle">共 ${manifest.total} 个已发布版本 · 支持分类筛选与直链高速下载</div>
    </header>

    <!-- 各端最新稳定版快捷直达区 (免下翻寻找) -->
    <section class="latest-section">
      <div class="latest-header">
        <span class="latest-title">最新版本直达通道</span>
        <span class="latest-desc">常用客户端推荐，无需下翻历史记录即可一键下载</span>
      </div>
      <div class="latest-grid">
        <!-- 桌面端最新卡片 -->
        <div class="latest-card">
          <div class="latest-card-header">
            <div>
              <span class="platform-title">Desktop 桌面端</span>
              <span class="version-tag">v${latestDesktopVersion}</span>
            </div>
            <span class="badge-latest">LATEST</span>
          </div>
          <div class="quick-buttons">
            ${
              macArmAsset
                ? `<a href="${macArmAsset.downloadUrl}" download="${macArmAsset.fileName}" class="btn-quick">macOS (Apple Silicon)</a>`
                : `<a href="/${app}/${latestDesktopVersion}/" class="btn-quick">macOS (DMG)</a>`
            }
            ${
              winX64Asset
                ? `<a href="${winX64Asset.downloadUrl}" download="${winX64Asset.fileName}" class="btn-quick">Windows (x64)</a>`
                : `<a href="/${app}/${latestDesktopVersion}/" class="btn-quick">Windows (Setup)</a>`
            }
            ${
              linuxAppAsset
                ? `<a href="${linuxAppAsset.downloadUrl}" download="${linuxAppAsset.fileName}" class="btn-quick">Linux (AppImage)</a>`
                : `<a href="/${app}/${latestDesktopVersion}/" class="btn-quick">Linux (AppImage)</a>`
            }
          </div>
          <a href="/${app}/${latestDesktopVersion}/" class="card-more">进入该版本全部安装包 &rarr;</a>
        </div>

        <!-- Android 移动端最新卡片 -->
        <div class="latest-card">
          <div class="latest-card-header">
            <div>
              <span class="platform-title">Android 移动端</span>
              <span class="version-tag">v${latestAndroidVersion}</span>
            </div>
            <span class="badge-beta">PUBLIC BETA</span>
          </div>
          <div class="quick-buttons">
            <a href="${androidDownloadUrl}" download="${androidFileName}" class="btn-quick btn-accent">
              一键下载 APK (${androidSize})
            </a>
            <a href="/${app}/android/latest" download="${androidFileName}" class="btn-quick">
              最新固化直链
            </a>
          </div>
          <a href="/${app}/${latestAndroidVersion}/" class="card-more">查看 Android 版本详情 &rarr;</a>
        </div>
      </div>
    </section>

    <!-- 操作栏：分类过滤 Tab + 搜索过滤 -->
    <div class="toolbar">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <a href="/" class="parent-link" style="color:var(--link); text-decoration:none;">../ (Parent Directory)</a>
        <div class="category-filter">
          <button type="button" class="cat-btn ${initialCategory === "all" ? "active" : ""}" data-cat="all" onclick="setCategory('all')">全部版本</button>
          <button type="button" class="cat-btn ${initialCategory === "desktop" ? "active" : ""}" data-cat="desktop" onclick="setCategory('desktop')">桌面端 (Desktop)</button>
          <button type="button" class="cat-btn ${initialCategory === "android" ? "active" : ""}" data-cat="android" onclick="setCategory('android')">安卓移动端 (Android)</button>
        </div>
      </div>
      <div>
        <input type="text" id="filterInput" class="search-input" placeholder="按版本号过滤 (如 0.10, 0.1)..." oninput="handleSearch(this.value)">
      </div>
    </div>

    <main>
      <table class="index-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Platform</th>
            <th>Release Date</th>
            <th>Assets Count</th>
            <th style="text-align:right;">Notes / Action</th>
          </tr>
        </thead>
        <tbody id="versionTableBody">
          ${manifest.releases
            .map((r) => {
              const isAndroidOnly =
                r.category === "android" ||
                (r.assets.length > 0 && r.assets.every((a) => a.platform === "android"));
              const hasAndroid = r.assets.some((a) => a.platform === "android");
              const hasDesktop = r.assets.some(
                (a) =>
                  a.platform.includes("macos") ||
                  a.platform.includes("windows") ||
                  a.platform.includes("linux"),
              );
              const category = isAndroidOnly
                ? "android"
                : hasAndroid && !hasDesktop
                  ? "android"
                  : "desktop";

              return `
          <tr class="version-row" data-version="${r.version}" data-category="${category}">
            <td class="file-name">
              <a href="/${app}/${r.version}/">${r.version}/</a>
              ${
                r.version === latestDesktopVersion && !isAndroidOnly
                  ? '<span class="badge-latest">LATEST DESKTOP</span>'
                  : r.version === latestAndroidVersion && isAndroidOnly
                    ? '<span class="badge-beta">LATEST ANDROID</span>'
                    : ""
              }
            </td>
            <td>
              ${
                isAndroidOnly
                  ? '<span class="badge-tag badge-tag-android">Android</span>'
                  : hasAndroid && hasDesktop
                    ? '<span class="badge-tag badge-tag-desktop">Desktop</span><span class="badge-tag badge-tag-android">Android</span>'
                    : '<span class="badge-tag badge-tag-desktop">Desktop</span>'
              }
            </td>
            <td class="file-date">${r.publishedAt.slice(0, 10)}</td>
            <td class="file-size">${r.assets.length} files</td>
            <td style="text-align:right;">
              ${
                r.releaseNotesUrl
                  ? `<a href="${r.releaseNotesUrl}" target="_blank" style="color:var(--text-muted); font-size:0.8rem; margin-right:10px; text-decoration:none;">Release Notes</a>`
                  : ""
              }
              <a href="/${app}/${r.version}/" class="btn-download">查看安装包</a>
            </td>
          </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>
    </main>

    <footer>
      <div>Application: ${app} · Total: ${manifest.total} versions</div>
      <div>
        <a href="${currentOrigin}/api/${app}/releases">JSON API</a> ·
        <a href="${currentOrigin}/api/${app}/version.json">Latest Version API</a>
      </div>
    </footer>
  </div>

  <script>
    let currentCategory = "${initialCategory}";
    let currentQuery = "";

    function setCategory(cat) {
      currentCategory = cat;
      document.querySelectorAll('.cat-btn').forEach(btn => {
        if (btn.getAttribute('data-cat') === cat) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      applyFilter();

      // 同步 URL hash
      if (history.replaceState) {
        const hash = cat === 'all' ? '' : '#' + cat;
        const newUrl = window.location.pathname + window.location.search + hash;
        history.replaceState(null, '', newUrl);
      }
    }

    function handleSearch(q) {
      currentQuery = (q || '').trim().toLowerCase();
      applyFilter();
    }

    function applyFilter() {
      const rows = document.querySelectorAll('.version-row');
      rows.forEach(row => {
        const ver = (row.getAttribute('data-version') || '').toLowerCase();
        const cat = row.getAttribute('data-category') || 'desktop';

        const matchCategory = (currentCategory === 'all') || (cat === currentCategory);
        const matchQuery = !currentQuery || ver.includes(currentQuery);

        if (matchCategory && matchQuery) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // 页面载入时根据 URL hash 或 search 参数初始化分类
    (function initFromLocation() {
      const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const catParam = (params.get('category') || params.get('tab') || '').toLowerCase();
      const target = hash || catParam;

      if (target === 'android' || target === 'mobile') {
        setCategory('android');
      } else if (target === 'desktop') {
        setCategory('desktop');
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * 3. 具体版本安装包详情页 (Index of /:app/:version/)
 * 列出该版本包含的所有各平台安装包、文件大小及直链下载，并在顶部提供跨端友好引导
 */
export function renderVersionFilesHtml(
  app: string,
  release: ReleaseInfo,
  currentOrigin: string,
  latestAndroidVersion = "0.1.0",
): string {
  const isAndroid =
    release.category === "android" ||
    (release.assets.length > 0 && release.assets.every((a) => a.platform === "android"));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of /${app}/${release.version}/ · 安装包列表</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">
        <a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <span>${release.version}</span> /
      </div>
      <div class="subtitle">
        发布日期: ${release.publishedAt.slice(0, 10)}
        ${release.isLatest ? ' · <span class="badge-latest">LATEST</span>' : ""}
        ${
          release.releaseNotesUrl
            ? ` · <a href="${release.releaseNotesUrl}" target="_blank" style="color:var(--link); text-decoration:none;">查看 GitHub Release Notes</a>`
            : ""
        }
      </div>
    </header>

    ${
      !isAndroid
        ? `
    <!-- 跨端友好提示条：桌面版本页面引导直达 Android -->
    <div class="cross-notice">
      <span>正在寻找 Android 移动端？最新版本为 v${latestAndroidVersion}</span>
      <div>
        <a href="/${app}/android/latest" style="margin-right:12px;">直接下载最新 APK</a>
        <a href="/${app}/#android">查看 Android 版本记录 &rarr;</a>
      </div>
    </div>
    `
        : ""
    }

    <div class="toolbar">
      <div>
        <a href="/${app}/" class="parent-link" style="color:var(--link); text-decoration:none;">../ (Parent Directory)</a>
      </div>
      <div>
        <input type="text" id="fileFilterInput" class="search-input" placeholder="过滤文件 (如 dmg, exe, apk)..." oninput="filterFiles(this.value)">
      </div>
    </div>

    <main>
      <table class="index-table">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Platform / Type</th>
            <th>Size</th>
            <th style="text-align:right;">Download</th>
          </tr>
        </thead>
        <tbody id="filesTableBody">
          ${release.assets
            .map(
              (asset) => `
          <tr class="file-row" data-name="${asset.fileName}" data-platform="${asset.platform}">
            <td class="file-name">
              <a href="${asset.downloadUrl}" download="${asset.fileName}">${asset.fileName}</a>
            </td>
            <td class="file-platform">
              <span>${asset.platformLabel}</span>
              ${asset.isR2Cached ? '<span style="font-size:0.7rem; color:#2ea043; margin-left:6px;">[R2 Edge]</span>' : ""}
            </td>
            <td class="file-size">${asset.formattedSize}</td>
            <td style="text-align:right;">
              <a href="${asset.downloadUrl}" download="${asset.fileName}" class="btn-download">下载</a>
            </td>
          </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </main>

    <footer>
      <div>Application: ${app} · Version: ${release.version}</div>
      <div>
        <a href="${currentOrigin}/api/${app}/releases">Releases API</a>
      </div>
    </footer>
  </div>

  <script>
    function filterFiles(query) {
      const q = query.trim().toLowerCase();
      const rows = document.querySelectorAll('.file-row');
      rows.forEach(row => {
        const name = (row.getAttribute('data-name') || '').toLowerCase();
        const plat = (row.getAttribute('data-platform') || '').toLowerCase();
        if (!q || name.includes(q) || plat.includes(q)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}
