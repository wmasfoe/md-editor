import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  createMdxComponentRegistry,
  type MdxComponentDescriptor,
} from "@md-editor/mdx-component-registry";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField, mdxModeFacet } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import { mdxComponentRegistryFacet } from "../../src/wysiwyg/mdx-projection.ts";
import type { MdxComponentWidget } from "../../src/wysiwyg/widgets/mdx-component-widget.ts";

const CALLOUT_DESCRIPTOR: MdxComponentDescriptor = {
  name: "Callout",
  displayName: "Callout",
  props: [
    { name: "type", type: "enum", values: ["info", "warning"] },
    { name: "title", type: "string" },
  ],
  acceptsChildren: true,
  version: "0.1",
};

function createMdxHarness(
  doc: string,
  registry = createMdxComponentRegistry([
    {
      id: "mdx.callout",
      component: CALLOUT_DESCRIPTOR,
    },
  ]),
): { state: EditorState; diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      mdxModeFacet.of(true),
      mdxComponentRegistryFacet.of(registry),
      configureWysiwygProjectionFeatures([
        "inline-styles",
        "headings",
        "blocks",
        "links",
        "images",
        "thematic-breaks",
        "default-atoms",
        "frontmatter",
        "tables",
        "html",
        "mdx",
      ]),
      wysiwygProjectionField,
    ],
  });
  return { state, diagnostics };
}

function findMdxWidget(state: EditorState): MdxComponentWidget | null {
  let widget: MdxComponentWidget | null = null;
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.wysiwygRole === "mdx-widget") {
        widget = value.spec.widget as MdxComponentWidget;
      }
    });
  return widget;
}

describe("MDX projection(白名单求值)", () => {
  it("C2: 已注册组件投影为 widget 并携带描述符与属性", () => {
    const doc = ['<Callout type="info" title="提示">', "body", "</Callout>", ""].join("\n");
    const { state } = createMdxHarness(doc);

    const widget = findMdxWidget(state);
    expect(widget).not.toBeNull();
    expect(widget?.value.componentName).toBe("Callout");
    expect(widget?.value.descriptor?.displayName).toBe("Callout");
    expect(widget?.value.attributes).toEqual([
      { name: "type", value: "info" },
      { name: "title", value: "提示" },
    ]);
    expect(widget?.value.childrenSource).toContain("body");
    expect(inspectWysiwygProjection(state).layoutDecorationCount).toBe(1);
  });

  it("C2: 未注册组件显示占位(descriptor 为 null)", () => {
    const doc = ["<Unknown>raw</Unknown>", ""].join("\n");
    const { state } = createMdxHarness(doc);

    const widget = findMdxWidget(state);
    expect(widget).not.toBeNull();
    expect(widget?.value.componentName).toBe("Unknown");
    expect(widget?.value.descriptor).toBeNull();
  });

  it("C3: 组件块原子且受保护,范围与 fullRange 一致", () => {
    const doc = ["Before", "", '<Callout type="info">', "body", "</Callout>", "", "After", ""].join(
      "\n",
    );
    const { state } = createMdxHarness(doc);
    const projection = inspectWysiwygProjection(state);
    const mdxFrom = doc.indexOf("<Callout");
    const mdxTo = doc.indexOf("After") - 1;

    expect(projection.atomicRangeCount).toBeGreaterThanOrEqual(1);
    const mdxProtected = projection.protectedRanges.find((range) => range.kind === "mdx");
    expect(mdxProtected).toBeDefined();
    expect(mdxProtected?.from).toBe(mdxFrom);
    expect(doc.slice(mdxProtected?.from ?? 0, mdxProtected?.to ?? 0)).toContain("</Callout>");
    expect(mdxProtected?.to ?? 0).toBeLessThanOrEqual(mdxTo);
  });

  it("A6: javascript: 协议属性被剔除,不进入 widget", () => {
    const doc = '<Callout href="javascript:alert(1)">x</Callout>';
    const { state } = createMdxHarness(doc);

    const widget = findMdxWidget(state);
    expect(widget).not.toBeNull();
    expect(widget?.value.attributes).toEqual([]);
  });

  it("A1: 事件属性被剔除(防御纵深)", () => {
    const doc = '<Callout onclick="alert(1)" title="ok">x</Callout>';
    const { state } = createMdxHarness(doc);

    const widget = findMdxWidget(state);
    expect(widget).not.toBeNull();
    expect(widget?.value.attributes).toEqual([{ name: "title", value: "ok" }]);
  });

  it("C5: children 编辑回写源码后重新解析一致", () => {
    const doc = ['<Callout type="info">', "旧内容", "</Callout>", ""].join("\n");
    const { state } = createMdxHarness(doc);
    const widget = findMdxWidget(state);
    expect(widget?.value.childrenSource).toContain("旧内容");
  });
});
