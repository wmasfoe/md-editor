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
): void {
  if (alreadyRegistered.has(plugin.id) || builtins.some((builtin) => builtin.id === plugin.id)) {
    throw new Error(`Duplicate syntax: ${plugin.id}`);
  }
  const builtInNodes = new Set(builtins.flatMap((builtin) => syntaxNodeNames(builtin)));
  const conflicts = syntaxNodeNames(plugin).filter((name) => builtInNodes.has(name));
  if (conflicts.length > 0) {
    throw new Error(
      `Syntax node conflicts with a built-in plugin: ${plugin.id} (${conflicts.join(", ")})`,
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

  return {
    register(plugin: MarkdownSyntaxPlugin): SyntaxRegistrationHandle {
      // 顺序契约：校验必须在任何副作用之前。
      assertNoSyntaxConflicts(plugin, builtins, new Set(registered.keys()));
      registered.set(plugin.id, plugin);
      onChanged([...registered.values()]);
      return {
        dispose() {
          registered.delete(plugin.id);
          onChanged([...registered.values()]);
        },
      };
    },
    list(): readonly MarkdownSyntaxPlugin[] {
      return [...registered.values()];
    },
  };
}
