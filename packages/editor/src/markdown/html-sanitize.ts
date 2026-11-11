/**
 * M4-a HTML 白名单清洗（字符串层，Node 无 DOM 直接运行）
 *
 * 双层纵深第一层：把 HTML 块源码清洗为安全字符串，供投影管线做白名单 DOM 重建
 * （渲染层禁 innerHTML 装载用户内容为第二层，见 html-projection.ts / html-block-widget.ts）。
 *
 * 双轨拒绝语义（D5 实现注，实测确认）：
 * ① 已登记 allowedAttributes 的标签 → 属性级剥离（sanitize-html 在 exclusiveFilter 之前完成），标签保留；
 * ② exclusiveFilter 兜底 → 未登记 allowedAttributes 的白名单标签（配置回归防御）整标签剔除；
 *    拒绝属性残留复检整标签剔除；data:image/svg+xml 等 scheme 层无法处理的载荷整标签剔除。
 */
import sanitizeHtml from "sanitize-html";

import {
  ALLOWED_HTML_ATTRS,
  ALLOWED_HTML_TAGS,
  isAllowedImageSrc,
  isAllowedLinkProtocol,
  isDeniedHtmlAttr,
} from "./html-whitelist";

export const HTML_WHITELIST_VERSION = "m4-d5-v1";

const UNSUPPORTED_HTML_BLOCK_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "form",
  "fieldset",
  "legend",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "datalist",
  "output",
]);

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_HTML_TAGS],
  allowedAttributes: ALLOWED_HTML_ATTRS as unknown as Record<string, string[]>,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "asset", "data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  exclusiveFilter: (frame) => {
    // 兜底：白名单标签未登记 allowedAttributes（配置回归）→ fail-closed 整标签剔除
    if (!(frame.tag in ALLOWED_HTML_ATTRS)) return true;
    // 防御性复检（已登记标签在过滤后不应残留拒绝属性/危险 scheme；data-svg 类由 scheme 过滤管不到）
    for (const key of Object.keys(frame.attribs ?? {})) {
      if (isDeniedHtmlAttr(key)) return true;
      if (key === "href" && !isAllowedLinkProtocol(frame.attribs[key])) return true;
      if (key === "src" && !isAllowedImageSrc(frame.attribs[key])) return true;
    }
    return false;
  },
};

export interface SanitizedHtmlBlock {
  readonly html: string;
  readonly hasUnsupportedBlockTag: boolean;
}

/** 清洗 HTML 块源码 → 安全字符串；调用方以 isEmptySanitizedHtml 判定空结果（→ 占位） */
export function sanitizeHtmlBlock(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * 清洗并保留结构性降级元数据。table/form 系标签即使被 sanitize 丢弃，
 * 也不能把剩余文本拼成看似完整的 HTML widget，因此整块降级占位。
 */
export function sanitizeHtmlBlockDetailed(html: string): SanitizedHtmlBlock {
  let hasUnsupportedBlockTag = false;
  const sanitized = sanitizeHtml(html, {
    ...SANITIZE_OPTIONS,
    onOpenTag: (tagName) => {
      if (UNSUPPORTED_HTML_BLOCK_TAGS.has(tagName)) {
        hasUnsupportedBlockTag = true;
      }
    },
  });
  return Object.freeze({ html: sanitized, hasUnsupportedBlockTag });
}

/** 清洗结果为空判定（sanitize 为空 → 整块错误占位，fail-closed） */
export function isEmptySanitizedHtml(output: string): boolean {
  return output.trim().length === 0;
}
