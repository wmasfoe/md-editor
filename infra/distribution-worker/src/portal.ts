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
 * 每个版本（如 0.10.1）是一个单独链接，点击进入该版本专属安装包目录
 */
export function renderVersionIndexHtml(
  app: string,
  manifest: ReleasesManifest,
  currentOrigin: string,
): string {
  const latestVersion = manifest.latestVersion;

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
      <div class="subtitle">共 ${manifest.total} 个已发布版本 · 点击各版本进入安装包详情</div>
    </header>

    <div class="toolbar">
      <div>
        <a href="/" class="parent-link" style="color:var(--link); text-decoration:none;">../ (Parent Directory)</a>
      </div>
      <div>
        <input type="text" id="filterInput" class="search-input" placeholder="过滤版本 (如 0.10)..." oninput="filterVersions(this.value)">
      </div>
    </div>

    <main>
      <table class="index-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Release Date</th>
            <th>Assets Count</th>
            <th style="text-align:right;">Notes / Action</th>
          </tr>
        </thead>
        <tbody id="versionTableBody">
          ${manifest.releases
            .map(
              (r) => `
          <tr class="version-row" data-version="${r.version}">
            <td class="file-name">
              <a href="/${app}/${r.version}/">${r.version}/</a>
              ${r.version === latestVersion ? '<span class="badge-latest">LATEST</span>' : ""}
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
          `,
            )
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
    function filterVersions(query) {
      const q = query.trim().toLowerCase();
      const rows = document.querySelectorAll('.version-row');
      rows.forEach(row => {
        const ver = row.getAttribute('data-version') || '';
        if (!q || ver.toLowerCase().includes(q)) {
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
 * 3. 具体版本安装包详情页 (Index of /:app/:version/)
 * 列出该版本包含的所有各平台安装包、文件大小及直链下载
 */
export function renderVersionFilesHtml(
  app: string,
  release: ReleaseInfo,
  currentOrigin: string,
): string {
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

    <div class="toolbar">
      <div>
        <a href="/${app}/" class="parent-link" style="color:var(--link); text-decoration:none;">../ (Parent Directory)</a>
      </div>
      <div>
        <input type="text" id="fileFilterInput" class="search-input" placeholder="过滤文件 (如 dmg, exe)..." oninput="filterFiles(this.value)">
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
