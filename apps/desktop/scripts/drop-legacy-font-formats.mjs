/**
 * @file drop-legacy-font-formats.mjs
 * @description 构建期裁剪 `@font-face` 里的传统字体格式回退（ttf / woff），只保留 woff2。
 *
 * 动机：KaTeX 的 `dist/katex.min.css` 为每个字体声明三种格式
 *
 *     src: url(X.woff2) format("woff2"), url(X.woff) format("woff"), url(X.ttf) format("truetype")
 *
 * 桌面端跑在 WKWebView（macOS）/ WebView2（Windows）/ WebKitGTK（Linux）上，三者都从
 * Safari 10 / Chromium 51 起支持 woff2，前面两段永远不会被命中，却要占安装包体积。
 * 实测桌面端 `dist/assets` 里 20 个 ttf + 20 个 woff 合计约 800 KB。
 *
 * 裁剪原则：**只删除声明，不删除没有 woff2 兜底的字体**。若某个 `@font-face` 没有
 * woff2 源，则原样保留，避免裁出「字重缺失」这种只在特定平台暴露的问题。
 *
 * 边界：这里只处理桌面端构建。web / utools / mobile 面向的浏览器矩阵更宽
 * （老版本 Safari、部分内嵌 WebView），保持三格式回退不变。
 */

/** 匹配 `@font-face { ... }` 块（KaTeX 产出里没有嵌套花括号）。 */
const FONT_FACE_PATTERN = /@font-face\s*\{[^}]*\}/gu;
/** 匹配单条 `url(...)format("...")` 源声明，含前导分隔符以便整段删除。 */
const FONT_SOURCE_PATTERN =
  /url\(\s*(['"]?)([^)'"]+)\1\s*\)\s*format\(\s*(['"]?)([^)'"]+)\3\s*\)/gu;
/** 需要裁剪的格式：保留 woff2，丢 ttf / woff（truetype / opentype / woff）。 */
const DROPPABLE_FORMATS = new Set(["truetype", "opentype", "woff"]);
/** 保留的现代格式。 */
const KEPT_FORMAT = "woff2";

/**
 * 判断一条 `src` 声明块是否同时具备 woff2 与可裁剪格式。
 *
 * 只有「有 woff2 兜底」时才允许裁剪；否则调用方必须原样保留。
 *
 * @param {string} declarations `src: ...` 的内容部分
 * @returns {boolean}
 */
export function hasWoff2Fallback(declarations) {
  FONT_SOURCE_PATTERN.lastIndex = 0;
  let match;
  while ((match = FONT_SOURCE_PATTERN.exec(declarations)) !== null) {
    if (match[4].toLowerCase() === KEPT_FORMAT) {
      return true;
    }
  }
  return false;
}

/**
 * 从单个 `@font-face` 块里移除 ttf / woff 源声明。
 *
 * 无 woff2 兜底时原样返回，保证不会裁出缺字重。
 *
 * @param {string} fontFaceBlock 完整的 `@font-face { ... }` 文本
 * @returns {string} 处理后的块
 */
export function stripLegacyFormatsFromFontFace(fontFaceBlock) {
  const sourceMatch = /src\s*:([^;}]*)/u.exec(fontFaceBlock);
  if (!sourceMatch || !hasWoff2Fallback(sourceMatch[1])) {
    return fontFaceBlock;
  }

  const rewrittenSources = sourceMatch[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      FONT_SOURCE_PATTERN.lastIndex = 0;
      const match = FONT_SOURCE_PATTERN.exec(entry);
      if (!match) {
        // 无法识别的写法（例如 local(...)）：保守保留。
        return true;
      }
      return !DROPPABLE_FORMATS.has(match[4].toLowerCase());
    })
    .join(",");

  const before = sourceMatch[1];
  const after = rewrittenSources.length > 0 ? rewrittenSources : before;
  return fontFaceBlock.replace(`src:${before}`, `src:${after}`);
}

/**
 * 对整份 CSS 文本应用裁剪。只改动 `@font-face` 块，其余样式原样保留。
 *
 * @param {string} css 原始 CSS 文本
 * @returns {string} 裁剪后的 CSS 文本
 */
export function dropLegacyFontFormats(css) {
  if (typeof css !== "string" || !css.includes("@font-face")) {
    return css;
  }
  return css.replace(FONT_FACE_PATTERN, (block) => stripLegacyFormatsFromFontFace(block));
}

/**
 * 判断资产是否需要因裁剪而删除：ttf / woff 且已被某个 `@font-face` 引用过。
 *
 * 只删除「确实被 CSS 引用、且该 @font-face 已裁掉该格式」的文件，避免误删
 * 未参与 `@font-face` 的独立字体资产。
 *
 * @param {string} fileName 产物文件名
 * @param {Set<string>} referenced 仍被裁剪后 CSS 引用的文件路径集合
 * @returns {boolean}
 */
export function shouldDropFontAsset(fileName, referenced) {
  if (!/\.(ttf|woff)$/iu.test(fileName)) {
    return false;
  }
  return !referenced.has(fileName.split("/").pop() ?? fileName);
}

/**
 * Vite 插件：在 `generateBundle`（Vite 已把 CSS 里的 `url()` 重写成带 hash 的资源路径后）
 * 裁剪 CSS 声明，并删除因此变成孤儿资产的 ttf / woff 文件。
 *
 * @returns {import("vite").Plugin}
 */
export function dropLegacyFontFormatsPlugin() {
  return {
    name: "md-editor:drop-legacy-font-formats",
    // 必须晚于 Vite 内置 CSS/asset 处理，否则看到的还是未重写的 `url(fonts/X.ttf)`。
    enforce: "post",
    generateBundle(_options, bundle) {
      const cssAssets = Object.values(bundle).filter(
        (asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
      );

      /** 裁剪后仍被 CSS 引用的资源文件名。 */
      const stillReferenced = new Set();
      for (const asset of cssAssets) {
        // Vite 的 CSS 资产通常是 string，但类型声明允许 Uint8Array。
        const original =
          typeof asset.source === "string"
            ? asset.source
            : new TextDecoder("utf-8").decode(asset.source);
        const rewritten = dropLegacyFontFormats(original);
        if (rewritten !== original) {
          asset.source = rewritten;
        }
        for (const match of rewritten.matchAll(/url\(\s*['"]?([^)'"]+)\1?/gu)) {
          stillReferenced.add(match[1].split("/").pop() ?? match[1]);
        }
      }

      let droppedCount = 0;
      let droppedBytes = 0;
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "asset") {
          continue;
        }
        if (!shouldDropFontAsset(output.fileName, stillReferenced)) {
          continue;
        }
        droppedCount += 1;
        droppedBytes +=
          typeof output.source === "string" ? output.source.length : output.source.byteLength;
        delete bundle[fileName];
      }

      if (droppedCount > 0) {
        this.info(
          `[drop-legacy-font-formats] 移除 ${droppedCount} 个无用的 ttf/woff 字体资产（约 ${Math.round(
            droppedBytes / 1024,
          )} KB）`,
        );
      }
    },
  };
}
