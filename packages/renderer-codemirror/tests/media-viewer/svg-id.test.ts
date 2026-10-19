/**
 * AC10 / INV-1..INV-4 契约测试（**测试先行**）。
 *
 * 契约来源：
 * - `.omx/plans/prd-mermaid-diagram-viewer.md` §4.4.3（建映射 + 限定范围全域替换、标识符边界、豁免集）
 * - `.omx/plans/test-spec-mermaid-diagram-viewer.md` AC10（INV-1..4 + 无空格根选择器 + 值内 url + 最长键优先）
 *
 * 本文件在只读审计后发现并补齐的覆盖（见提交说明）：
 * - 文本节点内容 **恰好等于某个已声明 id**（否则 INV-4 是空断言）；
 * - `<style>` **值内** `url(...)`（此前只覆盖了选择器形态）；
 * - INV-1 的 `aria-*` 多 token 与 `getElementById('X')` 两族目标存在性；
 * - `prefix` 末位非标识符字符（如 `p.`）时的防重复加前缀；
 * - 属性值内含 `>` 时的引号感知切分；`<style>` 体定位不再依赖"首次出现"字符串替换；
 * - 与 id 同名的类名会被一并改写——把该行为固化为**契约**（已知代价，出现撞名必须显式评估）。
 */
import { describe, expect, it } from "vitest";
import {
  collectSvgIds,
  findDanglingReferences,
  findLeakedIdTokens,
  rewriteSvgIds,
} from "../../src/media-viewer/svg-id.ts";

const PREFIX = "mv1-";

/**
 * mermaid@11.17.2 实测产出的引用形态集合（非臆造）：
 * - `#<svgId>{…}` 无空格根选择器（compileCSS exact-namespace 特例）；
 * - `url(#X)`（marker / clip-path / filter / pattern / fill / stroke）；
 * - `url(X)` 裸形态（来自可配置的 dropShadow/gradient 变量值，安装版默认经 `svgId` 带 `#`）；
 * - `style` 属性值与 **`<style>` 块值内**的 `url(...)`；
 * - `href` / `xlink:href="#X"`；`aria-labelledby` / `aria-describedby` 多 token；
 * - `onclick` 内嵌 `getElementById('X')`；
 * - 与 id 同名的文本节点内容（不得被改写）。
 */
const MERMAID_LIKE_SVG = [
  '<svg id="mermaid-1" aria-labelledby="chart-title-mermaid-1"',
  // 多 token aria（AC10 fixture 第 7 条要求）：两个 token 都必须被改写
  ' aria-describedby="chart-desc-mermaid-1 chart-title-mermaid-1" width="200" height="100">',
  "<style>#mermaid-1{font-family:sans-serif;font-size:16px;fill:#333}",
  "#mermaid-1 .node rect{fill:#fff}</style>",
  // 值内 url（选择器之外的第二种 style 形态）
  "<style>#mermaid-1 .edge{stroke:url(#drop-shadow);stroke-width:1;fill:url(mermaid-1-gradient)}</style>",
  '<title id="chart-title-mermaid-1">Title</title>',
  '<desc id="chart-desc-mermaid-1">Desc</desc>',
  "<defs>",
  '<marker id="arrowhead-abc" markerWidth="12"><path d="M0,0"/></marker>',
  '<clipPath id="clip-xyz"><rect width="10" height="10"/></clipPath>',
  '<filter id="drop-shadow"><feDropShadow/></filter>',
  '<pattern id="pat-1"><rect width="4" height="4"/></pattern>',
  // 裸 url 形态的被引用者：其目标是**真实声明**的带后缀 id，而非 <svgId> 前缀片段
  '<linearGradient id="mermaid-1-gradient"><stop offset="0"/></linearGradient>',
  "</defs>",
  '<g clip-path="url(#clip-xyz)" filter="url(#drop-shadow)">',
  '<rect class="node" fill="url(#pat-1)"',
  ' style="filter:url(#drop-shadow);stroke:url(mermaid-1-gradient)"/>',
  '<path marker-end="url(#arrowhead-abc)" d="M0,0"/>',
  '<use xlink:href="#arrowhead-abc"/>',
  `<a href="#clip-xyz" onclick="document.getElementById('chart-title-mermaid-1').focus()">link</a>`,
  // INV-4：文本内容**恰好等于**一个已声明 id（带 id 与不带 id 两种都要保留原样）
  '<text id="t-1">mermaid-1</text>',
  "<text>mermaid-1</text>",
  "<text>actor0_popup actor0</text>",
  "</g>",
  "</svg>",
].join("");

/** `actor0` ⊂ `actor0_popup`：同一份 SVG 内同时存在短键与长键，必须最长键优先。 */
const SHORT_AND_LONG_IDS_SVG =
  '<svg id="actor0_popup"><style>#actor0{fill:red}</style>' +
  '<text id="actor0">A</text>' +
  `<a onclick="document.getElementById('actor0').focus()">x</a></svg>`;

describe("collectSvgIds", () => {
  it("收集全部 id 声明（含 style/title/defs/文本元素）", () => {
    const ids = collectSvgIds(MERMAID_LIKE_SVG);
    for (const expected of [
      "mermaid-1",
      "chart-title-mermaid-1",
      "chart-desc-mermaid-1",
      "arrowhead-abc",
      "clip-xyz",
      "drop-shadow",
      "pat-1",
      "mermaid-1-gradient",
      "t-1",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("注释里的 id= 不产生幽灵键", () => {
    expect(collectSvgIds('<!-- id="ghost" --><svg id="real"/>')).toEqual(["real"]);
  });

  it("无 id 时返回空数组", () => {
    expect(collectSvgIds("<svg><g/></svg>")).toEqual([]);
  });
});

describe("rewriteSvgIds", () => {
  const originalIds = collectSvgIds(MERMAID_LIKE_SVG);
  const { svg: rewritten, idMap } = rewriteSvgIds(MERMAID_LIKE_SVG, PREFIX);

  it("所有 id 声明加前缀，且映射与声明一一对应", () => {
    for (const id of originalIds) {
      expect(idMap.get(id)).toBe(`${PREFIX}${id}`);
      expect(rewritten).toContain(`id="${PREFIX}${id}"`);
    }
    expect(rewritten).not.toContain('id="mermaid-1"');
  });

  it("无空格根选择器 #<svgId>{…} 被改写", () => {
    expect(rewritten).toContain("#mv1-mermaid-1{font-family:sans-serif");
    expect(rewritten).not.toContain("#mermaid-1{");
  });

  it("后代选择器 #X .node 被改写", () => {
    expect(rewritten).toContain("#mv1-mermaid-1 .node rect");
  });

  it("`<style>` **值内**的 url(#X) 与裸 url(X) 被改写", () => {
    expect(rewritten).toContain("stroke:url(#mv1-drop-shadow)");
    expect(rewritten).toContain("fill:url(mv1-mermaid-1-gradient)");
  });

  it("url(#X) 全属性改写（clip-path / filter / marker-end / fill）", () => {
    expect(rewritten).toContain('clip-path="url(#mv1-clip-xyz)"');
    expect(rewritten).toContain('filter="url(#mv1-drop-shadow)"');
    expect(rewritten).toContain('marker-end="url(#mv1-arrowhead-abc)"');
    expect(rewritten).toContain('fill="url(#mv1-pat-1)"');
  });

  it("style 属性值内的 url 被改写（含裸形态）", () => {
    expect(rewritten).toContain("filter:url(#mv1-drop-shadow)");
    expect(rewritten).toContain("stroke:url(mv1-mermaid-1-gradient)");
  });

  it("href / xlink:href 被改写", () => {
    expect(rewritten).toContain('xlink:href="#mv1-arrowhead-abc"');
    expect(rewritten).toContain('href="#mv1-clip-xyz"');
  });

  it("aria-labelledby / aria-describedby 的**多 token** 均被改写", () => {
    expect(rewritten).toContain('aria-labelledby="mv1-chart-title-mermaid-1"');
    expect(rewritten).toContain(
      'aria-describedby="mv1-chart-desc-mermaid-1 mv1-chart-title-mermaid-1"',
    );
  });

  it("onclick 内嵌的 getElementById('X') 被改写", () => {
    expect(rewritten).toContain("getElementById('mv1-chart-title-mermaid-1')");
  });

  it("INV-4：文本节点内容原样保留（含内容恰好等于某 id、且**不带 id 属性**的情形）", () => {
    expect(rewritten).toContain('<text id="mv1-t-1">mermaid-1</text>');
    expect(rewritten).toContain("<text>mermaid-1</text>");
    expect(rewritten).toContain("<text>actor0_popup actor0</text>");
  });

  it("最长键优先：actor0 与 actor0_popup 共存时各自只加一次前缀", () => {
    const { svg } = rewriteSvgIds(SHORT_AND_LONG_IDS_SVG, PREFIX);
    expect(svg).toContain('id="mv1-actor0_popup"');
    expect(svg).toContain('id="mv1-actor0"');
    expect(svg).toContain("#mv1-actor0{fill:red}");
    expect(svg).not.toContain("#mv1-mv1-");
    expect(svg).toContain("getElementById('mv1-actor0')");
  });

  it("前缀末位非标识符字符时不重复加前缀（prefix 契约）", () => {
    const { svg } = rewriteSvgIds(SHORT_AND_LONG_IDS_SVG, "p.");
    expect(svg).toContain('id="p.actor0_popup"');
    expect(svg).toContain("#p.actor0{fill:red}");
    expect(svg).not.toContain("p.p.");
    expect(findLeakedIdTokens(svg, collectSvgIds(SHORT_AND_LONG_IDS_SVG), "p.")).toEqual([]);
  });

  it("单遍替换：`. ` 前置的重叠 id 不会被跨键自我吞噬（F4 原缺陷形态）", () => {
    const svg = '<svg id="x.a"><rect id="a"/><style>#x.a{fill:red}#a{fill:blue}</style></svg>';
    const { svg: out } = rewriteSvgIds(svg, "p.");
    expect(out).toContain('id="p.x.a"');
    expect(out).toContain('id="p.a"');
    expect(out).toContain("#p.x.a{fill:red}");
    expect(out).toContain("#p.a{fill:blue}");
    expect(out).not.toContain("p.x.p.a");
  });

  it("异常输入降级：未闭合的 `<` 与自闭合 `<style/>` 均不参与改写", () => {
    const unterminated = '<svg id="a"><rect fill="url(#a)';
    expect(rewriteSvgIds(unterminated, PREFIX).svg).toBe('<svg id="mv1-a"><rect fill="url(#a)');
    const selfClosingStyle = '<svg id="a"><style/><text>a</text></svg>';
    expect(rewriteSvgIds(selfClosingStyle, PREFIX).svg).toBe(
      '<svg id="mv1-a"><style/><text>a</text></svg>',
    );
  });

  it("豁免属性（data-* / name / class / role / aria-label）不被改写", () => {
    const svg =
      '<svg id="n1"><rect data-id="n1" name="n1" class="n1" role="n1" aria-label="n1" fill="url(#n1)"/></svg>';
    const { svg: out } = rewriteSvgIds(svg, PREFIX);
    expect(out).toContain('data-id="n1"');
    expect(out).toContain('name="n1"');
    expect(out).toContain('class="n1"');
    expect(out).toContain('role="n1"');
    expect(out).toContain('aria-label="n1"');
    expect(out).toContain('fill="url(#mv1-n1)"');
  });

  it("属性值内含 > 时标签不被截断（引号感知切分）", () => {
    const svg = `<svg id="n1"><g data-id="a > b" onclick="document.getElementById('n1').focus()"/></svg>`;
    const { svg: out } = rewriteSvgIds(svg, PREFIX);
    expect(out).toContain('data-id="a > b"');
    expect(out).toContain("getElementById('mv1-n1')");
  });

  it("`<style>` 体定位不依赖字符串首次出现（开标签不被破坏）", () => {
    const svg = '<svg id="le"><style>le></style></svg>';
    expect(rewriteSvgIds(svg, PREFIX).svg).toBe('<svg id="mv1-le"><style>mv1-le></style></svg>');
  });

  it("与 id 同名的类名会被一并改写（已知代价，固化为契约）", () => {
    const svg = '<svg id="node"><style>.node{fill:red}</style></svg>';
    expect(rewriteSvgIds(svg, PREFIX).svg).toContain(".mv1-node{fill:red}");
  });

  it("负例：无 id / 空串 / 畸形输入不抛异常且不破坏输入", () => {
    const noId = "<svg><g/></svg>";
    expect(rewriteSvgIds(noId, PREFIX).svg).toBe(noId);
    expect(rewriteSvgIds("", PREFIX).svg).toBe("");
    const malformed = '<svg id="a"><rect fill="url(#a)';
    expect(() => rewriteSvgIds(malformed, PREFIX)).not.toThrow();
  });

  it("幂等性：对已改写结果再次改写只叠加前缀（不产生重复替换）", () => {
    const once = rewriteSvgIds(SHORT_AND_LONG_IDS_SVG, PREFIX).svg;
    const twice = rewriteSvgIds(once, "x-").svg;
    expect(twice).toContain('id="x-mv1-actor0_popup"');
    expect(twice).not.toContain("x-x-");
  });
});

describe("INV-1 浮层内引用可解析", () => {
  it("改写后不存在悬空引用（url / href / aria token / getElementById 四族）", () => {
    const { svg } = rewriteSvgIds(MERMAID_LIKE_SVG, PREFIX);
    expect(findDanglingReferences(svg)).toEqual([]);
  });

  it("能发现 url(#X) / href 悬空引用（证明断言有判别力）", () => {
    expect(findDanglingReferences('<svg id="a"><rect clip-path="url(#nope)"/></svg>')).toEqual([
      "nope",
    ]);
    expect(findDanglingReferences('<svg id="a"><use href="#nope"/></svg>')).toEqual(["nope"]);
  });

  it("能发现 aria-* 多 token 与 getElementById 悬空引用", () => {
    expect(findDanglingReferences('<svg id="a"><g aria-labelledby="a missing-1"/></svg>')).toEqual([
      "missing-1",
    ]);
    expect(
      findDanglingReferences(
        `<svg id="a" aria-labelledby="a"><g onclick="document.getElementById('missing-2').focus()"/></svg>`,
      ),
    ).toEqual(["missing-2"]);
  });

  it("能发现裸 url(X) 悬空引用", () => {
    expect(findDanglingReferences('<svg id="a"><rect style="fill:url(nope-1)"/></svg>')).toEqual([
      "nope-1",
    ]);
  });

  it("能识别 c4 形态 url(<base-url>#X)（真实 mermaid 产出）", () => {
    expect(
      findDanglingReferences('<svg id="a"><rect marker-end="url(https://x/y#a-arrowhead)"/></svg>'),
    ).toEqual(["a-arrowhead"]);
    expect(
      findDanglingReferences(
        '<svg id="a-arrowhead"><rect marker-end="url(https://x/y#a-arrowhead)"/></svg>',
      ),
    ).toEqual([]);
  });

  it("非 id 形的 url 目标不误报（外链 / 图片）", () => {
    expect(
      findDanglingReferences(
        '<svg id="a"><rect style="background-image:url(https://x/a.png);mask:url(icons.svg)"/></svg>',
      ),
    ).toEqual([]);
  });
});

describe("INV-2 / INV-3 与正文隔离", () => {
  it("INV-2：改写结果的 id 集合与正文 id 集合无交集", () => {
    const originalIds = collectSvgIds(MERMAID_LIKE_SVG);
    const { svg } = rewriteSvgIds(MERMAID_LIKE_SVG, PREFIX);
    const overlayIds = collectSvgIds(svg);
    expect(overlayIds.some((id) => originalIds.includes(id))).toBe(false);
  });

  it("INV-3：不残留正文 id 标识符 token（标识符边界定义，PREFIX+X 不算残留）", () => {
    const originalIds = collectSvgIds(SHORT_AND_LONG_IDS_SVG);
    const { svg } = rewriteSvgIds(SHORT_AND_LONG_IDS_SVG, PREFIX);
    expect(findLeakedIdTokens(svg, originalIds)).toEqual([]);
  });

  it("INV-3 判别力：真实残留会被抓出（无空格选择器 / 裸 url / aria token）", () => {
    expect(findLeakedIdTokens("<style>#base-1{fill:red}</style>", ["base-1"])).toEqual(["base-1"]);
    expect(
      findLeakedIdTokens("<style>stroke:url(base-1-gradient)</style>", ["base-1-gradient"]),
    ).toEqual(["base-1-gradient"]);
    expect(findLeakedIdTokens('<g aria-labelledby="base-1 other"/>', ["base-1"])).toEqual([
      "base-1",
    ]);
  });

  it("INV-3 判别力：豁免属性与文本节点内的同名字符串不误报", () => {
    expect(
      findLeakedIdTokens(
        '<rect data-id="base-1" name="base-1" class="base-1" aria-label="base-1"/>',
        ["base-1"],
      ),
    ).toEqual([]);
    expect(findLeakedIdTokens("<text>base-1</text>", ["base-1"])).toEqual([]);
  });
});
