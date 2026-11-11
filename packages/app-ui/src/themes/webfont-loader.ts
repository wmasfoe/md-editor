/**
 * @fileoverview 动态按需 WebFont 加载器 (WebFont Loader)
 *
 * 策略契约：
 * 1. 本机字体优先（通过 local() 查询已安装字体）；
 * 2. 仅当激活主题或用户配置命中外部字体时，按需向 <head> 注入幂等 @font-face 样式；
 * 3. 字体资源走 CDN + font-display: swap，严禁将数十 MB 原始字体打入安装包；
 * 4. 离线或加载中自动平滑回退至系统自带衬线/等宽字体（Charter / 宋体 / SF Mono）。
 */

const LOADED_FONTS = new Set<string>();

const WEBFONT_REGISTRY: Record<string, string> = {
  TsangerJinKai02: `
@font-face {
  font-family: "TsangerJinKai02";
  src: local("TsangerJinKai02"), local("TsangerJinKai02-W04"),
       url("https://cdn.jsdelivr.net/gh/tw93/Kami@main/assets/fonts/TsangerJinKai02-W04.ttf") format("truetype");
  font-weight: 400 500;
  font-style: normal;
  font-display: swap;
}
`,
  "JetBrains Mono": `
@font-face {
  font-family: "JetBrains Mono";
  src: local("JetBrains Mono"),
       url("https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.0/files/jetbrains-mono-all-400-normal.woff") format("woff");
  font-weight: 400 500;
  font-style: normal;
  font-display: swap;
}
`,
  "LXGW WenKai": `
@font-face {
  font-family: "LXGW WenKai";
  src: local("LXGW WenKai"), local("LXGWWenKai-Regular"),
       url("https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.1.0/lxgwwenkai-regular.woff2") format("woff2");
  font-weight: 400 500;
  font-style: normal;
  font-display: swap;
}
`,
};

/**
 * 按需确保特定 WebFont @font-face 规则就绪
 */
export function ensureWebFont(fontFamilyName: string): void {
  if (typeof document === "undefined" || !fontFamilyName) {
    return;
  }

  const key = Object.keys(WEBFONT_REGISTRY).find((name) => fontFamilyName.includes(name));

  if (!key) {
    return;
  }

  let styleTag = document.getElementById("md-editor-webfonts") as HTMLStyleElement | null;
  if (
    LOADED_FONTS.has(key) &&
    styleTag &&
    styleTag.textContent?.includes(`font-family: "${key}"`)
  ) {
    return;
  }

  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "md-editor-webfonts";
    document.head.append(styleTag);
  }

  const rule = WEBFONT_REGISTRY[key];
  if (rule && !styleTag.textContent?.includes(`font-family: "${key}"`)) {
    styleTag.textContent = `${styleTag.textContent ?? ""}\n${rule}`.trim();
  }

  LOADED_FONTS.add(key);
}

/**
 * 仅用于单元测试重置缓存
 */
export function resetWebFontCacheForTesting(): void {
  LOADED_FONTS.clear();
}

/**
 * 扫描当前生效的 CSS 文本中是否包含需要动态挂载的字体
 */
export function ensureWebFontsForCss(cssText: string): void {
  if (typeof document === "undefined" || !cssText) {
    return;
  }
  for (const name of Object.keys(WEBFONT_REGISTRY)) {
    if (cssText.includes(name)) {
      ensureWebFont(name);
    }
  }
}
