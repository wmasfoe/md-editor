import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import type {
  MarkdownRangeRecord,
  SourceRange,
  MarkdownNodePolicy,
  MarkdownSyntaxPlugin,
} from "./syntax.ts";

/**
 * 语法插件注册中心（SyntaxPluginRegistry）。
 *
 * 归属：本类实现的是**插件契约的不变量**（id 唯一、节点策略不冲突、装饰分派），
 * 因此放在契约包而非编辑器包——插件作者可以在不引入编辑器的情况下单测自己的插件。
 * 集中管理外部语法插件注入的 Lezer 扩展、节点策略、元数据提取和投影装饰器。
 */
/** 注册来源：决定"全量替换"是否会清掉它。 */
export type PluginRegistrationOrigin = "declarative" | "imperative";

export class SyntaxPluginRegistry {
  readonly #plugins = new Map<string, MarkdownSyntaxPlugin>();
  readonly #nodePolicies = new Map<string, MarkdownNodePolicy>();
  readonly #nodeToPlugin = new Map<string, MarkdownSyntaxPlugin>();
  /** 命令式（`addSyntaxPlugin`）注册的 id：全量替换声明式集合时**必须保留**。 */
  readonly #imperative = new Set<string>();

  constructor(plugins: readonly MarkdownSyntaxPlugin[] = []) {
    this.registerAll(plugins);
  }

  register(plugin: MarkdownSyntaxPlugin, origin: PluginRegistrationOrigin = "declarative"): this {
    if (!plugin || !plugin.id) {
      return this;
    }
    if (this.#plugins.has(plugin.id)) {
      throw new Error(`Syntax plugin already registered: ${plugin.id}`);
    }
    // Preflight every node before mutating maps, including the shorthand node policy.
    const nodes = new Set([
      ...Object.keys(plugin.nodePolicies ?? {}),
      ...(plugin.nodePolicy ? [plugin.nodePolicy.nodeName] : []),
    ]);
    for (const node of nodes) {
      if (this.#nodeToPlugin.has(node)) {
        throw new Error(`Syntax node already registered: ${node}`);
      }
    }
    this.#plugins.set(plugin.id, plugin);
    if (origin === "imperative") {
      this.#imperative.add(plugin.id);
    }

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

  registerAll(
    plugins: readonly MarkdownSyntaxPlugin[],
    origin: PluginRegistrationOrigin = "declarative",
  ): this {
    // Validate the full batch first so one conflict cannot leave a partial registration.
    const ids = new Set(this.#plugins.keys());
    const nodes = new Set(this.#nodeToPlugin.keys());
    for (const plugin of plugins) {
      if (!plugin?.id) continue;
      if (ids.has(plugin.id)) throw new Error(`Syntax plugin already registered: ${plugin.id}`);
      ids.add(plugin.id);
      for (const node of new Set([
        ...Object.keys(plugin.nodePolicies ?? {}),
        ...(plugin.nodePolicy ? [plugin.nodePolicy.nodeName] : []),
      ])) {
        if (nodes.has(node)) throw new Error(`Syntax node already registered: ${node}`);
        nodes.add(node);
      }
    }
    for (const plugin of plugins) {
      this.register(plugin, origin);
    }
    return this;
  }

  /**
   * 清空注册中心内全部已注册的插件、语法扩展与节点策略映射。
   */
  clear(): this {
    this.#plugins.clear();
    this.#nodePolicies.clear();
    this.#nodeToPlugin.clear();
    this.#imperative.clear();
    return this;
  }

  /**
   * 全量替换**声明式命名空间**。
   *
   * 语义契约：命令式注册（`addSyntaxPlugin`）的条目**不清除**——否则用户在设置里
   * 切换任一内置插件开关时，外部插件会被静默注销（全量重建 + 无重放路径）。
   * 替换失败必须保持原注册表不变，因此先在临时实例上校验，再整体交换。
   */
  replaceDeclarative(plugins: readonly MarkdownSyntaxPlugin[]): this {
    const kept = this.#plugins;
    const next = new SyntaxPluginRegistry();
    // 先放入命令式条目，再放新的声明式条目；冲突由 preflight 统一抛错。
    for (const [id, plugin] of kept) {
      if (this.#imperative.has(id)) next.register(plugin, "imperative");
    }
    next.registerAll(plugins, "declarative");

    this.#plugins.clear();
    this.#nodePolicies.clear();
    this.#nodeToPlugin.clear();
    this.#imperative.clear();
    for (const [id, plugin] of next.#plugins) this.#plugins.set(id, plugin);
    for (const [name, policy] of next.#nodePolicies) this.#nodePolicies.set(name, policy);
    for (const [name, plugin] of next.#nodeToPlugin) this.#nodeToPlugin.set(name, plugin);
    for (const id of next.#imperative) this.#imperative.add(id);
    return this;
  }

  /**
   * 注销单个插件。命令式注册的 `Disposable` 走这条路径；
   * 返回是否真的移除了某条注册（幂等，可重复调用）。
   */
  dispose(id: string, expected?: MarkdownSyntaxPlugin): boolean {
    const plugin = this.#plugins.get(id);
    if (!plugin) return false;
    // 身份守卫：`replaceDeclarative` 之后，旧句柄不得摘掉后来注册的同名插件。
    if (expected && plugin !== expected) return false;
    this.#plugins.delete(id);
    this.#imperative.delete(id);
    for (const nodeName of Object.keys(plugin.nodePolicies ?? {})) {
      if (this.#nodeToPlugin.get(nodeName) === plugin) this.#nodeToPlugin.delete(nodeName);
      this.#nodePolicies.delete(nodeName);
    }
    if (plugin.nodePolicy) {
      const nodeName = plugin.nodePolicy.nodeName;
      if (this.#nodeToPlugin.get(nodeName) === plugin) this.#nodeToPlugin.delete(nodeName);
      this.#nodePolicies.delete(nodeName);
    }
    return true;
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
