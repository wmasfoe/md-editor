import { describe, expect, it } from "vitest";
import { parseMdxJsxElements, type MdxJsxElement } from "../../src/markdown/mdx-parse.ts";

function elementNames(elements: readonly MdxJsxElement[]): readonly string[] {
  return elements.map((element) => `${element.name}@${element.from}-${element.to}`);
}

describe("MdxJsxElement 解析(micromark 无 acorn 模式)", () => {
  it("C1: 块级组件与属性/children 边界正确", () => {
    const source = ['<Callout type="info" title="提示">', "body **bold**", "</Callout>"].join("\n");
    const elements = parseMdxJsxElements(source);

    expect(elements).toHaveLength(1);
    const callout = elements[0];
    if (!callout) {
      throw new Error("Expected a Callout element.");
    }
    expect(callout.name).toBe("Callout");
    expect(callout.from).toBe(0);
    expect(callout.to).toBe(source.length);
    expect(callout.selfClosing).toBe(false);
    expect(callout.attributes).toEqual([
      { name: "type", value: "info" },
      { name: "title", value: "提示" },
    ]);
    expect(source.slice(callout.childrenFrom, callout.childrenTo)).toContain("body **bold**");
  });

  it("C1: 自闭合与行内组件都能解析", () => {
    const source = ["<SelfClosing />", "", 'text <Inline name="a" /> end'].join("\n");
    const elements = parseMdxJsxElements(source);
    expect(elements).toHaveLength(2);
    const selfClosing = elements[0];
    const inline = elements[1];
    expect(selfClosing?.name).toBe("SelfClosing");
    expect(selfClosing?.selfClosing).toBe(true);
    expect(inline?.name).toBe("Inline");
    expect(inline?.attributes).toEqual([{ name: "name", value: "a" }]);
    expect(source.slice(inline?.from ?? 0, inline?.to ?? 0)).toContain("<Inline");
  });

  it("C1-n: 表达式/事件属性整元素丢弃(无 acorn fail-closed)", () => {
    const sources = [
      "<Callout title={1+1}>x</Callout>",
      "<Callout>{1+1}</Callout>",
      "<Callout onClick={fn()}>x</Callout>",
      '<Callout title={"<img src=x onerror=alert(1)>"}>x</Callout>',
    ];
    for (const source of sources) {
      expect(parseMdxJsxElements(source)).toEqual([]);
    }
  });

  it("A6: javascript: 字符串属性原样保留,协议过滤在投影层执行", () => {
    const source = '<Callout href="javascript:alert(1)">x</Callout>';
    const elements = parseMdxJsxElements(source);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.attributes).toEqual([{ name: "href", value: "javascript:alert(1)" }]);
  });

  it("A5: script 走私不产生组件节点(小写标签走 HTML 路径)", () => {
    const source = "<Callout>body</Callout><script>alert(1)</script>";
    const elements = parseMdxJsxElements(source);
    // 只有大写开头的 Callout 是组件;script 小写标签被过滤
    expect(elementNames(elements)).toEqual(["Callout@0-23"]);
  });

  it("C1-n: 非法嵌套/未闭合抛错被捕获,返回空(保持源码)", () => {
    const sources = ["<Callout>never closed", "<Callout><div></Callout>"];
    for (const source of sources) {
      expect(parseMdxJsxElements(source)).toEqual([]);
    }
  });

  it("C1: import/export 语句不产生组件节点", () => {
    const source =
      'import x from "../../src/markdown/evil"\n\nexport default x\n\n<Callout>x</Callout>';
    const elements = parseMdxJsxElements(source);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.name).toBe("Callout");
    expect(source.slice(elements[0]?.from ?? 0, elements[0]?.to ?? 0)).toContain("Callout");
  });

  it("C4: 解析产物不含 estree(无 acorn)", () => {
    const source = '<Callout type="info">body</Callout>';
    const elements = parseMdxJsxElements(source);
    expect(elements[0]?.estree).toBeUndefined();
  });

  it("C6: 嵌套 children 保留完整结构", () => {
    const source = [
      "<Panel>",
      '  <Callout type="info">inner</Callout>',
      "  plain",
      "</Panel>",
    ].join("\n");
    const elements = parseMdxJsxElements(source);
    expect(elementNames(elements)).toEqual(["Panel@0-63", "Callout@10-46"]);
    const panel = elements[0];
    const inner = elements[1];
    expect(panel?.children).toHaveLength(1);
    expect(panel?.children[0]?.name).toBe("Callout");
    expect(inner?.from).toBe(10);
    expect(inner?.to).toBe(46);
  });
});
