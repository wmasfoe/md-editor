/**
 * U-SANITIZE（test-spec-g003-html-mdx.md §4）：白名单常量精确匹配 D5 清单、
 * 双轨拒绝语义、攻击向量表 #1-17 字符串层清洗、空判定、协议纯函数。
 * Node 无 DOM 直接运行（C7 验证点：无 jsdom，import 即用）。
 */
import { describe, expect, it } from "vitest";

import {
  ALLOWED_HTML_ATTRS,
  ALLOWED_HTML_TAGS,
  ALLOWED_IMAGE_PROTOCOLS,
  ALLOWED_LINK_PROTOCOLS,
  DENIED_HTML_ATTRS,
  DENIED_HTML_ATTR_PREFIXES,
  isAllowedDataImage,
  isAllowedImageSrc,
  isAllowedLinkProtocol,
  isDeniedHtmlAttr,
} from "../../src/markdown/html-whitelist";
import { isEmptySanitizedHtml, sanitizeHtmlBlock } from "../../src/markdown/html-sanitize";

describe("U-SANITIZE 白名单常量精确匹配 D5 清单", () => {
  it("tags 清单与 D5 逐项一致", () => {
    expect([...ALLOWED_HTML_TAGS]).toEqual([
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
    ]);
    // 明确不含块级结构/危险标签
    const denied = [
      "table",
      "tr",
      "td",
      "form",
      "iframe",
      "object",
      "embed",
      "script",
      "style",
      "link",
      "meta",
      "svg",
      "math",
      "input",
      "button",
      "xmp",
    ];
    for (const tag of denied) expect(ALLOWED_HTML_TAGS).not.toContain(tag);
  });

  it("attrs 不变量：每个白名单标签都登记了 allowedAttributes（防止 sanitize-html 放行全部属性）", () => {
    expect(Object.keys(ALLOWED_HTML_ATTRS)).toHaveLength(ALLOWED_HTML_TAGS.length);
    for (const tag of ALLOWED_HTML_TAGS) {
      expect(Object.prototype.hasOwnProperty.call(ALLOWED_HTML_ATTRS, tag)).toBe(true);
    }
  });

  it("a/img 属性白名单与 D5 一致，其余标签仅 title", () => {
    expect(ALLOWED_HTML_ATTRS.a).toEqual(["href", "title"]);
    expect(ALLOWED_HTML_ATTRS.img).toEqual(["src", "alt", "title"]);
    for (const [tag, attrs] of Object.entries(ALLOWED_HTML_ATTRS)) {
      if (tag === "a" || tag === "img") continue;
      expect(attrs, `${tag} 应仅登记 title`).toEqual(["title"]);
    }
  });

  it("拒绝属性清单与 D5 一致", () => {
    expect([...DENIED_HTML_ATTRS]).toEqual(["class", "id", "style", "srcdoc", "width", "height"]);
    expect([...DENIED_HTML_ATTR_PREFIXES]).toEqual(["data-", "on"]);
  });

  it("协议白名单与 D5 一致", () => {
    expect([...ALLOWED_LINK_PROTOCOLS]).toEqual(["http", "https", "mailto"]);
    expect([...ALLOWED_IMAGE_PROTOCOLS]).toEqual(["http", "https", "asset"]);
  });
});

describe("U-SANITIZE 协议判定纯函数", () => {
  it("链接协议：http/https/mailto 与无 scheme 相对值放行", () => {
    for (const v of [
      "http://a.b",
      "https://a.b",
      "mailto:x@y.z",
      "HTTP://A.B",
      "hTtPs://a.b",
      "/path/x",
      "#anchor",
      "//a.b",
      "x.png",
    ]) {
      expect(isAllowedLinkProtocol(v)).toBe(true);
    }
  });
  it("链接协议：javascript:/data:/file: 等危险 scheme 拒绝", () => {
    for (const v of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "vbscript:x",
    ]) {
      expect(isAllowedLinkProtocol(v)).toBe(false);
    }
  });
  it("图片 src：http/https/asset、无 scheme 相对值与 data:image 非 svg 放行", () => {
    for (const v of [
      "http://a/b.png",
      "https://a/b.png",
      "asset://localhost/x.png",
      "x.png",
      "data:image/png;base64,AAA",
      "DATA:IMAGE/JPEG;base64,AAA",
    ]) {
      expect(isAllowedImageSrc(v)).toBe(true);
    }
  });
  it("图片 src：data:image/svg 类与危险协议拒绝", () => {
    for (const v of [
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/svg;base64,AAA",
      "data:text/html,x",
      "javascript:alert(1)",
      "file:///x.png",
    ]) {
      expect(isAllowedImageSrc(v)).toBe(false);
    }
  });
  it("isAllowedDataImage：非 svg 的 data:image/* 放行，svg/xml 与 text/html 拒绝", () => {
    expect(isAllowedDataImage("data:image/png;base64,AAA")).toBe(true);
    expect(isAllowedDataImage("data:image/gif;base64,AAA")).toBe(true);
    expect(isAllowedDataImage("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isAllowedDataImage("data:image/svg;base64,AAA")).toBe(false);
    expect(isAllowedDataImage("data:text/html,<b>x</b>")).toBe(false);
  });
  it("isDeniedHtmlAttr：拒绝清单与前缀", () => {
    for (const a of [
      "class",
      "id",
      "style",
      "srcdoc",
      "width",
      "height",
      "data-x",
      "data-set",
      "onclick",
      "onerror",
    ]) {
      expect(isDeniedHtmlAttr(a)).toBe(true);
    }
    for (const a of ["src", "href", "alt", "title", "hero", "dataFoo"]) {
      expect(isDeniedHtmlAttr(a)).toBe(false);
    }
  });
});

/**
 * 存活标签与真实属性提取（sanitize 输出为规范化格式：小写标签、双引号属性）。
 * 用于对 mXSS 类向量的"存活节点无危险属性"断言——实体转义文本可能含 "onerror" 字样，
 * 全文正则会产生误报，必须按真实属性断言。
 */
function liveTagsAndAttrs(html: string): Array<{ tag: string; attrs: Record<string, string> }> {
  const nodes: Array<{ tag: string; attrs: Record<string, string> }> = [];
  const tagRe = /<([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)\s*\/?>/gi;
  for (const m of html.matchAll(tagRe)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[2] ?? "").matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/gi)) {
      attrs[a[1]] = a[2];
    }
    nodes.push({ tag: m[1], attrs });
  }
  return nodes;
}

/** 存活节点无任何危险属性（on* 前缀/style/srcdoc） */
function expectNoLiveHandlerAttrs(html: string): void {
  for (const node of liveTagsAndAttrs(html)) {
    for (const key of Object.keys(node.attrs)) {
      expect(
        key.startsWith("on") || key === "style" || key === "srcdoc",
        `${node.tag}[${key}]`,
      ).toBe(false);
    }
  }
}

describe("U-SANITIZE 双轨拒绝语义", () => {
  it("① 属性级剥离：已登记标签拒绝属性移除、标签保留", () => {
    expect(sanitizeHtmlBlock('<img src="x.png" onerror="alert(1)">')).toBe('<img src="x.png" />');
    expect(sanitizeHtmlBlock('<div style="background:url(javascript:alert(1))">t</div>')).toBe(
      "<div>t</div>",
    );
    expect(sanitizeHtmlBlock('<p class="hero" title="t">t</p>')).toBe('<p title="t">t</p>');
  });
  it("② 整标签剔除：data:image/svg+xml src 由 exclusiveFilter 兜底剔除", () => {
    const out = sanitizeHtmlBlock('<img src="data:image/svg+xml,<svg onload=alert(1)>">');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/svg/i);
  });
  it("② 兜底不变量：白名单标签缺失 allowedAttributes 登记会 fail-closed（由常量不变量测试锁定）", () => {
    // 行为由 html-whitelist.test 的不变量 + exclusiveFilter 的登记检查双保险；
    // 此处断言登记集合与白名单一致（配置回归防御的直接证据）
    expect(Object.keys(ALLOWED_HTML_ATTRS)).toHaveLength(ALLOWED_HTML_TAGS.length);
    for (const tag of ALLOWED_HTML_TAGS) {
      expect(Object.prototype.hasOwnProperty.call(ALLOWED_HTML_ATTRS, tag)).toBe(true);
    }
  });
});

describe("U-SANITIZE 攻击向量表 #1-17（字符串层）", () => {
  it("#1 script 块 → 空（→ 占位）", () => {
    const out = sanitizeHtmlBlock("<script>alert(1)</script>");
    expect(isEmptySanitizedHtml(out)).toBe(true);
  });
  it("#2 img onerror → src 保留、onerror 移除", () => {
    const out = sanitizeHtmlBlock('<img src="x" onerror="alert(1)">');
    expect(out).toBe('<img src="x" />');
    expect(out).not.toMatch(/onerror/i);
  });
  it("#3 javascript: href → 链接文本保留、href 移除", () => {
    const out = sanitizeHtmlBlock('<a href="javascript:alert(1)">x</a>');
    expect(out).toBe("<a>x</a>");
    expect(out).not.toMatch(/href/i);
  });
  it("#4 iframe srcdoc → 空", () => {
    const out = sanitizeHtmlBlock('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
    expect(isEmptySanitizedHtml(out)).toBe(true);
  });
  it("#5 object/embed → 移除", () => {
    expect(
      isEmptySanitizedHtml(sanitizeHtmlBlock('<object data="data:text/html,x"></object>')),
    ).toBe(true);
    expect(isEmptySanitizedHtml(sanitizeHtmlBlock('<embed src="x.swf">'))).toBe(true);
  });
  it("#6 div style → style 移除、div 保留", () => {
    const out = sanitizeHtmlBlock('<div style="background:url(javascript:alert(1))">t</div>');
    expect(out).toBe("<div>t</div>");
  });
  it("#7 svg onload → 节点移除", () => {
    const out = sanitizeHtmlBlock('<svg onload="alert(1)">x</svg>');
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/onload/i);
  });
  it("#8 mXSS math/mtext 载荷 → 存活节点无危险属性/危险标签", () => {
    const out = sanitizeHtmlBlock(
      '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/<math/i);
    expect(out).not.toMatch(/<table/i);
    expectNoLiveHandlerAttrs(out);
    // 幸存 img 的 title 是实体转义文本（无实义 onerror 属性），渲染层 textContent/setAttribute 下为惰性字符串
    expect(out).toBe('<img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;" />');
  });
  it("#9 嵌套 svg 重入 → 存活节点无危险属性/危险标签", () => {
    const out = sanitizeHtmlBlock("<svg><p><style><img src=x onerror=alert(1)></style></p></svg>");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<svg/i);
    expectNoLiveHandlerAttrs(out);
  });
  it("#10 data:image/svg+xml src → 整标签移除（exclusiveFilter 兜底）", () => {
    const out = sanitizeHtmlBlock('<img src="data:image/svg+xml,<svg onload=alert(1)>">');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/svg/i);
    expect(out).not.toMatch(/onload/i);
  });
  it("#11 file:// href → href 移除", () => {
    const out = sanitizeHtmlBlock('<a href="file:///etc/passwd">x</a>');
    expect(out).toBe("<a>x</a>");
  });
  it("#12 form/input → 移除", () => {
    expect(
      isEmptySanitizedHtml(
        sanitizeHtmlBlock('<form action="https://evil"><input autofocus></form>'),
      ),
    ).toBe(true);
  });
  it("#13 meta refresh → 移除", () => {
    expect(
      isEmptySanitizedHtml(
        sanitizeHtmlBlock('<meta http-equiv="refresh" content="0;url=https://evil">'),
      ),
    ).toBe(true);
  });
  it("#14 link stylesheet → 移除", () => {
    expect(
      isEmptySanitizedHtml(sanitizeHtmlBlock('<link rel="stylesheet" href="https://evil/x.css">')),
    ).toBe(true);
  });
  it("#15 未知标签 + on* 属性 → 移除", () => {
    const out = sanitizeHtmlBlock('<xss onmouseover="alert(1)">t</xss>');
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toBe("t");
  });
  it("#16 实体混淆 javascript: href → 解码后仍拒绝", () => {
    const out = sanitizeHtmlBlock('<a href="&#106;&#97;vascript:alert(1)">x</a>');
    expect(out).toBe("<a>x</a>");
    expect(out).not.toMatch(/href/i);
  });
  it("#17 xmp raw-text 走私（CVE-2026-44990 类）→ 字符串层无 script 残留", () => {
    const out = sanitizeHtmlBlock("<div><xmp><script>alert(1)</script></xmp></div>");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<xmp/i);
    // 渲染层 textContent 兜底由 L3 断言（widget 层禁 innerHTML）
  });
  it("向量清洗后全局无危险属性残留", () => {
    const out = sanitizeHtmlBlock(
      '<div><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>' +
        '<script>alert(1)</script><iframe srcdoc="x"></iframe></div>',
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expectNoLiveHandlerAttrs(out);
  });
});

describe("U-SANITIZE 空判定", () => {
  it("空结果判定", () => {
    expect(isEmptySanitizedHtml("")).toBe(true);
    expect(isEmptySanitizedHtml("   \n ")).toBe(true);
    expect(isEmptySanitizedHtml("<p>t</p>")).toBe(false);
  });
});
