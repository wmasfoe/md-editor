import type { ReleaseInfo, ReleasesManifest } from "./types.ts";

/**
 * 基础 CSS 样式：极简目录索引风格，深色自适应，无 emoji，排版清晰规范
 */
const BASE_STYLES = `
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-raised: #1c2128;
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
  .parent-link {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--link);
    text-decoration: none;
  }
  .parent-link:hover {
    text-decoration: underline;
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

  /* 徽章样式 */
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
  .badge-beta {
    font-size: 0.7rem;
    font-weight: 600;
    color: #e3b341;
    background: rgba(227, 179, 65, 0.15);
    border: 1px solid rgba(227, 179, 65, 0.3);
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    vertical-align: middle;
  }

  /* 设备板块容器 */
  .device-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px;
    margin-bottom: 22px;
  }
  .device-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .device-title-wrap {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .device-code-title {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--link);
    text-decoration: none;
  }
  .device-code-title:hover {
    text-decoration: underline;
  }
  .device-label {
    font-size: 0.9rem;
    color: var(--text-muted);
  }
  .quick-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .btn-quick {
    display: inline-block;
    background: #21262d;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 0.8rem;
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
  .device-footer-link {
    display: inline-block;
    margin-top: 12px;
    font-size: 0.85rem;
    color: var(--link);
    text-decoration: none;
  }
  .device-footer-link:hover {
    text-decoration: underline;
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
              <a href="/${app.name}/" class="btn-download">进入应用目录</a>
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
 * 2. 应用设备层级索引页：第一层区分设备类型 (Index of /:app/)
 * 结构：
 * Inkpoint
 *  -- desktop/
 *     -- v0.10.2
 *     -- v0.10.1
 *  -- android/
 *     -- v0.1.0
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
  const macArmAsset = latestDesktop?.assets.find(
    (a) => a.platform === "macos-arm64" || a.fileName.toLowerCase().includes("aarch64.dmg"),
  );
  const winX64Asset = latestDesktop?.assets.find(
    (a) => a.platform === "windows-x64" || a.fileName.toLowerCase().includes("x64-setup.exe"),
  );
  const linuxAppAsset = latestDesktop?.assets.find(
    (a) => a.platform === "linux-appimage" || a.fileName.toLowerCase().includes("appimage"),
  );

  const latestAndroid = androidReleases[0];
  const androidApkAsset = latestAndroid?.assets.find(
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
  <title>Index of /${app}/ · 设备目录与版本归档</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">
        <a href="/">[Root]</a> / <span>${app}</span> /
      </div>
      <div class="subtitle">设备分类目录 · 桌面端与移动端独立版本通道 · 全球边缘加速</div>
    </header>

    <div class="toolbar">
      <div>
        <a href="/" class="parent-link">../ (Parent Directory)</a>
      </div>
      <div>
        <input type="text" id="filterInput" class="search-input" placeholder="按版本号或文件过滤 (如 0.10, apk)..." oninput="filterReleases(this.value)">
      </div>
    </div>

    <main>
      <!-- 第一列按设备类型区分的目录列表 -->
      <table class="index-table" style="margin-bottom: 24px;">
        <thead>
          <tr>
            <th>Directory (设备类型)</th>
            <th>Platform Coverage</th>
            <th>Latest Version</th>
            <th>Total Releases</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="file-name">
              <a href="/${app}/desktop/">desktop/</a>
            </td>
            <td class="file-platform">macOS (Apple Silicon / Intel), Windows (x64), Linux (AppImage / DEB)</td>
            <td>
              <strong>v${latestDesktopVersion}</strong>
              <span class="badge-latest">LATEST</span>
            </td>
            <td class="file-size">${desktopReleases.length} versions</td>
            <td style="text-align:right;">
              <a href="/${app}/desktop/" class="btn-download">进入 desktop/ 目录</a>
            </td>
          </tr>
          <tr>
            <td class="file-name">
              <a href="/${app}/android/">android/</a>
            </td>
            <td class="file-platform">Android (APK · ARM64 / x86_64)</td>
            <td>
              <strong>v${latestAndroidVersion}</strong>
              <span class="badge-beta">PUBLIC BETA</span>
            </td>
            <td class="file-size">${androidReleases.length} versions</td>
            <td style="text-align:right;">
              <a href="/${app}/android/" class="btn-download">进入 android/ 目录</a>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 1. desktop/ 桌面端分块 -->
      <div class="device-block" id="desktopBlock">
        <div class="device-block-header">
          <div class="device-title-wrap">
            <a href="/${app}/desktop/" class="device-code-title">desktop/</a>
            <span class="device-label">桌面端版本列表 (macOS, Windows, Linux)</span>
          </div>
          <div>
            <span class="badge-latest">LATEST: v${latestDesktopVersion}</span>
          </div>
        </div>

        <div class="quick-buttons">
          ${
            macArmAsset
              ? `<a href="${macArmAsset.downloadUrl}" download="${macArmAsset.fileName}" class="btn-quick">macOS (Apple Silicon)</a>`
              : `<a href="/${app}/desktop/${latestDesktopVersion}/" class="btn-quick">macOS (Apple Silicon)</a>`
          }
          ${
            winX64Asset
              ? `<a href="${winX64Asset.downloadUrl}" download="${winX64Asset.fileName}" class="btn-quick">Windows (x64)</a>`
              : `<a href="/${app}/desktop/${latestDesktopVersion}/" class="btn-quick">Windows (x64)</a>`
          }
          ${
            linuxAppAsset
              ? `<a href="${linuxAppAsset.downloadUrl}" download="${linuxAppAsset.fileName}" class="btn-quick">Linux (AppImage)</a>`
              : `<a href="/${app}/desktop/${latestDesktopVersion}/" class="btn-quick">Linux (AppImage)</a>`
          }
        </div>

        <table class="index-table">
          <thead>
            <tr>
              <th>Desktop Version</th>
              <th>Release Date</th>
              <th>Packages</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${desktopReleases
              .map(
                (r, idx) => `
            <tr class="release-row" data-version="${r.version}" data-device="desktop">
              <td class="file-name">
                <a href="/${app}/desktop/${r.version}/">${r.version}/</a>
                ${idx === 0 ? '<span class="badge-latest">LATEST</span>' : ""}
              </td>
              <td class="file-date">${r.publishedAt.slice(0, 10)}</td>
              <td class="file-size">${r.assets.length} files</td>
              <td style="text-align:right;">
                <a href="/${app}/desktop/${r.version}/" class="btn-download">查看安装包</a>
              </td>
            </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        <div>
          <a href="/${app}/desktop/" class="device-footer-link">进入完整桌面端目录 desktop/ (共 ${desktopReleases.length} 个版本) &rarr;</a>
        </div>
      </div>

      <!-- 2. android/ 安卓移动端分块 -->
      <div class="device-block" id="androidBlock">
        <div class="device-block-header">
          <div class="device-title-wrap">
            <a href="/${app}/android/" class="device-code-title">android/</a>
            <span class="device-label">安卓移动端版本列表 (APK)</span>
          </div>
          <div>
            <span class="badge-beta">PUBLIC BETA: v${latestAndroidVersion}</span>
          </div>
        </div>

        <div class="quick-buttons">
          <a href="${androidDownloadUrl}" download="${androidFileName}" class="btn-quick btn-accent">
            一键下载 APK (${androidSize})
          </a>
          <a href="/${app}/android/latest" download="${androidFileName}" class="btn-quick">
            最新固化直链
          </a>
        </div>

        <table class="index-table">
          <thead>
            <tr>
              <th>Android Version</th>
              <th>Release Date</th>
              <th>Package Name</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${androidReleases
              .map(
                (r, idx) => `
            <tr class="release-row" data-version="${r.version}" data-device="android">
              <td class="file-name">
                <a href="/${app}/android/${r.version}/">${r.version}/</a>
                ${idx === 0 ? '<span class="badge-beta">LATEST</span>' : ""}
              </td>
              <td class="file-date">${r.publishedAt.slice(0, 10)}</td>
              <td class="file-platform">${androidFileName}</td>
              <td style="text-align:right;">
                <a href="/${app}/android/${r.version}/" class="btn-download">查看安装包</a>
              </td>
            </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        <div>
          <a href="/${app}/android/" class="device-footer-link">进入完整安卓移动端目录 android/ (共 ${androidReleases.length} 个版本) &rarr;</a>
        </div>
      </div>
    </main>

    <footer>
      <div>Application: ${app} · Desktop: ${desktopReleases.length} releases · Android: ${androidReleases.length} releases</div>
      <div>
        <a href="${currentOrigin}/api/${app}/releases">JSON API</a> ·
        <a href="${currentOrigin}/api/${app}/version.json">Version API</a>
      </div>
    </footer>
  </div>

  <script>
    function filterReleases(q) {
      const query = (q || '').trim().toLowerCase();
      const rows = document.querySelectorAll('.release-row');
      rows.forEach(row => {
        const ver = (row.getAttribute('data-version') || '').toLowerCase();
        if (!query || ver.includes(query)) {
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of /${app}/${device}/ · ${deviceTitle}版本列表</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">
        <a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <span>${device}</span> /
      </div>
      <div class="subtitle">${deviceTitle}全量版本归档 · 共 ${releases.length} 个版本</div>
    </header>

    <div class="toolbar">
      <div>
        <a href="/${app}/" class="parent-link">../ (Parent Directory)</a>
      </div>
      <div>
        <input type="text" id="filterInput" class="search-input" placeholder="按版本号过滤 (如 ${isAndroid ? "0.1" : "0.10"})..." oninput="filterVersions(this.value)">
      </div>
    </div>

    <main>
      <table class="index-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Release Date</th>
            <th>Assets</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${releases
            .map(
              (r, idx) => `
          <tr class="version-row" data-version="${r.version}">
            <td class="file-name">
              <a href="/${app}/${device}/${r.version}/">${r.version}/</a>
              ${
                idx === 0
                  ? isAndroid
                    ? '<span class="badge-beta">LATEST</span>'
                    : '<span class="badge-latest">LATEST</span>'
                  : ""
              }
            </td>
            <td class="file-date">${r.publishedAt.slice(0, 10)}</td>
            <td class="file-size">${r.assets.length} files</td>
            <td style="text-align:right;">
              <a href="/${app}/${device}/${r.version}/" class="btn-download">查看安装包</a>
            </td>
          </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </main>

    <footer>
      <div>Application: ${app} · Device: ${device} · Total: ${releases.length} versions</div>
      <div>
        <a href="${currentOrigin}/api/${app}/releases">JSON API</a>
      </div>
    </footer>
  </div>

  <script>
    function filterVersions(query) {
      const q = (query || '').trim().toLowerCase();
      const rows = document.querySelectorAll('.version-row');
      rows.forEach(row => {
        const ver = (row.getAttribute('data-version') || '').toLowerCase();
        if (!q || ver.includes(q)) {
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of /${app}/${device}/${release.version}/ · 安装包列表</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="breadcrumb">
        <a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <a href="${parentUrl}">${device}</a> / <span>${release.version}</span> /
      </div>
      <div class="subtitle">
        发布日期: ${release.publishedAt.slice(0, 10)}
        ${release.isLatest ? ' · <span class="badge-latest">LATEST</span>' : ""}
        ${
          release.releaseNotesUrl
            ? ` · <a href="${release.releaseNotesUrl}" target="_blank" style="color:var(--link); text-decoration:none;">查看 Release Notes</a>`
            : ""
        }
      </div>
    </header>

    <div class="toolbar">
      <div>
        <a href="${parentUrl}" class="parent-link">../ (Parent Directory)</a>
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
            <th>Platform / Format</th>
            <th>Size</th>
            <th style="text-align:right;">Download</th>
          </tr>
        </thead>
        <tbody>
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
      <div>Application: ${app} · Device: ${device} · Version: ${release.version}</div>
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
