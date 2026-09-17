import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderAppIndexHtml,
  renderAppDevicesHtml,
  renderDeviceVersionsHtml,
  renderVersionFilesHtml,
} from "../src/portal.ts";
import { buildReleasesManifest, SUPPORTED_APPS } from "../src/router.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const BASE_URL = process.env.PUBLIC_DOMAIN
  ? `https://${process.env.PUBLIC_DOMAIN}`
  : "https://download.justdev.cn";

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeStaticFile(relPath: string, content: string) {
  const fullPath = path.join(PUBLIC_DIR, relPath);
  ensureDir(fullPath);
  fs.writeFileSync(fullPath, content, "utf-8");
}

export async function buildStaticPortal(app = "inkpoint", repo = "wmasfoe/md-editor") {
  console.log(`🔨 Building static distribution portal for ${app} (${repo})...`);

  // 1. 获取清单（支持 GitHub API、本地回退容灾）
  const manifest = await buildReleasesManifest(app, repo, {}, BASE_URL);

  // 清空或初始化 public 目录
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // 2. 根目录 / (Index of /)
  const rootHtml = renderAppIndexHtml(SUPPORTED_APPS, BASE_URL);
  writeStaticFile("index.html", rootHtml);

  // 3. 应用设备第一级分类目录 /:app/ (Index of /:app/) 与 /releases/ 别名
  const appDevicesHtml = renderAppDevicesHtml(app, manifest, BASE_URL);
  writeStaticFile(`${app}/index.html`, appDevicesHtml);
  writeStaticFile("releases/index.html", appDevicesHtml);

  // 4. 设备目录 /:app/desktop/ 与 /releases/desktop/
  const desktopHtml = renderDeviceVersionsHtml(app, "desktop", manifest, BASE_URL);
  writeStaticFile(`${app}/desktop/index.html`, desktopHtml);
  writeStaticFile("releases/desktop/index.html", desktopHtml);

  // 5. 设备目录 /:app/android/ 与 /releases/android/
  const androidHtml = renderDeviceVersionsHtml(app, "android", manifest, BASE_URL);
  writeStaticFile(`${app}/android/index.html`, androidHtml);
  writeStaticFile("releases/android/index.html", androidHtml);

  // 6. 各具体版本的安装包列表页面
  for (const release of manifest.releases) {
    const hasDesktop =
      release.category === "desktop" ||
      release.assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      );

    const hasAndroid =
      release.category === "android" || release.assets.some((a) => a.platform === "android");

    if (hasDesktop) {
      const desktopVersionHtml = renderVersionFilesHtml(app, "desktop", release, BASE_URL);
      // 规范层级: /:app/desktop/:version/index.html
      writeStaticFile(`${app}/desktop/${release.version}/index.html`, desktopVersionHtml);
      // 兼容历史旧路由: /:app/:version/index.html
      writeStaticFile(`${app}/${release.version}/index.html`, desktopVersionHtml);
    }

    if (hasAndroid) {
      const androidVersionHtml = renderVersionFilesHtml(app, "android", release, BASE_URL);
      // 规范层级: /:app/android/:version/index.html
      writeStaticFile(`${app}/android/${release.version}/index.html`, androidVersionHtml);
    }
  }

  // 7. 静态 API 产物
  writeStaticFile(`api/${app}/releases`, JSON.stringify(manifest, null, 2));
  writeStaticFile(`api/${app}/releases.json`, JSON.stringify(manifest, null, 2));

  console.log(`🎉 Static distribution portal generated successfully in ${PUBLIC_DIR}!`);
}

// CLI 执行入口
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStaticPortal().catch((err) => {
    console.error("Failed to build static portal:", err);
    process.exit(1);
  });
}
