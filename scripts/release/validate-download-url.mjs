/**
 * 发布直链与校验和的守门校验。
 *
 * 背景：`release-desktop.yml` 里 `find release-artifacts -type f -name A -o -name B -print -quit`
 * 少了括号分组，`-print -quit` 只挂在第二个分支上——文件名命中第一个条件时 find
 * 什么都不输出（实测），于是 URL 被拼成 `https://.../<version>/`（目录、无文件名）、
 * SHA-256 为空，还会被静默写进安装脚本。这类"非空但残缺"的值比缺值更危险，
 * 因为下游的 `|| 默认直链` 兜底不会再触发。
 *
 * 因此：产物缺失允许留空（脚本运行期会明确提示该架构暂不可用），但只要给了 URL，
 * 就必须是带文件名的 http(s) 直链，且校验和必须是 64 位十六进制。
 */

const HTTP_URL_PATTERN = /^https?:\/\//iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
// 纯版本号形态（如 "0.11.0"）说明 URL 被截断到了版本目录，必然不是文件
const VERSION_ONLY_PATTERN = /^[\d.]+$/u;

export function assertDownloadUrl(envName, value) {
  const url = String(value ?? "").trim();
  if (!url) {
    return "";
  }

  if (!HTTP_URL_PATTERN.test(url)) {
    throw new Error(`${envName} 必须是 http(s) 直链，收到 "${url}"`);
  }

  const lastSegment = new URL(url).pathname.split("/").pop() ?? "";
  if (!lastSegment || !lastSegment.includes(".") || VERSION_ONLY_PATTERN.test(lastSegment)) {
    throw new Error(`${envName} 缺少文件名（疑似构建产物未找到导致 URL 被截断为目录）: "${url}"`);
  }

  return url;
}

export function assertSha256(envName, url, value) {
  const sha256 = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!url) {
    // 直链本身不可用时，校验和无意义，保持空值由脚本运行期处理
    return "";
  }

  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${envName} 必须是 64 位十六进制 SHA-256（直链存在时不允许为空）: "${sha256}"`);
  }

  return sha256;
}
