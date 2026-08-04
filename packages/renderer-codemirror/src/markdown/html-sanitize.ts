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

/** 清洗 HTML 块源码 → 安全字符串；调用方以 isEmptySanitizedHtml 判定空结果（→ 占位） */
export function sanitizeHtmlBlock(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** 清洗结果为空判定（sanitize 为空 → 整块错误占位，fail-closed） */
export function isEmptySanitizedHtml(output: string): boolean {
  return output.trim().length === 0;
}
