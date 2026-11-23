import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropLegacyFontFormats,
  hasWoff2Fallback,
  shouldDropFontAsset,
  stripLegacyFormatsFromFontFace,
} from "./drop-legacy-font-formats.mjs";

const KATEX_STYLE_FACE =
  '@font-face{font-family:"KaTeX_Main";font-display:block;' +
  'src:url(/assets/KaTeX_Main-Regular-a.woff2)format("woff2"),' +
  'url(/assets/KaTeX_Main-Regular-b.woff)format("woff"),' +
  'url(/assets/KaTeX_Main-Regular-c.ttf)format("truetype")}';

test("保留 woff2，移除 woff / ttf 回退", () => {
  const output = stripLegacyFormatsFromFontFace(KATEX_STYLE_FACE);

  assert.match(output, /KaTeX_Main-Regular-a\.woff2/);
  assert.doesNotMatch(output, /\.woff\)/);
  assert.doesNotMatch(output, /\.ttf\)/);
  assert.doesNotMatch(output, /truetype/);
});

test("woff2 是唯一格式时不动", () => {
  const onlyWoff2 = '@font-face{font-family:"X";src:url(/assets/X.woff2)format("woff2")}';
  assert.equal(stripLegacyFormatsFromFontFace(onlyWoff2), onlyWoff2);
});

test("没有 woff2 兜底时整块保留，避免裁出缺字重", () => {
  const legacyOnly =
    '@font-face{font-family:"X";src:url(/assets/X.woff)format("woff"),url(/assets/X.ttf)format("truetype")}';
  assert.equal(stripLegacyFormatsFromFontFace(legacyOnly), legacyOnly);
});

test("local() 源原样保留", () => {
  const withLocal =
    '@font-face{font-family:"X";src:local("X Regular"),url(/assets/X.woff2)format("woff2"),url(/assets/X.ttf)format("truetype")}';
  const output = stripLegacyFormatsFromFontFace(withLocal);

  assert.match(output, /local\("X Regular"\)/);
  assert.match(output, /X\.woff2/);
  assert.doesNotMatch(output, /\.ttf\)/);
});

test("只改 @font-face，不碰其它样式", () => {
  const css = `${KATEX_STYLE_FACE}.katex{font:normal 1.21em KaTeX_Main;background:url(/assets/bg.ttf)}`;

  const output = dropLegacyFontFormats(css);

  assert.match(output, /KaTeX_Main-Regular-a\.woff2/);
  assert.doesNotMatch(output, /KaTeX_Main-Regular-c\.ttf/);
  // 非 @font-face 里的 .ttf 引用不属于字体回退，必须保留。
  assert.match(output, /background:url\(\/assets\/bg\.ttf\)/);
});

test("hasWoff2Fallback 正确识别格式", () => {
  assert.equal(hasWoff2Fallback('url(a.woff2)format("woff2")'), true);
  assert.equal(hasWoff2Fallback('url(a.woff)format("woff"),url(a.ttf)format("truetype")'), false);
  assert.equal(hasWoff2Fallback(""), false);
});

test("非 CSS 输入原样返回", () => {
  assert.equal(dropLegacyFontFormats(""), "");
  assert.equal(dropLegacyFontFormats(".a{color:red}"), ".a{color:red}");
});

test("shouldDropFontAsset 只淘汰未被引用的 ttf / woff", () => {
  const referenced = new Set(["KaTeX_Main-Regular-a.woff2"]);

  assert.equal(shouldDropFontAsset("assets/KaTeX_Main-Regular-c.ttf", referenced), true);
  assert.equal(shouldDropFontAsset("assets/KaTeX_Main-Regular-b.woff", referenced), true);
  assert.equal(shouldDropFontAsset("assets/KaTeX_Main-Regular-a.woff2", referenced), false);
  // 仍被引用的 ttf（例如作为背景图）不能被删。
  assert.equal(shouldDropFontAsset("assets/bg.ttf", new Set(["bg.ttf"])), false);
});

test("KaTeX 真实样式表：20 个 @font-face 全部有 woff2 兜底", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { dirname, resolve } = await import("node:path");

  // 必须通过模块解析拿真实安装的 katex，不能硬编码版本号：
  // 仓库 catalog 是 ^0.18.6，node_modules 里同时存在旧版本残留，硬编码会跳到错的那份。
  const require = createRequire(import.meta.url);
  const katexPackageJson = require.resolve("katex/package.json");
  const cssPath = resolve(dirname(katexPackageJson), "dist/katex.min.css");
  const css = readFileSync(cssPath, "utf8");

  const faces = css.match(/@font-face\s*\{[^}]*\}/gu) ?? [];
  assert.equal(faces.length, 20);
  for (const face of faces) {
    const sourceMatch = /src\s*:([^;}]*)/u.exec(face);
    assert.ok(sourceMatch, `缺少 src 声明：${face.slice(0, 60)}`);
    assert.equal(
      hasWoff2Fallback(sourceMatch[1]),
      true,
      `该 @font-face 缺少 woff2 兜底，裁剪会缺字重：${face.slice(0, 80)}`,
    );
  }

  const output = dropLegacyFontFormats(css);
  assert.equal((output.match(/\.ttf\)/gu) ?? []).length, 0);
  assert.equal((output.match(/\.woff\)/gu) ?? []).length, 0);
  assert.equal((output.match(/\.woff2\)/gu) ?? []).length, (css.match(/\.woff2\)/gu) ?? []).length);
});
