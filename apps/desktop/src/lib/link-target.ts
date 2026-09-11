/**
 * @file link-target.ts
 * @module apps/desktop/lib/link-target
 * @description
 * 链接目标解析与规范化工具库。
 *
 * 负责解析 Markdown 中的内链、外链、锚点（Fragment）、外部协议 Schemes（如 mailto、vscode 等），
 * 并正确区分 Windows 盘符绝对路径与 URI Scheme，防止将 `C:\path` 误判为外部协议链接。
 */

/**
 * 拆分后的链接目标构成部分。
 */
export interface LinkHrefParts {
  /** 目标路径（不含锚点哈希） */
  readonly path: string;
  /** 锚点片段标识符（若存在），已执行 URL 解码 */
  readonly fragment: string | null;
}

const HTTP_URL_PATTERN = /^https?:\/\//iu;
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

/**
 * 判断给定的 href 是否为标准 HTTP/HTTPS Web 网页链接。
 *
 * @param href 待测试的链接地址
 */
export function isHttpLink(href: string): boolean {
  return HTTP_URL_PATTERN.test(href.trim());
}

/**
 * 判断给定的 href 是否属于外部自定义协议（如 `mailto:`, `obsidian:`, `vscode:` 等）。
 *
 * 特别注意：会自动过滤 Windows 盘符绝对路径（如 `C:/foo`），避免误将其判断为外部协议。
 *
 * @param href 待测试的链接地址
 */
export function isExternalSchemeLink(href: string): boolean {
  const value = href.trim();
  return EXTERNAL_SCHEME_PATTERN.test(value) && !isWindowsAbsolutePath(value);
}

/**
 * 将链接地址拆分为基础路径与锚点片段（Fragment）。
 *
 * @param href 原始链接地址
 * @returns 拆解后的路径与锚点对象
 *
 * @example
 * ```ts
 * splitLinkHref("doc.md#introduction")
 * // => { path: "doc.md", fragment: "introduction" }
 * ```
 */
export function splitLinkHref(href: string): LinkHrefParts {
  const trimmed = href.trim();
  const hashIndex = trimmed.indexOf("#");

  if (hashIndex < 0) {
    return { path: trimmed, fragment: null };
  }

  return {
    path: trimmed.slice(0, hashIndex),
    fragment: decodeLinkFragment(trimmed.slice(hashIndex + 1)),
  };
}

/**
 * 获取路径的基本文件名（末尾段）。
 *
 * 自动统一处理 Windows 反斜杠 `\` 与 Unix 斜杠 `/`，并剔除末尾多余斜杠。
 *
 * @param path 文件系统路径
 */
export function basename(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

/**
 * 规范化本地超链接的目标路径。
 *
 * 剥离 URL 查询参数（`?query`）、去除尖括号包裹（`<path>`）并解码 URI 编码字符。
 *
 * @param path 原始路径字符串
 */
export function normalizeLocalHrefPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const unwrapped =
    withoutQuery.startsWith("<") && withoutQuery.endsWith(">")
      ? withoutQuery.slice(1, -1)
      : withoutQuery;

  try {
    return decodeURI(unwrapped);
  } catch {
    return unwrapped;
  }
}

/**
 * 解码 URL 锚点片段。
 */
function decodeLinkFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * 判断字符串是否为 Windows 驱动器盘符开头的绝对路径（如 `C:\...` 或 `D:/...`）。
 */
function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value);
}
