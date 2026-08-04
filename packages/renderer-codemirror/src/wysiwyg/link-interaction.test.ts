import { describe, expect, it } from "vitest";
import type { MarkdownRangeRecord, MarkdownRangeSegment } from "../markdown/range-types.ts";
import {
  buildLinkLabelDecoration,
  isSafeLinkTarget,
  linkDestinationFromRecord,
} from "./link-interaction.ts";

const TEXT = { sliceString: (from: number, to: number): string => source.slice(from, to) };
let source = "";

function linkRecord(overrides: Partial<MarkdownRangeRecord> = {}): MarkdownRangeRecord {
  return {
    id: "link:0:10:fp",
    kind: "link",
    nodeName: "Link",
    fullRange: { from: 0, to: 10 },
    lineRange: { from: 0, to: 10 },
    blockRange: { from: 0, to: 10 },
    contentRange: { from: 1, to: 5 },
    markerRanges: [
      { from: 0, to: 1 },
      { from: 5, to: 6 },
    ],
    segments: [
      { from: 0, to: 1, role: "marker" },
      { from: 1, to: 5, role: "content" },
      { from: 5, to: 6, role: "marker" },
      // 对应 "[text](https://example.com)" 中 url 的真实区间(7-26)
      { from: 7, to: 26, role: "destination" },
    ],
    renderPolicy: "link-segmented",
    editPolicy: "native",
    interactionPolicy: "reveal-source",
    priority: 60,
    sourceFingerprint: "fp",
    parserCoverage: "complete",
    ...overrides,
  };
}

describe("链接交互:安全白名单", () => {
  it("放行 http/https/mailto 与相对路径", () => {
    expect(isSafeLinkTarget("https://example.com/a")).toBe(true);
    expect(isSafeLinkTarget("http://example.com")).toBe(true);
    expect(isSafeLinkTarget("mailto:hi@example.com")).toBe(true);
    expect(isSafeLinkTarget("./docs/readme.md")).toBe(true);
    expect(isSafeLinkTarget("docs/readme.md")).toBe(true);
    expect(isSafeLinkTarget("#section")).toBe(true);
  });

  it("拒绝 javascript:/data:/vbscript: 等危险协议与空值", () => {
    expect(isSafeLinkTarget("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkTarget("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeLinkTarget("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLinkTarget("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeLinkTarget("//evil.example.com")).toBe(false);
    expect(isSafeLinkTarget("")).toBe(false);
    expect(isSafeLinkTarget("   ")).toBe(false);
  });
});

describe("链接交互:URL 提取", () => {
  it("从 destination segment 提取并剥离尖括号", () => {
    source = "[text](https://example.com)";
    const record = linkRecord();
    expect(linkDestinationFromRecord(record, TEXT)).toBe("https://example.com");
  });

  it("角括号包裹的 URL 剥离尖括号", () => {
    source = "[text](<https://example.com>)";
    const record = linkRecord({
      // destination segment 覆盖 <https://example.com>(7-28)
      segments: [
        { from: 0, to: 1, role: "marker" },
        { from: 1, to: 5, role: "content" },
        { from: 5, to: 6, role: "marker" },
        { from: 7, to: 28, role: "destination" },
      ],
    });
    expect(linkDestinationFromRecord(record, TEXT)).toBe("https://example.com");
  });

  it("无 destination segment 返回 null", () => {
    const record = linkRecord({
      segments: recordSegmentsWithoutDestination(),
    });
    expect(linkDestinationFromRecord(record, TEXT)).toBeNull();
  });
});

function recordSegmentsWithoutDestination(): readonly MarkdownRangeSegment[] {
  return [
    { from: 0, to: 1, role: "marker" },
    { from: 1, to: 5, role: "content" },
    { from: 5, to: 6, role: "marker" },
  ];
}

describe("链接交互:label 装饰", () => {
  it("安全 URL 渲染为 <a href> 且带链接 class", () => {
    const record = linkRecord();
    const decoration = buildLinkLabelDecoration(record, "https://example.com");
    expect(decoration).not.toBeNull();
    // Range<Decoration> 的 value 是 Decoration 实例,spec 是其配置
    const spec = (
      decoration as unknown as {
        value: { spec: { tagName?: string; attributes?: Record<string, string> } };
      }
    ).value.spec;
    expect(spec.tagName).toBe("a");
    expect(spec.attributes?.href).toBe("https://example.com");
    expect(spec.attributes?.draggable).toBe("false");
  });

  it("危险 URL 不渲染为 <a>(fail-closed,仅保留 label class)", () => {
    const record = linkRecord();
    const decoration = buildLinkLabelDecoration(record, "javascript:alert(1)");
    expect(decoration).not.toBeNull();
    const spec = (decoration as unknown as { value: { spec: { tagName?: string } } }).value.spec;
    expect(spec.tagName).toBeUndefined();
  });

  it("无 contentRange 返回 null", () => {
    const record = linkRecord({ contentRange: undefined });
    expect(buildLinkLabelDecoration(record, "https://example.com")).toBeNull();
  });
});
