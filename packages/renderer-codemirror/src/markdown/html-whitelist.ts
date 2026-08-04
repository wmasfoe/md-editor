/**
 * M4-a HTML 白名单常量（D5 定稿，见 docs/agent/design/m4_html_mdx_security_review.md §5）
 *
 * 任何调整必须同步 html-sanitize.test.ts 的清单断言（禁止只改常量不改测试）。
 * 不变量：ALLOWED_HTML_ATTRS 必须为 ALLOWED_HTML_TAGS 的每个标签登记属性——
 * sanitize-html 对未登记 allowedAttributes 的白名单标签会放行全部属性（实测确认），
 * 该不变量由 html-sanitize.ts 的 exclusiveFilter 兜底 + 本模块单测双重锁定。
 */

/** 白名单标签（不含 table 系/form 系/iframe/object/embed/script/style/link/meta/svg/math/input/button/xmp） */
export const ALLOWED_HTML_TAGS = [
  "p",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "small",
  "mark",
] as const;

/** 拒绝属性（命中任一 → 已登记标签属性级剥离；exclusiveFilter 兜底整标签剔除） */
export const DENIED_HTML_ATTRS = ["class", "id", "style", "srcdoc", "width", "height"] as const;

/** 拒绝属性前缀（无条件硬拒） */
export const DENIED_HTML_ATTR_PREFIXES = ["data-", "on"] as const;

/** 白名单属性（按标签显式登记；逐标签，D5："a[href,title] / img[src,alt,title] / 其余仅 title"） */
export const ALLOWED_HTML_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title"],
  img: ["src", "alt", "title"],
  p: ["title"],
  div: ["title"],
  span: ["title"],
  h1: ["title"],
  h2: ["title"],
  h3: ["title"],
  h4: ["title"],
  h5: ["title"],
  h6: ["title"],
  blockquote: ["title"],
  pre: ["title"],
  code: ["title"],
  br: ["title"],
  hr: ["title"],
  ul: ["title"],
  ol: ["title"],
  li: ["title"],
  strong: ["title"],
  em: ["title"],
  b: ["title"],
  i: ["title"],
  u: ["title"],
  s: ["title"],
  sub: ["title"],
  sup: ["title"],
  small: ["title"],
  mark: ["title"],
};

/** 链接协议白名单（a[href]，scheme 不带冒号） */
export const ALLOWED_LINK_PROTOCOLS = ["http", "https", "mailto"] as const;

/** 图片协议白名单（img[src]，scheme 不带冒号；data: 单独走 isAllowedDataImage） */
export const ALLOWED_IMAGE_PROTOCOLS = ["http", "https", "asset"] as const;

/** 属性是否命中拒绝清单/拒绝前缀 */
export function isDeniedHtmlAttr(name: string): boolean {
  return (
    (DENIED_HTML_ATTRS as readonly string[]).includes(name) ||
    DENIED_HTML_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** 提取小写 scheme；无 scheme（相对路径/协议相对）返回 null */
function extractScheme(value: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

/** 链接协议判定（http/https/mailto 白名单；javascript:/data:/file: 等拒绝）。
 * 无 scheme 值（相对路径/锚点/协议相对，如 "x.png"、"/a"、"/#t"）不具脚本执行面，放行
 * （与 sanitize-html 实测行为一致：无 scheme 的 src/href 不被 scheme 过滤剥离）。 */
export function isAllowedLinkProtocol(value: string): boolean {
  const scheme = extractScheme(value);
  return scheme === null || (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(scheme);
}

/** data: 图片判定（data:image/* 放行，svg/xml 类拒绝——data:image/svg+xml 可携脚本载荷） */
export function isAllowedDataImage(value: string): boolean {
  return /^data:image\/(?!svg)/i.test(value.trim());
}

/** 图片 src 判定（无 scheme 放行；http/https/asset 白名单；data: 仅 data:image 非 svg） */
export function isAllowedImageSrc(value: string): boolean {
  const scheme = extractScheme(value);
  if (scheme === null) return true;
  if (scheme === "data") return isAllowedDataImage(value);
  return (ALLOWED_IMAGE_PROTOCOLS as readonly string[]).includes(scheme);
}
