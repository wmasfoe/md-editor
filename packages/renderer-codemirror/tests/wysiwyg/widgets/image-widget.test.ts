import { describe, expect, it } from "vitest";
import { parseImageMarkdownSource } from "../../../src/wysiwyg/../../src/wysiwyg/widgets/image-widget.ts";

describe("parseImageMarkdownSource(图片 markdown 源码解析)", () => {
  it("解析基础 alt+src", () => {
    expect(parseImageMarkdownSource("![猫](cat.png)")).toEqual({
      alt: "猫",
      source: "cat.png",
      title: null,
    });
  });

  it("解析带 title", () => {
    expect(parseImageMarkdownSource('![猫](cat.png "一只猫")')).toEqual({
      alt: "猫",
      source: "cat.png",
      title: "一只猫",
    });
  });

  it("解析尖括号包裹的 src", () => {
    expect(parseImageMarkdownSource("![图](<https://example.com/a b.png>)")).toEqual({
      alt: "图",
      source: "https://example.com/a b.png",
      title: null,
    });
  });

  it("解析空 source 如 ![]() 和 ![猫]()", () => {
    expect(parseImageMarkdownSource("![]()")).toEqual({
      alt: "",
      source: "",
      title: null,
    });
    expect(parseImageMarkdownSource("![猫]()")).toEqual({
      alt: "猫",
      source: "",
      title: null,
    });
    expect(parseImageMarkdownSource("![图](<>)")).toEqual({
      alt: "图",
      source: "",
      title: null,
    });
    expect(parseImageMarkdownSource('![猫]( "一只猫")')).toEqual({
      alt: "猫",
      source: "",
      title: "一只猫",
    });
  });

  it("容忍首尾空白", () => {
    expect(parseImageMarkdownSource("  ![猫](cat.png)  ")).toEqual({
      alt: "猫",
      source: "cat.png",
      title: null,
    });
    expect(parseImageMarkdownSource("  ![]()  ")).toEqual({
      alt: "",
      source: "",
      title: null,
    });
  });

  it("畸形输入返回 null", () => {
    expect(parseImageMarkdownSource("![猫]")).toBeNull();
    expect(parseImageMarkdownSource("![猫](cat.png")).toBeNull();
    expect(parseImageMarkdownSource("普通文本")).toBeNull();
    expect(parseImageMarkdownSource("")).toBeNull();
    expect(parseImageMarkdownSource("[猫](cat.png)")).toBeNull();
  });
});
