/**
 * @file latest-artifacts.ts
 * @description 各端 latest 直链（Android / iOS / 桌面）与一键安装脚本。
 *
 * 自 handleRequest 按路由族整体平移（行为不变）；返回 `undefined` 表示未命中，交由下一族处理。
 */

import type { RouterContext } from "../context.ts";
import type { AppVersionManifest } from "../../types.ts";
import { fetchLatestRelease } from "../../distribution/github-releases.ts";
import {
  matchDesktopAsset,
  selectDesktopManifestAsset,
} from "../../distribution/platform-assets.ts";
import { proxyGitHubAsset, serveR2Object } from "../../distribution/object-responses.ts";

export async function handleLatestArtifactsRoutes(
  context: RouterContext,
): Promise<Response | undefined> {
  const { path, defaultApp, env, githubRepo, respond, trackDownload, request } = context;

  // 5. Android 最新版直链: /:app/android/latest 或 /android/latest
  const androidMatch = path.match(/^(?:\/([^/]+))?\/android\/(?:latest|latest\.apk)$/);
  if (androidMatch) {
    const app = androidMatch[1] || defaultApp;

    if (env.RELEASE_BUCKET) {
      // 优先找最新版软链/定名文件
      const latestObj = await env.RELEASE_BUCKET.get(`${app}/android/latest.apk`);
      if (latestObj) {
        const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
        if (manifestObj) {
          try {
            const manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
            const version = manifest.android?.version;
            const fileName = manifest.android?.apk.fileName;
            if (version && fileName && manifest.android?.apk.version === version) {
              trackDownload(app, version, fileName);
            }
          } catch {
            // 清单不可用时不写入无法归属具体版本的统计。
          }
        }
        return serveR2Object(
          latestObj,
          `${app}-latest.apk`,
          "application/vnd.android.package-archive",
        );
      }

      // 如果未放 latest.apk，检查清单中指定的最新版
      const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (manifestObj) {
        try {
          const manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
          if (manifest.android?.version) {
            const version = manifest.android.version;
            const versionObj =
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/Inkpoint_${version}.apk`)) ||
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/app-debug.apk`)) ||
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/inkpoint-${version}.apk`));
            if (versionObj) {
              trackDownload(app, version, `Inkpoint_${version}.apk`);
              return serveR2Object(
                versionObj,
                `Inkpoint_${version}.apk`,
                "application/vnd.android.package-archive",
              );
            }
          }
        } catch {
          // 清单解析失败
        }
      }
    }

    return new Response(
      JSON.stringify({
        error: "Android release artifact not found in R2 bucket",
        app,
        help: "Please upload APK via GitHub Actions workflow 'release-mobile.yml'",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5.5 iOS 未签名 IPA 最新版直链: /:app/ios/latest 或 /ios/latest
  // 未签名包由用户侧自签工具（Sideloadly / AltStore / LiveContainer）重签后安装。
  const iosMatch = path.match(/^(?:\/([^/]+))?\/ios\/(?:latest|latest\.ipa)$/);
  if (iosMatch) {
    const app = iosMatch[1] || defaultApp;

    if (env.RELEASE_BUCKET) {
      const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (manifestObj) {
        try {
          const manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
          const iosNode = manifest.ios;
          const version = iosNode?.version;
          if (version && iosNode?.ipa) {
            const fileName = iosNode.ipa.fileName || `Inkpoint-${version}-unsigned.ipa`;
            const versionObj =
              (await env.RELEASE_BUCKET.get(`${app}/ios/${version}/${fileName}`)) ||
              (await env.RELEASE_BUCKET.get(`${app}/ios/${version}/latest.ipa`));
            if (versionObj) {
              trackDownload(app, version, fileName);
              return serveR2Object(versionObj, fileName, "application/octet-stream");
            }
          }
        } catch {
          // 清单解析失败：继续走下面的 404 提示
        }
      }
    }

    return new Response(
      JSON.stringify({
        error: "iOS release artifact not found in R2 bucket",
        app,
        help: "Please upload the unsigned IPA via GitHub Actions workflow 'build-ios-ipa.yml'",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // 4.5 一键安装脚本路由: /:app/desktop/install.(sh|ps1), /desktop/install.(sh|ps1), /install.(sh|ps1)
  const installScriptMatch = path.match(/^(?:\/([^/]+))?(?:\/desktop)?\/(install\.(?:sh|ps1))$/);
  if (installScriptMatch) {
    const app = installScriptMatch[1] || defaultApp;
    const scriptFile = installScriptMatch[2];
    const isPowerShell = scriptFile.endsWith(".ps1");
    const contentType = isPowerShell
      ? "text/plain; charset=utf-8"
      : "text/x-shellscript; charset=utf-8";

    // A. 优先从 R2 存储桶读取
    if (env.RELEASE_BUCKET) {
      const candidates = [
        `${app}/desktop/${scriptFile}`,
        `${app}/${scriptFile}`,
        `desktop/${scriptFile}`,
        scriptFile,
      ];
      for (const candidate of candidates) {
        const r2Obj = await env.RELEASE_BUCKET.get(candidate);
        if (r2Obj) {
          return serveR2Object(r2Obj, scriptFile, contentType, false);
        }
      }
    }

    // B. 回退代理 GitHub 上游 raw 脚本
    const githubRawFileName = isPowerShell ? "install-md-editor.ps1" : "install-md-editor.sh";
    const rawUrls = [
      `https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/${githubRawFileName}`,
      `https://raw.githubusercontent.com/${githubRepo}/main/${scriptFile}`,
    ];

    for (const rawUrl of rawUrls) {
      try {
        const rawRes = await fetch(rawUrl, {
          headers: { "User-Agent": "Inkpoint-Distribution-Worker/1.0" },
        });
        if (rawRes.ok) {
          const content = await rawRes.text();
          return respond(
            new Response(content, {
              status: 200,
              headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=300, s-maxage=600",
              },
            }),
          );
        }
      } catch {
        // try next fallback
      }
    }

    return new Response(
      JSON.stringify({
        error: "Install script not found",
        script: scriptFile,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5. 桌面端最新版直链: /:app/desktop/:platform/latest 或 /desktop/:platform/latest
  const desktopMatch = path.match(/^(?:\/([^/]+))?\/desktop\/([^/]+)\/latest$/);
  if (desktopMatch) {
    const app = desktopMatch[1] || defaultApp;
    const platform = desktopMatch[2].toLowerCase();

    // A. 优先从 R2 存储桶获取桌面端产物
    if (env.RELEASE_BUCKET) {
      const mimeTypes: Record<string, string> = {
        dmg: "application/x-apple-diskimage",
        exe: "application/x-msdownload",
        AppImage: "application/x-executable",
        appimage: "application/x-executable",
        deb: "application/vnd.debian.binary-package",
      };
      let r2Manifest: AppVersionManifest | null = null;
      const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (manifestObj) {
        try {
          r2Manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
        } catch {
          // 清单不可用时仍允许下载 latest 别名，但统计只能保留 latest。
        }
      }

      // 1. 尝试直接获取固化的 latest 别名文件
      const platformCandidates: Record<string, string[]> = {
        macos: [`${app}/desktop/macos/latest.dmg`, `${app}/desktop/latest.dmg`],
        "macos-arm64": [`${app}/desktop/macos/latest.dmg`],
        "macos-x64": [`${app}/desktop/macos-x64/latest.dmg`],
        windows: [`${app}/desktop/windows/latest.exe`, `${app}/desktop/latest.exe`],
        "windows-x64": [`${app}/desktop/windows/latest.exe`],
        "windows-arm64": [`${app}/desktop/windows-arm64/latest.exe`],
        linux: [`${app}/desktop/linux/latest.AppImage`, `${app}/desktop/latest.AppImage`],
        "linux-x64": [`${app}/desktop/linux/latest.AppImage`],
        "linux-amd64": [`${app}/desktop/linux/latest.AppImage`],
        // ARM 别名无物理 R2 文件：latest 由 version.json 动态路由，直接走版本化查找。
        "linux-arm64": [],
        "linux-aarch64": [],
        "linux-deb": [`${app}/desktop/linux/latest.deb`],
        "linux-deb-arm64": [],
        "linux-deb-aarch64": [],
      };

      const candidates = platformCandidates[platform] || [
        `${app}/desktop/${platform}/latest.dmg`,
        `${app}/desktop/${platform}/latest.exe`,
        `${app}/desktop/${platform}/latest.AppImage`,
      ];

      for (const candidate of candidates) {
        const r2Obj = await env.RELEASE_BUCKET.get(candidate);
        if (r2Obj) {
          const ext = candidate.split(".").pop() || "";
          const manifestAsset = selectDesktopManifestAsset(r2Manifest, platform);
          const analyticsVersion = r2Manifest?.desktop?.version;
          if (
            analyticsVersion &&
            manifestAsset?.fileName &&
            manifestAsset.version === analyticsVersion
          ) {
            trackDownload(app, analyticsVersion, manifestAsset.fileName);
          }
          return serveR2Object(
            r2Obj,
            `${app}-${platform}-latest.${ext}`,
            mimeTypes[ext] || "application/octet-stream",
          );
        }
      }

      // 2. 根据同一份版本清单查找具体版本文件
      const dVer = r2Manifest?.desktop?.version;
      const assetInfo = selectDesktopManifestAsset(r2Manifest, platform);
      if (dVer && assetInfo?.fileName) {
        const versionedObj = await env.RELEASE_BUCKET.get(
          `${app}/desktop/${dVer}/${assetInfo.fileName}`,
        );
        if (versionedObj) {
          const ext = assetInfo.fileName.split(".").pop() || "";
          trackDownload(app, dVer, assetInfo.fileName);
          return serveR2Object(
            versionedObj,
            assetInfo.fileName,
            mimeTypes[ext] || "application/octet-stream",
          );
        }
      }
    }

    // B. 回退方案：从 GitHub Releases 代理获取
    try {
      const release = await fetchLatestRelease(githubRepo, env);

      if (release) {
        const matched = matchDesktopAsset(release.assets, platform);
        if (matched) {
          const v = release.tag_name.replace(/^(?:desktop-)?v/, "");
          trackDownload(app, v, matched.name);
          return proxyGitHubAsset(matched.url, request, matched.name);
        }

        return new Response(
          JSON.stringify({
            error: `No asset found matching platform '${platform}'`,
            availableAssets: release.assets.map((a) => a.name),
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      // 如果 GitHub API 频控 (403) 且无本地缓存，直接代理至 GitHub latest/download 约定命名直链，避免 502
      let fallbackFileName = "Inkpoint_aarch64.dmg";
      const p = platform.toLowerCase();
      if (p.includes("mac") || p.includes("dmg")) {
        fallbackFileName = p.includes("x64") ? "Inkpoint_x64.dmg" : "Inkpoint_aarch64.dmg";
      } else if (p.includes("win") || p.includes("exe")) {
        fallbackFileName = p.includes("arm64")
          ? "Inkpoint_arm64-setup.exe"
          : "Inkpoint_x64-setup.exe";
      } else if (p.includes("deb")) {
        // deb 点名 arm 才回退 ARM 包，与 latest 路由的默认 x64 保持一致。
        // 注意：必须放在 linux 分支之前，因为 linux-deb-* 同时包含 linux 子串。
        fallbackFileName =
          p.includes("arm") || p.includes("aarch") ? "Inkpoint_arm64.deb" : "Inkpoint_amd64.deb";
      } else if (p.includes("linux") || p.includes("appimage")) {
        fallbackFileName =
          p.includes("arm") || p.includes("aarch")
            ? "Inkpoint_aarch64.AppImage"
            : "Inkpoint_amd64.AppImage";
      }

      const fallbackUrl = `https://github.com/${githubRepo}/releases/latest/download/${fallbackFileName}`;
      const proxyRes = await proxyGitHubAsset(fallbackUrl, request, fallbackFileName);
      // 无法从固定 latest 直链确认具体版本时，不写入无法归属版本的统计。
      return proxyRes;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Internal Gateway Error", details: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return undefined;
}
