import assert from "node:assert/strict";
import test from "node:test";

import { compareRenderedHtml, firstDifference, projectHtml, serializeTokens } from "./lib.mjs";

test("projectHtml 忽略属性顺序（HTML 里属性顺序无语义）", () => {
  const left = '<strong class="cm-md-inline cm-md-bold" id="x">文本</strong>';
  const right = '<strong id="x" class="cm-md-inline cm-md-bold">文本</strong>';

  assert.equal(serializeTokens(projectHtml(left)), serializeTokens(projectHtml(right)));
});

test("projectHtml 折叠空白并裁剪文本节点两端", () => {
  const left = "<p>  a    b\n\tc  </p>";
  const right = "<p>a b c</p>";

  assert.equal(serializeTokens(projectHtml(left)), serializeTokens(projectHtml(right)));
});

test("projectHtml 纯空白文本节点被丢弃", () => {
  assert.equal(serializeTokens(projectHtml("<p>  </p>")), serializeTokens(projectHtml("<p></p>")));
});

test("projectHtml 保留 void 元素自闭合形态差异", () => {
  assert.equal(
    serializeTokens(projectHtml("<br>")),
    serializeTokens(projectHtml("<br/>")),
    "br 是 void 元素，两种写法应视为相同",
  );
  assert.equal(
    serializeTokens(projectHtml("<div/>")),
    serializeTokens(projectHtml("<div></div>")),
    "非 void 元素的自闭合应展开为成对标签",
  );
});

test("projectHtml 处理引号内的尖括号", () => {
  const html = '<a title="a > b">x</a>';
  const tokens = projectHtml(html);

  assert.equal(tokens[0].kind, "open");
  assert.equal(tokens[0].tag, "a");
  assert.deepEqual(tokens[0].attrs, [["title", "a > b"]]);
});

test("projectHtml 处理注释与未闭合标签", () => {
  const withComment = projectHtml("<!-- note --><p>x</p>");
  assert.equal(withComment[0].kind, "comment");

  // 未闭合的 `<` 退化为文本，不抛错（确定性优先）
  assert.doesNotThrow(() => projectHtml("a < b"));
});

test("compareRenderedHtml: byte 模式严格等价", () => {
  assert.equal(compareRenderedHtml("<p>a</p>", "<p>a</p>", "byte").ok, true);

  const result = compareRenderedHtml("<p>a</p>", "<p>b</p>", "byte");
  assert.equal(result.ok, false);
  assert.match(result.message, /字节级不一致/);
});

test("compareRenderedHtml: semantic 模式容忍属性顺序与空白", () => {
  const left = '<strong class="x" id="y">  a   b </strong>';
  const right = '<strong id="y" class="x">a b</strong>';

  assert.equal(compareRenderedHtml(left, right, "byte").ok, false, "byte 模式应判不一致");
  assert.equal(compareRenderedHtml(left, right, "semantic").ok, true, "semantic 模式应判一致");
});

test("compareRenderedHtml: semantic 模式不放宽标签结构差异", () => {
  const result = compareRenderedHtml("<strong>a</strong>", "<em>a</em>", "semantic");

  assert.equal(result.ok, false, "语义等价不等于标签可替换——strong 与 em 是不同语义");
  assert.match(result.message, /语义投影不一致/);
});

test("compareRenderedHtml: 未知模式必须失败而非静默通过", () => {
  const result = compareRenderedHtml("a", "a", "bogus");
  assert.equal(result.ok, true, "完全相同的输入仍应通过");

  const mismatch = compareRenderedHtml("a", "b", "bogus");
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /未知比较模式/);
});

test("firstDifference 报告首个差异位置与上下文", () => {
  const diff = firstDifference("abcdef", "abcXef");
  assert.equal(diff.index, 3);
  assert.match(diff.left, /abc/);
  assert.match(diff.right, /abcX/);
});
