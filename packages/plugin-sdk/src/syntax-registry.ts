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

/**
 * 一个插件占用的**语法节点名**集合（冲突校验与登记的唯一定义）。
 *
 * 三路来源都要算上，少算任何一路都会留下绕过口：
 * 1. Lezer `markdownExtension.defineNodes`（对象或字符串形态）—— 评审指出的缺口；
 * 2. `nodePolicies` 的键；
 * 3. 简写 `nodePolicy.nodeName`。
 */
export function syntaxNodeNames(plugin: MarkdownSyntaxPlugin): string[] {
  return [
    ...defineNodeNames(plugin),
    ...Object.keys(plugin.nodePolicies ?? {}),
    ...(plugin.nodePolicy ? [plugin.nodePolicy.nodeName] : []),
  ];
}

/** 仅 Lezer `defineNodes` 声明的节点名（不含策略映射，登记归属时专用）。 */
function defineNodeNames(plugin: MarkdownSyntaxPlugin): string[] {
  const extension = plugin.markdownExtension;
  const definitions = extension && !Array.isArray(extension) ? extension.defineNodes : undefined;
  return (definitions ?? []).map((node) => (typeof node === "string" ? node : node.name));
}

/** 命令式注册句柄：`dispose()` 返回是否真的移除了本次注册（幂等）。 */
export interface SyntaxPluginRegistrationHandle {
  dispose(): boolean;
}

export class SyntaxPluginRegistry {
  readonly #plugins = new Map<string, MarkdownSyntaxPlugin>();
  readonly #nodePolicies = new Map<string, MarkdownNodePolicy>();
  readonly #nodeToPlugin = new Map<string, MarkdownSyntaxPlugin>();
  /**
   * 仅由 Lezer `defineNodes` 声明的节点名 → 插件。
   *
   * **必须与 `#nodeToPlugin` 分开**：`#nodeToPlugin` 是"谁来处理这个节点"的
   * 分派表（`buildDecorations` / `extractMetadata` / `resolveContentRange` 都查它）。
   * 把纯 `defineNodes` 的节点塞进去会让分派表命中一个没有装饰实现的插件，
   * 于是 `buildDecorations` 返回空数组 —— CM6 对空 mark decoration 直接抛
   * `Mark decorations may not be empty`（实测 syntax-plugins 3 条用例崩溃）。
   * 这里只用于**冲突预检**，不参与分派。
   */
  readonly #declaredNodes = new Map<string, MarkdownSyntaxPlugin>();
  /** 命令式（`addSyntaxPlugin`）注册的 id：全量替换声明式集合时**必须保留**。 */
  readonly #imperative = new Set<string>();
  /**
   * 每次注册分配的单调递增代号（`id → token`）。
   *
   * 只比对插件对象身份不够：同一个对象可以注册 → 释放 → 再注册，此时
   * `#plugins.get(id) === plugin` 依然成立，旧句柄就能把**新注册**摘掉
   * （用户侧表现为"插件莫名消失"）。代号让每个句柄只认自己那一次注册。
   */
  readonly #tokens = new Map<string, number>();
  #nextToken = 1;

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
    // Preflight every node before mutating maps, including `defineNodes` and the
    // shorthand node policy. `defineNodes` 曾经漏检：两个插件各自 defineNodes
    // 同名节点会被放行，装配语言时才出问题。
    const nodes = new Set(syntaxNodeNames(plugin));
    for (const node of nodes) {
      if (this.#nodeToPlugin.has(node) || this.#declaredNodes.has(node)) {
        throw new Error(`Syntax node already registered: ${node}`);
      }
    }
    this.#plugins.set(plugin.id, plugin);
    // 冲突表登记该插件的**全部**节点名（defineNodes + 策略键），只用于预检，
    // 不参与分派（分派走 `#nodeToPlugin`，纯 defineNodes 的节点不该命中装饰构建）。
    for (const nodeName of new Set(syntaxNodeNames(plugin))) {
      if (!this.#declaredNodes.has(nodeName)) this.#declaredNodes.set(nodeName, plugin);
    }
    this.#tokens.set(plugin.id, this.#nextToken);
    this.#nextToken += 1;
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
    // 节点名必须**同时**取自两张表，与单项 `register` 的预检保持一致。
    //
    // 只用 `#nodeToPlugin` 会漏掉"仅用 `defineNodes` 声明"的节点（它们登记在
    // `#declaredNodes`）。那样批量预检放行、单项注册时才被拒 —— 于是批次里
    // 第一个合法插件已经落表，调用方拿到异常却留下半批状态（实测复现）。
    const nodes = new Set([...this.#nodeToPlugin.keys(), ...this.#declaredNodes.keys()]);
    for (const plugin of plugins) {
      if (!plugin?.id) continue;
      if (ids.has(plugin.id)) throw new Error(`Syntax plugin already registered: ${plugin.id}`);
      ids.add(plugin.id);
      for (const node of new Set(syntaxNodeNames(plugin))) {
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
    this.#declaredNodes.clear();
    this.#imperative.clear();
    this.#tokens.clear();
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
    // 代号必须**全局单调**：临时实例若从 1 开始，声明式条目拿到的代号可能
    // 等于历史上已发出的代号。一旦某 id 先被不带 token 的 `dispose(id)` 摘掉、
    // 再经本方法以同一对象重新注册，旧句柄的代号就可能"碰巧对上"而误删新注册。
    next.#nextToken = this.#nextToken;
    // 先放入命令式条目，再放新的声明式条目；冲突由 preflight 统一抛错。
    for (const [id, plugin] of kept) {
      if (this.#imperative.has(id)) {
        next.register(plugin, "imperative");
        // 保留原代号：已发出的句柄在全量替换后仍然有效（它注册的条目没变）。
        const token = this.#tokens.get(id);
        if (token !== undefined) next.#tokens.set(id, token);
      }
    }
    next.registerAll(plugins, "declarative");

    this.#plugins.clear();
    this.#nodePolicies.clear();
    this.#nodeToPlugin.clear();
    this.#declaredNodes.clear();
    this.#imperative.clear();
    for (const [id, plugin] of next.#plugins) this.#plugins.set(id, plugin);
    for (const [name, policy] of next.#nodePolicies) this.#nodePolicies.set(name, policy);
    for (const [name, plugin] of next.#nodeToPlugin) this.#nodeToPlugin.set(name, plugin);
    for (const [name, plugin] of next.#declaredNodes) this.#declaredNodes.set(name, plugin);
    for (const id of next.#imperative) this.#imperative.add(id);
    // 代号跟着条目走：命令式条目保留原代号，声明式条目取临时实例分配的代号。
    this.#tokens.clear();
    for (const [id, token] of next.#tokens) this.#tokens.set(id, token);
    this.#nextToken = Math.max(this.#nextToken, next.#nextToken);
    return this;
  }

  /**
   * 注销单个插件。命令式注册的 `Disposable` 走这条路径；
   * 返回是否真的移除了某条注册（幂等，可重复调用）。
   */
  dispose(id: string, expected?: MarkdownSyntaxPlugin, token?: number): boolean {
    const plugin = this.#plugins.get(id);
    if (!plugin) return false;
    // 身份守卫：`replaceDeclarative` 之后，旧句柄不得摘掉后来注册的同名插件。
    if (expected && plugin !== expected) return false;
    // 代号守卫：同一对象的两次注册必须可区分，旧句柄只认自己那一次。
    if (token !== undefined && this.#tokens.get(id) !== token) return false;
    this.#plugins.delete(id);
    this.#imperative.delete(id);
    this.#tokens.delete(id);
    for (const nodeName of Object.keys(plugin.nodePolicies ?? {})) {
      if (this.#nodeToPlugin.get(nodeName) === plugin) this.#nodeToPlugin.delete(nodeName);
      this.#nodePolicies.delete(nodeName);
    }
    if (plugin.nodePolicy) {
      const nodeName = plugin.nodePolicy.nodeName;
      // 分派表与策略表都要清：只清策略会让节点名继续占用分派表，
      // 同一插件重新注册时被预检判为"节点已注册"而无法再次登记。
      if (this.#nodeToPlugin.get(nodeName) === plugin) this.#nodeToPlugin.delete(nodeName);
      this.#nodePolicies.delete(nodeName);
    }
    // 冲突表登记了该插件的**全部**节点名（defineNodes + 策略键），一并摘掉，
    // 否则节点名会永久占位、导致同一插件无法重新注册。
    for (const nodeName of syntaxNodeNames(plugin)) {
      if (this.#declaredNodes.get(nodeName) === plugin) this.#declaredNodes.delete(nodeName);
    }
    return true;
  }

  /**
   * 命令式注册并返回**幂等**句柄。
   *
   * 句柄持有本次注册的代号，因此：
   * - 重复 `dispose()` 只会成功一次（返回 `false` 表示"这次释放没有效果"）；
   * - 同一插件对象释放后重新注册，旧句柄再释放不会摘掉新注册。
   */
  registerImperative(plugin: MarkdownSyntaxPlugin): SyntaxPluginRegistrationHandle {
    this.register(plugin, "imperative");
    const token = this.#tokens.get(plugin.id);
    let released = false;
    return {
      dispose: (): boolean => {
        if (released) return false;
        released = true;
        return this.dispose(plugin.id, plugin, token);
      },
    };
  }

  /** 某条目当前的注册代号（测试与诊断用；不存在返回 `undefined`）。 */
  tokenOf(id: string): number | undefined {
    return this.#tokens.get(id);
  }

  get plugins(): readonly MarkdownSyntaxPlugin[] {
    return Object.freeze(Array.from(this.#plugins.values()));
  }

  /**
   * **仅声明式**注册的插件（命令式 `addSyntaxPlugin` 的条目不在内）。
   *
   * 全量替换的幂等判断必须用它：拿"声明式输入"和**全部**已注册插件比较，
   * 会在"同一插件对象先命令式注册、再作为声明式集合提交"时误判为无变化而提前返回，
   * 于是该条目仍留在命令式命名空间里 —— 释放命令式句柄就会把它摘掉，
   * 而调用方以为它已经是声明式清单的一员（实测：`add(p)` → `set([p])` 静默成功，
   * 随后释放句柄，p 就消失了）。
   *
   * @internal 只供编辑器侧的"全量替换幂等判断"使用，不属于插件作者契约。
   * 标为内部件而不是新增公开 API，因此本包只需 patch 版本。
   */
  get declarativePlugins(): readonly MarkdownSyntaxPlugin[] {
    return Object.freeze(
      Array.from(this.#plugins.entries())
        .filter(([id]) => !this.#imperative.has(id))
        .map(([, plugin]) => plugin),
    );
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
