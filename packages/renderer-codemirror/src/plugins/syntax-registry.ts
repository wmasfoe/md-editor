import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import type { MarkdownNodePolicy } from "../markdown/node-policy.ts";
import type { MarkdownSyntaxPlugin } from "./syntax-plugin.ts";

/**
 * 语法插件注册中心（SyntaxPluginRegistry）。
 * 集中管理外部语法插件注入的 Lezer 扩展、节点策略、元数据提取和投影装饰器。
 */
export class SyntaxPluginRegistry {
  readonly #plugins = new Map<string, MarkdownSyntaxPlugin>();
  readonly #nodePolicies = new Map<string, MarkdownNodePolicy>();
  readonly #nodeToPlugin = new Map<string, MarkdownSyntaxPlugin>();

  constructor(plugins: readonly MarkdownSyntaxPlugin[] = []) {
    this.registerAll(plugins);
  }

  register(plugin: MarkdownSyntaxPlugin): this {
    if (!plugin || !plugin.id) {
      return this;
    }
    this.#plugins.set(plugin.id, plugin);

    // 注册多节点策略映射
    if (plugin.nodePolicies) {
      for (const [nodeName, policy] of Object.entries(plugin.nodePolicies)) {
        this.#nodePolicies.set(nodeName, policy);
        this.#nodeToPlugin.set(nodeName, plugin);
      }
    }

    // 兼容简写单节点策略映射
    if (plugin.nodePolicy) {
      const p = plugin.nodePolicy;
      const policy: MarkdownNodePolicy = Object.freeze({
        kind: p.kind,
        renderPolicy: p.isBlock ? "directive-panel" : "inline-visible-markers",
        editPolicy: "structured",
        interactionPolicy: p.isBlock ? "structured-block" : "active-line",
        priority: 30,
        markerNodeNames: [],
        contentStrategy: "full",
      });
      this.#nodePolicies.set(p.nodeName, policy);
      this.#nodeToPlugin.set(p.nodeName, plugin);
    }

    return this;
  }

  registerAll(plugins: readonly MarkdownSyntaxPlugin[]): this {
    for (const plugin of plugins) {
      this.register(plugin);
    }
    return this;
  }

  get plugins(): readonly MarkdownSyntaxPlugin[] {
    return Object.freeze(Array.from(this.#plugins.values()));
  }

  getMarkdownExtensions(): readonly MarkdownConfig[] {
    const exts: MarkdownConfig[] = [];
    for (const plugin of this.#plugins.values()) {
      if (plugin.markdownExtension) {
        exts.push(plugin.markdownExtension);
      }
    }
    return Object.freeze(exts);
  }

  getNodePolicy(nodeName: string): MarkdownNodePolicy | null {
    return this.#nodePolicies.get(nodeName) ?? null;
  }

  extractMetadata(
    nodeName: string,
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): Record<string, unknown> | undefined {
    const plugin = this.#nodeToPlugin.get(nodeName);
    if (plugin?.extractMetadata) {
      return plugin.extractMetadata(node, source, children);
    }
    return undefined;
  }

  resolveContentRange(
    nodeName: string,
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
    markerRanges: readonly SourceRange[],
  ): SourceRange | null {
    const plugin = this.#nodeToPlugin.get(nodeName);
    if (plugin?.resolveContentRange) {
      return plugin.resolveContentRange(node, source, children, markerRanges);
    }
    return null;
  }

  buildDecorations(
    record: MarkdownRangeRecord,
    state: EditorState,
    context?: { active: boolean; selected: boolean },
  ): readonly Range<Decoration>[] {
    const plugin = this.#nodeToPlugin.get(record.nodeName);
    if (plugin?.buildDecorations) {
      return plugin.buildDecorations(record, state, context);
    }
    if (plugin?.projection?.buildDecorations) {
      return plugin.projection.buildDecorations(record, state, context);
    }
    return [];
  }
}
