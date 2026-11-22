/**
 * @file syntax-conflict-validation.ts
 * @description 外部语法插件注册前的两条冲突校验（G-11）。
 *
 * 抽成独立模块的原因：这两条校验是"外部插件不能劫持内置语法"的唯一防线，
 * 但此前它们内联在 `useExternalPlugins` 的 effect 里，测试只能对着测试自己写的
 * 假校验断言（自证循环），删掉生产代码也照样绿。
 *
 * 校验顺序是契约的一部分：**先校验、后注册**。失败时必须一次注册都不发生，
 * 否则会留下"注册了但随后抛错"的半状态。
 */

import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

/**
 * 一个插件占用的语法节点名集合。
 *
 * 三种来源都要算上：`defineNodes`（对象或字符串形态）、`nodePolicies` 的键、
 * 以及 `nodePolicy.nodeName`。少算任何一路都会让冲突校验出现绕过口。
 */
export function syntaxNodeNames(plugin: MarkdownSyntaxPlugin): string[] {
  const extension = plugin.markdownExtension;
  const definitions = extension && !Array.isArray(extension) ? extension.defineNodes : undefined;
  return [
    ...(definitions ?? []).map((node) => (typeof node === "string" ? node : node.name)),
    ...Object.keys(plugin.nodePolicies ?? {}),
    ...(plugin.nodePolicy ? [plugin.nodePolicy.nodeName] : []),
  ];
}

/**
 * 校验待注册插件与内置插件之间是否存在 id 或节点冲突。
 *
 * @throws 冲突时抛错，错误信息里带上冲突的具体名字，便于宿主定位。
 */
export function assertNoSyntaxConflicts(
  plugin: MarkdownSyntaxPlugin,
  builtins: readonly MarkdownSyntaxPlugin[],
  alreadyRegistered: ReadonlySet<string>,
  /** 已注册**外部**插件的节点名（此前只比对 id，导致两个外部插件可声明同一节点）。 */
  registeredNodes: ReadonlySet<string> = new Set(),
): void {
  if (alreadyRegistered.has(plugin.id) || builtins.some((builtin) => builtin.id === plugin.id)) {
    throw new Error(`Duplicate syntax: ${plugin.id}`);
  }
  const builtInNodes = new Set(builtins.flatMap((builtin) => syntaxNodeNames(builtin)));
  const ownNodes = syntaxNodeNames(plugin);

  // 两条消息刻意分开：撞内置插件是"劫持内置语法"，撞已注册外部插件是"外部插件互相打架"，
  // 宿主的处置方式不同（前者永远不允许，后者取决于启用清单）。
  const builtInConflicts = ownNodes.filter((name) => builtInNodes.has(name));
  if (builtInConflicts.length > 0) {
    throw new Error(
      `Syntax node conflicts with a built-in plugin: ${plugin.id} (${builtInConflicts.join(", ")})`,
    );
  }
  const externalConflicts = ownNodes.filter((name) => registeredNodes.has(name));
  if (externalConflicts.length > 0) {
    throw new Error(
      `Syntax node already registered by another plugin: ${plugin.id} (${externalConflicts.join(", ")})`,
    );
  }
}

/** 注册句柄（与 `plugin-host` 的 `syntax.register` 契约一致）。 */
export interface SyntaxRegistrationHandle {
  dispose(): void;
}

/**
 * 生产版注册器：**先校验、后落表**。
 *
 * 抽成工厂而不是留在 hook 的 effect 里，是因为内联实现无法被测试直接触达 ——
 * 删掉那一行 `assertNoSyntaxConflicts(...)` 不会有任何测试变红（审计已实证）。
 * 现在 hook 调用它、测试也调用它，两边是同一份代码。
 *
 * @param builtins 内置插件（id 与语法节点都不得被外部插件占用）
 * @param onChanged 注册表变化时回调（宿主用它同步到编辑器）
 */
export function createSyntaxRegistrar(
  builtins: readonly MarkdownSyntaxPlugin[],
  onChanged: (plugins: readonly MarkdownSyntaxPlugin[]) => void,
) {
  const registered = new Map<string, MarkdownSyntaxPlugin>();
  /** 已注册外部插件占用的节点名（跨插件冲突校验用）。 */
  const registeredNodes = (): Set<string> =>
    new Set([...registered.values()].flatMap((plugin) => syntaxNodeNames(plugin)));

  return {
    register(plugin: MarkdownSyntaxPlugin): SyntaxRegistrationHandle {
      // 顺序契约：校验必须在任何副作用之前。
      assertNoSyntaxConflicts(plugin, builtins, new Set(registered.keys()), registeredNodes());
      registered.set(plugin.id, plugin);
      onChanged([...registered.values()]);
      return {
        dispose() {
          // 身份守卫：只删**本句柄注册的那个实例**。
          // 只按 id 删会让"同 ID 换实例"时旧句柄误删新实例（插件莫名消失）。
          if (registered.get(plugin.id) !== plugin) return;
          registered.delete(plugin.id);
          onChanged([...registered.values()]);
        },
      };
    },
    /**
     * 批量注册：**先整批校验、再统一落表**。
     *
     * 逐项 `register` 的话，第 2 个被拒时第 1 个已经落表，宿主留下"只启用了一半"
     * 的半批状态。这里先在临时集合上跑完整批校验，全部通过后才写入并回调一次。
     *
     * @returns 与入参一一对应的句柄（可独立释放）。
     * @throws 任一冲突时抛错，且**不产生任何副作用**（注册表与回调都不变）。
     */
    registerAll(plugins: readonly MarkdownSyntaxPlugin[]): SyntaxRegistrationHandle[] {
      const candidateIds = new Set(registered.keys());
      const candidateNodes = new Set(registeredNodes());
      for (const plugin of plugins) {
        assertNoSyntaxConflicts(plugin, builtins, candidateIds, candidateNodes);
        candidateIds.add(plugin.id);
        for (const node of syntaxNodeNames(plugin)) candidateNodes.add(node);
      }

      // 校验全部通过：一次性落表并只回调一次。
      for (const plugin of plugins) registered.set(plugin.id, plugin);
      onChanged([...registered.values()]);

      return plugins.map((plugin) => ({
        dispose() {
          if (registered.get(plugin.id) !== plugin) return;
          registered.delete(plugin.id);
          onChanged([...registered.values()]);
        },
      }));
    },
    list(): readonly MarkdownSyntaxPlugin[] {
      return [...registered.values()];
    },
  };
}
