import type { ReleaseInfo, ReleasesManifest } from "./types.ts";

/**
 * 极简目录索引样式：经典轻量 HTML 排版，自适应深色模式，无 emoji
 * 保持经典极简风格，同时适配移动端设备
 */
const BASE_STYLES = `
  :root {
    --bg: #ffffff;
    --text: #1a1a1a;
    --text-muted: #666666;
    --border: #d0d7de;
    --link: #0969da;
    --link-hover: #054da7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --border: #30363d;
      --link: #58a6ff;
      --link-hover: #79c0ff;
    }
  }
  * {
    box-sizing: border-box;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 14px;
    line-height: 1.6;
    margin: 0;
    padding: 24px 32px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 8px 0;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 24px 0 8px 0;
    color: var(--text);
  }
  p {
    margin: 4px 0 12px 0;
    color: var(--text-muted);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }
  .table-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin-bottom: 20px;
  }
  .table-wrap::-webkit-scrollbar {
    height: 4px;
  }
  .table-wrap::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    margin-bottom: 20px;
  }
  .table-wrap table {
    margin-bottom: 0;
  }
  th, td {
    padding: 6px 12px 6px 0;
    vertical-align: middle;
  }
  th {
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }
  td {
    border-bottom: 1px solid var(--border);
  }
  tr:last-child td {
    border-bottom: none;
  }
  .date, .size {
    text-align: right;
    white-space: nowrap;
    padding-right: 16px;
  }
  th.date, th.size {
    text-align: right;
    padding-right: 16px;
  }
  .desc {
    color: var(--text-muted);
  }
  a {
    color: var(--link);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  address {
    font-style: normal;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 20px;
  }
  @media (max-width: 640px) {
    body {
      padding: 16px;
    }
    h1 {
      font-size: 17px;
      word-break: break-all;
    }
    h2 {
      font-size: 14px;
    }
    th, td {
      padding: 8px 10px 8px 0;
    }
    .table-wrap table {
      min-width: 480px;
    }
    address {
      word-break: break-all;
    }
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
  <title>Index of /</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Index of /</h1>
  <hr>
  <p>Cloudflare Worker &amp; R2 Edge Distribution Gateway</p>
  <div class="table-wrap">
    <table>
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
          <td><a href="/${app.name}/">${app.name}/</a></td>
          <td class="date">-</td>
          <td class="size">-</td>
          <td class="desc">${app.title}${app.description ? ` - ${app.description}` : ""}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>
  <hr>
  <address>Distribution Gateway · Edge Powered · <a href="${currentOrigin}/api/version.json">API Manifest</a></address>
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of /${app}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Index of /<a href="/">[Root]</a> / <span>${app}</span> /</h1>
  <hr>
  <p><a href="/">../ (Parent Directory)</a></p>

  <h2>Directory (按设备类型区分)</h2>
  <div class="table-wrap">
    <table>
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
          <td><a href="/${app}/desktop/">desktop/</a></td>
          <td class="date">${latestDesktop?.publishedAt.slice(0, 10) || "-"}</td>
          <td class="size">${desktopReleases.length}</td>
          <td class="desc">Desktop 桌面端 (macOS, Windows, Linux) · 最新: <a href="/${app}/desktop/${latestDesktopVersion}/">v${latestDesktopVersion}</a></td>
        </tr>
        <tr>
          <td><a href="/${app}/android/">android/</a></td>
          <td class="date">${latestAndroid?.publishedAt.slice(0, 10) || "-"}</td>
          <td class="size">${androidReleases.length}</td>
          <td class="desc">Android 移动端 (APK) · 最新: <a href="/${app}/android/${latestAndroidVersion}/">v${latestAndroidVersion}</a></td>
        </tr>
      </tbody>
    </table>
  </div>

  <h2>desktop/</h2>
  <div class="table-wrap">
    <table>
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
          <td><a href="/${app}/desktop/${r.version}/">${r.version}/</a>${idx === 0 ? " [Latest]" : ""}</td>
          <td class="date">${r.publishedAt.slice(0, 10)}</td>
          <td class="size">${r.assets.length} files</td>
          <td class="desc">macOS (Apple Silicon / Intel), Windows (x64), Linux (AppImage)</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <h2>android/</h2>
  <div class="table-wrap">
    <table>
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
          <td><a href="/${app}/android/${r.version}/">${r.version}/</a>${idx === 0 ? " [Latest]" : ""}</td>
          <td class="date">${r.publishedAt.slice(0, 10)}</td>
          <td class="size">${r.assets.length} files</td>
          <td class="desc">Android (APK)</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>
  <hr>
  <address>Application: ${app} · Desktop: ${desktopReleases.length} releases · Android: ${androidReleases.length} releases · <a href="${currentOrigin}/api/${app}/releases">JSON API</a></address>
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
  <title>Index of /${app}/${device}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Index of /<a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <span>${device}</span> /</h1>
  <hr>
  <p><a href="/${app}/">../ (Parent Directory)</a></p>
  <p class="desc">${deviceTitle}版本列表 · 共 ${releases.length} 个版本</p>
  <div class="table-wrap">
    <table>
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
          <td><a href="/${app}/${device}/${r.version}/">${r.version}/</a>${idx === 0 ? " [Latest]" : ""}</td>
          <td class="date">${r.publishedAt.slice(0, 10)}</td>
          <td class="size">${r.assets.length} files</td>
          <td class="desc">${isAndroid ? "Android (APK)" : "macOS / Windows / Linux"}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>
  <hr>
  <address>Application: ${app} · Device: ${device} · Total: ${releases.length} versions · <a href="${currentOrigin}/api/${app}/${device}/releases">JSON API</a></address>
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
  <title>Index of /${app}/${device}/${release.version}/</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Index of /<a href="/">[Root]</a> / <a href="/${app}/">${app}</a> / <a href="${parentUrl}">${device}</a> / <span>${release.version}</span> /</h1>
  <hr>
  <p><a href="${parentUrl}">../ (Parent Directory)</a></p>
  <p class="desc">发布日期: ${release.publishedAt.slice(0, 10)}${release.isLatest ? " · [Latest]" : ""}${
    release.releaseNotesUrl
      ? ` · <a href="${release.releaseNotesUrl}" target="_blank">Release Notes</a>`
      : ""
  }</p>
  <div class="table-wrap">
    <table>
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
            const sourceTag = asset.isR2Cached ? "[R2 Edge]" : "[GitHub]";
            return `
        <tr>
          <td><a href="${asset.downloadUrl}" download="${asset.fileName}">${asset.fileName}</a></td>
          <td class="date">${release.publishedAt.slice(0, 10)}</td>
          <td class="size">${asset.formattedSize}</td>
          <td class="desc">${asset.platformLabel || asset.platform} ${sourceTag}</td>
        </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  </div>
  <hr>
  <address>Application: ${app} · Device: ${device} · Version: ${release.version} · <a href="${currentOrigin}/api/${app}/${device}/releases">Device Releases API</a> · <a href="${currentOrigin}/api/${app}/releases">All Releases API</a></address>
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
