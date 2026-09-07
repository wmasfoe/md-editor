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

  it("differentiates AST syntax plugin from UI plugin during dynamic use()", () => {
    const parent = (
      typeof document !== "undefined" ? document.createElement("div") : {}
    ) as HTMLElement;
    const docState = createDocumentState({
      markdown: "Line 1\nLine 2",
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
          dispatch: (spec) => {
            const tr = viewState!.update(spec);
            viewState = tr.state;
          },
          dispatchTransaction: (tr) => {
            viewState = tr.state;
          },
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

    const initialIndex = viewState!.field(markdownRangeIndexField);
    const initialVersion = initialIndex.version;

    // 1. 注册纯 UI 装饰型插件（无 markdownExtension）：不触发 AST 全量重新解析
    const uiPlugin: MarkdownSyntaxPlugin = {
      id: "plugin.ui.highlight",
      name: "UI Highlight Plugin",
      buildDecorations: () => [],
    };

    renderer.use(uiPlugin);

    const afterUiIndex = viewState!.field(markdownRangeIndexField);
    // 纯 UI 插件未包含 markdownExtension，AST RangeIndex 版本号保持不变，零重构开销
    expect(afterUiIndex.version).toBe(initialVersion);

    // 2. 注册语法扩展型插件（包含 markdownExtension）：触发 AST RangeIndex 重新解析
    const syntaxPlugin: MarkdownSyntaxPlugin = {
      id: "plugin.syntax.custom",
      name: "Syntax Custom Plugin",
      markdownExtension: {
        defineNodes: ["CustomNode"],
      },
    };

    renderer.use(syntaxPlugin);

    const afterSyntaxIndex = viewState!.field(markdownRangeIndexField);
    // 语法插件包含 markdownExtension，成功调度 AST 重新解析，RangeIndex 版本号递增
    expect(afterSyntaxIndex.version).toBeGreaterThan(initialVersion);
  });

  it("supports clear() and setPlugins() on SyntaxPluginRegistry", () => {
    const registry = new SyntaxPluginRegistry();
    const p1: MarkdownSyntaxPlugin = {
      id: "p1",
      name: "P1",
      nodePolicies: {
        Node1: {
          kind: "directive",
          renderPolicy: "directive-panel",
          editPolicy: "structured",
          interactionPolicy: "structured-block",
          priority: 20,
          markerNodeNames: [],
          contentStrategy: "full",
        },
      },
    };
    const p2: MarkdownSyntaxPlugin = {
      id: "p2",
      name: "P2",
      nodePolicies: {
        Node2: {
          kind: "raw-fallback",
          renderPolicy: "inline-visible-markers",
          editPolicy: "native",
          interactionPolicy: "active-line",
          priority: 20,
          markerNodeNames: [],
          contentStrategy: "between-markers",
        },
      },
    };

    registry.registerAll([p1, p2]);
    expect(registry.plugins).toHaveLength(2);
    expect(registry.getNodePolicy("Node1")).not.toBeNull();
    expect(registry.getNodePolicy("Node2")).not.toBeNull();

    // 验证 clear()
    registry.clear();
    expect(registry.plugins).toHaveLength(0);
    expect(registry.getNodePolicy("Node1")).toBeNull();
    expect(registry.getNodePolicy("Node2")).toBeNull();

    // 验证 setPlugins() 重新设为仅包含 p2
    registry.setPlugins([p2]);
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0].id).toBe("p2");
    expect(registry.getNodePolicy("Node1")).toBeNull();
    expect(registry.getNodePolicy("Node2")).not.toBeNull();
  });

  it("dynamically enables and disables plugins via renderer.setPlugins() with full idempotency", () => {
    const parent = (
      typeof document !== "undefined" ? document.createElement("div") : {}
    ) as HTMLElement;
    const docState = createDocumentState({
      markdown: "Line 1\nLine 2",
    });

    let viewState: EditorState | null = null;
    const dispatchedEffects: StateEffect<unknown>[] = [];

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
          dispatch: (spec) => {
            const tr = viewState!.update(spec);
            viewState = tr.state;
            if (spec.effects) {
              const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
              dispatchedEffects.push(...effects);
            }
          },
          dispatchTransaction: (tr) => {
            viewState = tr.state;
          },
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

    const pluginMath: MarkdownSyntaxPlugin = {
      id: "markdown.math",
      name: "Math Plugin",
      markdownExtension: { defineNodes: ["MathBlock"] },
    };
    const pluginMermaid: MarkdownSyntaxPlugin = {
      id: "markdown.mermaid",
      name: "Mermaid Plugin",
      markdownExtension: { defineNodes: ["MermaidBlock"] },
    };

    // 1. 初始化安装 2 个插件
    renderer.setPlugins([pluginMath, pluginMermaid]);
    expect(viewState).toBeDefined();

    const dispatchCount1 = dispatchedEffects.length;
    expect(dispatchCount1).toBeGreaterThan(0);

    // 2. 幂等性测试：传入完全相同清单，不重复 dispatch
    renderer.setPlugins([pluginMath, pluginMermaid]);
    expect(dispatchedEffects.length).toBe(dispatchCount1);

    // 3. 禁用 Mermaid 插件（仅保留 Math 插件）：触发重配
    renderer.setPlugins([pluginMath]);
    expect(dispatchedEffects.length).toBeGreaterThan(dispatchCount1);

    // 4. 清空所有插件（全部禁用）：触发重配
    const dispatchCount3 = dispatchedEffects.length;
    renderer.setPlugins([]);
    expect(dispatchedEffects.length).toBeGreaterThan(dispatchCount3);

    // 5. 重新全部启用：安全恢复
    const dispatchCount4 = dispatchedEffects.length;
    renderer.setPlugins([pluginMath, pluginMermaid]);
    expect(dispatchedEffects.length).toBeGreaterThan(dispatchCount4);
  });
});
