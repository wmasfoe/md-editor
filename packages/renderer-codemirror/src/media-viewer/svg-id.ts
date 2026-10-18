/**
 * @file svg-id.ts
 * @description Mermaid SVG 的 id 隔离纯字符串改写器（AC10 / INV-1..INV-4 的唯一实现点）。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §4.4.3 与
 * `.omx/plans/test-spec-mermaid-diagram-viewer.md` AC10。
 *
 * 为什么是「建映射 + 限定范围全域替换」而不是「枚举引用语法」：
 * mermaid@11.17.2 的引用面是多维的（`url(#X)`、内联 `<style>` 里的 `#X{…}` 无空格根选择器、
 * `style` 值内 `url(...)`、`aria-labelledby/describedby` token、`onclick` 内嵌
 * `getElementById('X')`），任何枚举清单都必然漏项；而漏项会让浮层的 `<style>`（文档级作用域）
 * 泄漏回正文 SVG 并丢失字体/填充，测试却仍全绿。因此改为：先全量收集 id 声明建立
 * `X → PREFIX+X` 映射，再在**限定域**（属性值 + `<style>` 文本）内按**标识符边界**全量替换。
 *
 * 为什么必须 node 可测的纯字符串实现（而不是 DOMParser）：
 * `vitest.config.ts` 的 environment 是 `node`，仓库无 jsdom/happy-dom ⇒ `DOMParser` 不存在，
 * 若依赖它则 AC10 的「测试先行」无法落地。
 *
 * 已登记的前置条件与已知限制（审计轮次确认）：
 * 1. 词法层用**引号感知的线性扫描**切分（tag / style 文本 / 注释 / 文本），因此属性值内的
 *    `>`（mermaid 会把用户文本序列化成 `&gt;`）不会截断标签——若将来出现**未转义的** `<`/`>`
 *    或 CDATA/`<script>` 内容，本模块会静默漏改；mermaid 的发射路径当前不产出这些形态，
 *    若要支持需把扫描器扩展为完整 XML 状态机。
 * 2. `prefix` 建议以标识符字符（`[-A-Za-z0-9_]`）结尾；实现已对"前缀被再次加前缀"做防护，
 *    但 INV-3 的判别依赖该约定（见 `findLeakedIdTokens` 的 `prefix` 参数）。
 * 3. 与已声明 id **同名的类名/关键帧名**（例如 `.node` 与 `id="node"`）在 `<style>` 文本内会被
 *    一并改写——这是「全域替换」的已知代价；`class` 属性本身属豁免集（属性值不变、选择器被改，
 *    撞名时样式会静默失配）。mermaid 当前发射路径未出现该撞名；已在测试中把该行为固定为契约，
 *    并在 PRD §4.4.3 登记——出现撞名必须显式评估，不要靠猜。
 * 4. 畸形输入降级：未闭合的 `<`、自闭合/未闭合的 `<style>`、以及 `<style>` 体内出现 `</style`
 *    （例如 CSS 注释里）时，相关区域一律降级为正文 ⇒ **不参与改写也不参与扫描**。mermaid 的
 *    输出经 DOM 序列化，不会有这些形态。
 * 5. `id` 值带首尾空白时不 trim（DOM 序列化不会产出）——登记为已知无害限制。
 */

/** 标识符字符集：`-` 必须计入，否则 `PREFIX+X` 会把旧 id 误判为残留（假红）。 */
const IDENT_CHAR = /[-A-Za-z0-9_]/;
/** 属性：名称 / `=` 及其空白 / 引号 / 值（惰性 + 反向引用保证引号配对）。 */
const ATTRIBUTE_PATTERN = /([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*)(["'])([\s\S]*?)\3/g;
/**
 * `url(...#X)` 与裸 `url(X)`。
 * 第一支允许 `#` 前存在任意前缀：c4Diagram 会产出 `url(<base-url>#<diagramId>-arrowhead)`，
 * 只能在 `#` 之后取 id；第二支是**无 `#`** 的裸形态（来自可配置的 dropShadow/gradient 值）。
 */
const URL_REFERENCE_PATTERN =
  /url\(\s*["']?[^)"']*#([^)"'\s]+)["']?\s*\)|url\(\s*["']?([^)"'#\s]+)["']?\s*\)/g;
/** JS 串内的 id 引用：`getElementById('X')` / `getElementById("X")`。 */
const GET_ELEMENT_BY_ID_PATTERN = /getElementById\(\s*(["'])([^"']+)\1\s*\)/g;
/** aria 引用：空格分隔 token 列表。 */
const ARIA_REFERENCE_ATTRIBUTES = new Set(["aria-labelledby", "aria-describedby"]);

/**
 * 非引用承载属性（显式豁免集，**枚举完毕、无「等」尾**）。
 *
 * 依据 PRD §4.4.3 步骤 3：这些属性的值可能恰好等于某个 id（例如 `data-id="node1"`），
 * 但它们不承载引用，既不该被改写，也不该被 INV-3 扫描（否则正确实现会被判红）。
 */
function isExemptAttribute(name: string): boolean {
  return (
    name.startsWith("data-") ||
    name === "name" ||
    name === "class" ||
    name === "role" ||
    name === "aria-label"
  );
}

/** 转义正则元字符（id 可能含 `.`/`:`/`-` 等）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 按最长键优先排序（`actor0` ⊂ `actor0_popup`；朴素逐键替换会重复加前缀）。 */
function sortKeysLongestFirst(keys: readonly string[]): readonly string[] {
  return keys.toSorted((a, b) =>
    b.length - a.length !== 0 ? b.length - a.length : a < b ? -1 : 1,
  );
}

interface SvgRegion {
  readonly kind: "tag" | "text" | "style-text" | "comment";
  readonly start: number;
  readonly end: number;
}

/** 找到标签结束的 `>`（**引号感知**：属性值内的 `>` 不会截断标签）。 */
function findTagEnd(svg: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < svg.length; index += 1) {
    const char = svg[index];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}

/**
 * 线性切分 SVG 为区域：标签 / `<style>` 文本 / 注释 / 正文文本。
 * 注释既不改写也不扫描（否则 `<!-- id="X" -->` 会造出永不匹配的"幽灵键"）。
 * 畸形输入（未闭合的 `<`、自闭合/未闭合的 `<style>`）一律**降级为正文**——宁可不改，不静默改坏。
 */
function parseSvgRegions(svg: string): readonly SvgRegion[] {
  const regions: SvgRegion[] = [];
  let index = 0;
  while (index < svg.length) {
    const nextTag = svg.indexOf("<", index);
    if (nextTag === -1) {
      regions.push({ kind: "text", start: index, end: svg.length });
      break;
    }
    if (nextTag > index) {
      regions.push({ kind: "text", start: index, end: nextTag });
    }
    if (svg.startsWith("<!--", nextTag)) {
      const close = svg.indexOf("-->", nextTag + 4);
      const end = close === -1 ? svg.length : close + 3;
      regions.push({ kind: "comment", start: nextTag, end });
      index = end;
      continue;
    }
    const tagEnd = findTagEnd(svg, nextTag);
    if (tagEnd === -1) {
      // 未闭合的 `<`：余下内容按正文处理（不参与 id 收集、改写与扫描）
      regions.push({ kind: "text", start: nextTag, end: svg.length });
      break;
    }
    regions.push({ kind: "tag", start: nextTag, end: tagEnd });
    const tagText = svg.slice(nextTag, tagEnd);
    const isStyleOpen = /^<style\b/iu.test(tagText) && !tagText.startsWith("</");
    index = tagEnd;
    if (isStyleOpen) {
      const closeIndex = svg.toLowerCase().indexOf("</style", index);
      // 自闭合 `<style/>` 或未闭合的 `<style>`：**不**建立 style 文本区。
      // 否则余下全文（含文本节点）会被当样式改写，直接破坏 INV-4。
      const styleEnd = closeIndex === -1 ? index : closeIndex;
      if (styleEnd > index) {
        regions.push({ kind: "style-text", start: index, end: styleEnd });
      }
      index = styleEnd;
    }
  }
  return regions;
}

/** 遍历区域内的属性（供收集/改写/扫描共用）。 */
function forEachAttribute(
  svg: string,
  regions: readonly SvgRegion[],
  visit: (match: RegExpMatchArray, name: string, value: string) => void,
): void {
  for (const region of regions) {
    if (region.kind !== "tag") {
      continue;
    }
    const tagText = svg.slice(region.start, region.end);
    for (const match of tagText.matchAll(ATTRIBUTE_PATTERN)) {
      visit(match, match[1].toLowerCase(), match[4] ?? "");
    }
  }
}

/** 收集 SVG 中全部 id 声明的值（按出现顺序，去重）。 */
export function collectSvgIds(svg: string): readonly string[] {
  const ids: string[] = [];
  forEachAttribute(svg, parseSvgRegions(svg), (_match, name, value) => {
    if (name === "id" && value !== "" && !ids.includes(value)) {
      ids.push(value);
    }
  });
  return ids;
}

/**
 * 标识符边界判定：`text` 中 `[offset, offset+length)` 是否为独立 token。
 * - 两侧字符都必须 ∉ `[-A-Za-z0-9_]`；
 * - 额外防护：若紧邻其前正好是本实例前缀（`prefix` 末位不是标识符字符时才会走到这里），
 *   说明它已经是改写后的 `PREFIX+X`，不重复加前缀。
 */
function isRewritableToken(text: string, offset: number, length: number, prefix: string): boolean {
  const before = offset > 0 ? text[offset - 1] : "";
  if (before !== "" && IDENT_CHAR.test(before)) {
    return false;
  }
  if (prefix !== "" && text.slice(0, offset).endsWith(prefix)) {
    return false;
  }
  const after = offset + length < text.length ? text[offset + length] : "";
  return !(after !== "" && IDENT_CHAR.test(after));
}

/** 在给定文本内**单遍**替换所有已声明 id（单遍可结构性地排除"跨键自我吞噬"）。 */
function replaceIdTokens(text: string, keys: readonly string[], prefix: string): string {
  if (keys.length === 0) {
    return text;
  }
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "gu");
  return text.replace(pattern, (match: string, offset: number, whole: string) =>
    isRewritableToken(whole, offset, match.length, prefix) ? `${prefix}${match}` : match,
  );
}

/** 改写单个标签内的属性值；`id` 声明整体加前缀，其余属性值走 token 替换。 */
function rewriteTagAttributes(
  tag: string,
  idMap: ReadonlyMap<string, string>,
  keys: readonly string[],
  prefix: string,
): string {
  return tag.replace(
    ATTRIBUTE_PATTERN,
    (whole: string, name: string, equals: string, quote: string, value: string) => {
      const lower = name.toLowerCase();
      if (isExemptAttribute(lower)) {
        return whole;
      }
      const nextValue =
        lower === "id" ? (idMap.get(value) ?? value) : replaceIdTokens(value, keys, prefix);
      return nextValue === value ? whole : `${name}${equals}${quote}${nextValue}${quote}`;
    },
  );
}

export interface SvgIdRewriteResult {
  /** 已隔离的 SVG 字符串（**不改动正文 SVG**）。 */
  readonly svg: string;
  /** 原 id → 新 id 的映射（供调试与测试断言）。 */
  readonly idMap: ReadonlyMap<string, string>;
}

/**
 * 为浮层克隆体建立 id 隔离：所有 id 声明加前缀，并同步改写全部引用。
 * 无 id 时原样返回（含空串与畸形输入，不抛异常、不做破坏性改写）。
 */
export function rewriteSvgIds(svg: string, prefix: string): SvgIdRewriteResult {
  const ids = collectSvgIds(svg);
  const idMap = new Map<string, string>(ids.map((id) => [id, `${prefix}${id}`]));
  if (ids.length === 0) {
    return { svg, idMap };
  }
  const keys = sortKeysLongestFirst(ids);
  const regions = parseSvgRegions(svg);
  const chunks: string[] = [];
  for (const region of regions) {
    const raw = svg.slice(region.start, region.end);
    if (region.kind === "tag") {
      chunks.push(rewriteTagAttributes(raw, idMap, keys, prefix));
    } else if (region.kind === "style-text") {
      chunks.push(replaceIdTokens(raw, keys, prefix));
    } else {
      // 文本节点与注释原样保留（INV-4：绝不改写文本节点）
      chunks.push(raw);
    }
  }
  return { svg: chunks.join(""), idMap };
}

/** 收集可扫描文本域：非豁免属性值 + `<style>` 块内容（INV-1/INV-3 共用）。 */
function collectScannableTexts(svg: string, regions: readonly SvgRegion[]): readonly string[] {
  const texts: string[] = [];
  forEachAttribute(svg, regions, (_match, name, value) => {
    if (!isExemptAttribute(name)) {
      texts.push(value);
    }
  });
  for (const region of regions) {
    if (region.kind === "style-text") {
      texts.push(svg.slice(region.start, region.end));
    }
  }
  return texts;
}

/**
 * `url(...)` 的目标未必是 id（例如 `url(https://x/a.png)`）：INV-1 只关心 id 形引用，
 * 否则普通的背景图/外链 url 会被误报为悬空引用。
 */
function looksLikeIdReference(target: string): boolean {
  if (target === "" || target.includes("/")) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return false;
  }
  return !/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/iu.test(target);
}

/** 从单段文本收集 `url(...#X)` / `url(X)` 引用目标（按 id 形过滤）。 */
function collectUrlReferenceTargets(text: string, out: string[]): void {
  for (const match of text.matchAll(URL_REFERENCE_PATTERN)) {
    const target = match[1] ?? match[2] ?? "";
    if (looksLikeIdReference(target) && !out.includes(target)) {
      out.push(target);
    }
  }
}

/**
 * INV-1：返回无法在本 SVG 内解析的引用目标（空数组表示无悬空引用）。
 *
 * 覆盖族（与 test-spec AC10 的 INV-1 对齐）：`url(#X)`、`url(X)`、
 * `href`/`xlink:href="#X"`、`aria-labelledby`/`aria-describedby` 的空格分隔 token、
 * `getElementById('X')`（含 `onclick` 等属性值内的 JS 串）。
 */
export function findDanglingReferences(svg: string): readonly string[] {
  const declared = new Set(collectSvgIds(svg));
  const regions = parseSvgRegions(svg);
  const referenced: string[] = [];

  withAttributes: for (const region of regions) {
    if (region.kind !== "tag") {
      continue withAttributes;
    }
    const tagText = svg.slice(region.start, region.end);
    for (const match of tagText.matchAll(ATTRIBUTE_PATTERN)) {
      const name = match[1].toLowerCase();
      if (isExemptAttribute(name)) {
        continue;
      }
      const value = match[4] ?? "";
      if (ARIA_REFERENCE_ATTRIBUTES.has(name)) {
        for (const token of value.split(/\s+/u)) {
          if (token !== "" && !referenced.includes(token)) {
            referenced.push(token);
          }
        }
        continue;
      }
      if ((name === "href" || name === "xlink:href") && value.startsWith("#")) {
        const target = value.slice(1);
        if (target !== "" && !referenced.includes(target)) {
          referenced.push(target);
        }
        continue;
      }
      collectUrlReferenceTargets(value, referenced);
      for (const jsMatch of value.matchAll(GET_ELEMENT_BY_ID_PATTERN)) {
        const target = jsMatch[2] ?? "";
        if (target !== "" && !referenced.includes(target)) {
          referenced.push(target);
        }
      }
    }
  }
  for (const region of regions) {
    if (region.kind !== "style-text") {
      continue;
    }
    collectUrlReferenceTargets(svg.slice(region.start, region.end), referenced);
  }

  return referenced.filter((target) => !declared.has(target));
}

/**
 * INV-3：返回浮层克隆体中**残留的正文 id 标识符 token**（空数组表示隔离干净）。
 *
 * 采用标识符边界定义（两侧均 ∉ `[-A-Za-z0-9_]`），因此 `PREFIX+X` 不会被误判为残留；
 * 传入 `prefix` 可额外容忍"前缀末位不是标识符字符"的写法（例如 `mv1.`）。
 */
export function findLeakedIdTokens(
  svg: string,
  originalIds: readonly string[],
  prefix = "",
): readonly string[] {
  const scannable = collectScannableTexts(svg, parseSvgRegions(svg));
  const keys = sortKeysLongestFirst(originalIds.filter((id) => id !== ""));
  const hits: string[] = [];
  for (const text of scannable) {
    for (const key of keys) {
      if (hits.includes(key)) {
        continue;
      }
      const pattern = new RegExp(escapeRegExp(key), "gu");
      for (const match of text.matchAll(pattern)) {
        const offset = match.index ?? 0;
        const before = offset > 0 ? text[offset - 1] : "";
        const after = offset + key.length < text.length ? text[offset + key.length] : "";
        const insidePrefix = prefix !== "" && text.slice(0, offset).endsWith(prefix);
        const atBoundary =
          !(before !== "" && IDENT_CHAR.test(before)) && !(after !== "" && IDENT_CHAR.test(after));
        if (atBoundary && !insidePrefix) {
          hits.push(key);
          break;
        }
      }
    }
  }
  return hits;
}
