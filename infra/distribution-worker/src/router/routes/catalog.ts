/**
 * @file catalog.ts
 * @description 规范 HTML 别名与快捷重定向、层级目录（9.1-9.4）与历史安装包下载。
 *
 * 自 handleRequest 按路由族整体平移（行为不变）；返回 `undefined` 表示未命中，交由下一族处理。
 */

import type { RouterContext } from "../context.ts";
import type { ReleaseInfo } from "../../types.ts";
import { getMimeType } from "../../distribution/platform-assets.ts";
import { proxyGitHubAsset, serveFirstR2BucketObject } from "../../distribution/object-responses.ts";
import { buildReleasesManifest } from "../../releases/manifest.ts";
import {
  renderAppDevicesHtml,
  renderDeviceVersionsHtml,
  renderVersionFilesHtml,
} from "../../portal.ts";

export async function handleCatalogRoutes(context: RouterContext): Promise<Response | undefined> {
  const { url, path, defaultApp, env, githubRepo, respond, trackDownload, request } = context;

  // 8. 规范 HTML 别名与快捷重定向（302 重定向至规范 /:app/:device/ 层级，严格消除平台名冒充应用名的歧义）
  if (
    path === "/android" ||
    path === "/android/" ||
    path === "/releases/android" ||
    path === "/releases/android/" ||
    path === "/releases/mobile" ||
    path === "/releases/mobile/" ||
    path === "/mobile" ||
    path === "/mobile/"
  ) {
    return Response.redirect(`${url.origin}/${defaultApp}/android/`, 302);
  }

  if (
    path === "/desktop" ||
    path === "/desktop/" ||
    path === "/releases/desktop" ||
    path === "/releases/desktop/"
  ) {
    return Response.redirect(`${url.origin}/${defaultApp}/desktop/`, 302);
  }

  if (
    path === "/ios" ||
    path === "/ios/" ||
    path === "/releases/ios" ||
    path === "/releases/ios/"
  ) {
    return Response.redirect(`${url.origin}/${defaultApp}/ios/`, 302);
  }

  if (path === "/releases" || path === "/releases/" || path === "/portal" || path === "/portal/") {
    return Response.redirect(`${url.origin}/${defaultApp}/`, 302);
  }

  // 9. 层级目录与安装包下载路由
  const segments = path.replace(/^\//, "").split("/").filter(Boolean);

  // 9.1 单段路径：应用设备目录 Index of /:app/ (如 /inkpoint)
  if (segments.length === 1) {
    const app = segments[0];
    if (
      !["api", "gh", "favicon.ico", "releases", "android", "desktop", "mobile", "ios"].includes(app)
    ) {
      const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
      const html = renderAppDevicesHtml(app, manifest, url.origin);
      return respond(
        new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      );
    }
  }

  // 9.2 双段路径：
  // a) /:app/desktop 或 /:app/android: 设备专属版本列表 Index of /:app/:device/
  // b) /:app/:version (兼容旧路由): 具体版本安装包详情
  if (segments.length === 2) {
    const [app, sub] = segments;
    if (!["api", "gh", "favicon.ico"].includes(app)) {
      const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);

      // 设备分类目录
      if (sub === "desktop") {
        const html = renderDeviceVersionsHtml(app, "desktop", manifest, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }
      if (sub === "android" || sub === "mobile") {
        const html = renderDeviceVersionsHtml(app, "android", manifest, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }
      if (sub === "ios" || sub === "ios-ipa") {
        const html = renderDeviceVersionsHtml(app, "ios", manifest, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }

      // 兼容历史直接访问版本号 /:app/:version/
      const cleanVer = sub.replace(/^v/, "");
      const release = manifest.releases.find(
        (r) =>
          r.version === cleanVer ||
          r.version === sub ||
          r.tagName === sub ||
          r.tagName === `android-v${cleanVer}` ||
          r.tagName === `v${cleanVer}`,
      );

      if (release) {
        const device =
          release.category === "ios" ||
          (release.assets.length > 0 && release.assets.every((a) => a.platform === "ios"))
            ? "ios"
            : release.category === "android" ||
                (release.assets.length > 0 && release.assets.every((a) => a.platform === "android"))
              ? "android"
              : "desktop";
        const html = renderVersionFilesHtml(app, device, release, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }

      return new Response(
        JSON.stringify({
          error: "Version or device not found",
          app,
          sub,
          hint: `Check available directories at /${app}/`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        },
      );
    }
  }

  // 9.3 三段路径：
  // a) /:app/:device/:version: 设备具体版本详情 (如 /inkpoint/desktop/0.10.2/)
  // b) /:app/:version/:filename: 历史旧下载链接
  if (segments.length === 3) {
    const [app, part2, part3] = segments;
    if (!["api", "gh"].includes(app)) {
      if (part2 === "desktop" || part2 === "android" || part2 === "ios" || part2 === "ios-ipa") {
        const device = part2 === "ios-ipa" ? "ios" : part2;
        const version = part3;
        const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
        const cleanVer = version.replace(/^v/, "");
        const matchesDevice = (r: ReleaseInfo): boolean => {
          if (device === "ios") {
            return r.category === "ios" || r.assets.some((a) => a.platform === "ios");
          }
          if (device === "android") {
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
        };
        const release = manifest.releases.find(
          (r) =>
            matchesDevice(r) &&
            (r.version === cleanVer ||
              r.version === version ||
              r.tagName === version ||
              r.tagName === `android-v${cleanVer}` ||
              r.tagName === `ios-ipa-v${cleanVer}` ||
              r.tagName === `v${cleanVer}`),
        );

        if (release) {
          const html = renderVersionFilesHtml(app, device, release, url.origin);
          return respond(
            new Response(html, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            error: "Version not found for device",
            app,
            device,
            version,
            hint: `Check available versions at /${app}/${device}/`,
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          },
        );
      }

      // b) 兼容旧三段路径下载: /:app/:version/:filename (要求 part2 为版本号且 part3 包含扩展名)
      if (part2.match(/^v?\d+\.\d+/) && part3.includes(".")) {
        const version = part2;
        const filename = part3;
        const contentType = getMimeType(filename);

        // A. 优先从 R2 获取（支持 Range 断点续传）
        if (env.RELEASE_BUCKET) {
          const hit = await serveFirstR2BucketObject(
            env.RELEASE_BUCKET,
            [
              `${app}/desktop/${version}/${filename}`,
              `${app}/${version}/${filename}`,
              `${app}/android/${version}/${filename}`,
            ],
            request,
            { customFileName: filename, contentType, isImmutable: true },
          );
          if (hit) {
            trackDownload(app, version, filename);
            return hit.response;
          }
        }

        // B. 回退 GitHub Releases
        const targetTag = version.startsWith("v") ? version : `v${version}`;
        const sourceUrl = `https://github.com/${githubRepo}/releases/download/${targetTag}/${filename}`;
        const proxyRes = await proxyGitHubAsset(sourceUrl, request, filename);
        if (proxyRes.ok || proxyRes.status === 206) {
          trackDownload(app, version, filename);
        }
        return proxyRes;
      }
    }
  }

  // 9.4 四段路径：规范层级下载 /:app/:device/:version/:filename (如 /inkpoint/desktop/0.10.1/Inkpoint_0.10.1_aarch64.dmg)
  if (segments.length === 4) {
    const [app, device, version, filename] = segments;
    const knownDevices = ["desktop", "android", "ios", "macos", "windows", "linux", "mobile"];

    if (knownDevices.includes(device) && filename.includes(".")) {
      const contentType = getMimeType(filename);

      // A. 优先从 R2 获取（支持 Range 断点续传）
      if (env.RELEASE_BUCKET) {
        const hit = await serveFirstR2BucketObject(
          env.RELEASE_BUCKET,
          [
            `${app}/${device}/${version}/${filename}`,
            `${app}/desktop/${version}/${filename}`,
            `${app}/android/${version}/${filename}`,
            `${app}/${version}/${filename}`,
          ],
          request,
          { customFileName: filename, contentType, isImmutable: true },
        );
        if (hit) {
          trackDownload(app, version, filename);
          return hit.response;
        }
      }

      // B. 桌面端或安卓端从 GitHub Release 对应 tag 回源
      const targetTag =
        device === "android"
          ? `android-v${version.replace(/^android-v/, "").replace(/^v/, "")}`
          : version.startsWith("v")
            ? version
            : `v${version}`;
      const sourceUrl = `https://github.com/${githubRepo}/releases/download/${targetTag}/${filename}`;
      const proxyRes = await proxyGitHubAsset(sourceUrl, request, filename);
      if (proxyRes.ok || proxyRes.status === 206) {
        trackDownload(app, version, filename);
      }
      return proxyRes;
    }
  }

  return undefined;
}
