import { describe, expect, it } from "vitest";
import type { EditorState, StateEffect } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { createDocumentState } from "@md-editor/editor-core";
import {
  createCodeMirrorRendererWithFactory,
  type RendererViewAdapter,
  type RendererViewFactoryInput,
} from "../../src/renderer.ts";
import {
  markdownRangeIndexField,
  SyntaxPluginRegistry,
  type MarkdownRangeRecord,
  type MarkdownSyntaxPlugin,
} from "../../src";

describe("MarkdownSyntaxPlugin & SyntaxPluginRegistry (Renderer Core)", () => {
  it("allows custom syntax plugin registration and metadata extraction", () => {
    const registry = new SyntaxPluginRegistry();

    const customPlugin: MarkdownSyntaxPlugin = {
      id: "custom.plugin",
      name: "Custom Plugin",
      nodePolicies: {
        CustomNode: {
          kind: "raw-fallback",
          renderPolicy: "directive-panel",
          editPolicy: "native",
          interactionPolicy: "none",
          priority: 10,
          markerNodeNames: [],
          contentStrategy: "full",
        },
      },
      extractMetadata: () => ({ customField: "customValue" }),
      buildDecorations: () => [Decoration.line({ class: "custom-line" }).range(0)],
    };

    registry.register(customPlugin);
    expect(registry.plugins).toHaveLength(1);
    expect(registry.getNodePolicy("CustomNode")?.renderPolicy).toBe("directive-panel");

    const meta = registry.extractMetadata(
      "CustomNode",
      {} as unknown as Parameters<typeof registry.extractMetadata>[1],
      "source",
      [],
    );
    expect(meta?.customField).toBe("customValue");

    const decos = registry.buildDecorations(
      { nodeName: "CustomNode" } as MarkdownRangeRecord,
      {} as unknown as EditorState,
    );
    expect(decos).toHaveLength(1);
  });

  it("supports chainable use() method on renderer instance", () => {
    const parent = (
      typeof document !== "undefined" ? document.createElement("div") : {}
    ) as HTMLElement;
    const docState = createDocumentState({
      markdown: "# Title\n\nParagraph text.",
    });

    let viewState: EditorState | null = null;
    const renderer = createCodeMirrorRendererWithFactory(
      {
        parent,
        initialSnapshot: docState.getSnapshot(),
        onEditorChange: () => {},
        onQueuedExternalEditReady: () => {},
        onQueuedExternalEditCancelled: () => {},
      },
      (input: RendererViewFactoryInput): RendererViewAdapter => {
        viewState = input.state;
        return {
          get state() {
            return viewState!;
          },
          isComposing: false,
          dispatch: () => {},
          dispatchTransaction: () => {},
          setState: (nextState: EditorState) => {
            viewState = nextState;
          },
          scrollSnapshot: () => ({}) as unknown as StateEffect<unknown>,
          getScrollTop: () => 0,
          setScrollTop: () => {},
          hasFocus: () => false,
          focus: () => {},
          requestMeasure: () => {},
          destroy: () => {},
        };
      },
    );

    const plugin1: MarkdownSyntaxPlugin = {
      id: "plugin.one",
      name: "Plugin 1",
    };
    const plugin2: MarkdownSyntaxPlugin = {
      id: "plugin.two",
      name: "Plugin 2",
    };

    // 验证链式调用 use() 返回 renderer 实例
    const chained = renderer.use(plugin1).use(plugin2);
    expect(chained).toBe(renderer);

    // 验证无插件时，纯文本渲染正常
    expect(viewState).toBeDefined();
    const index = (viewState as unknown as EditorState).field(markdownRangeIndexField);
    expect(index.records.length).toBeGreaterThan(0);
  });
});
