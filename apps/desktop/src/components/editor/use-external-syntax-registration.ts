/**
 * @file use-external-syntax-registration.ts
 * @description 把宿主 registrar 产出的外部插件注册到编辑器的**命令式**命名空间。
 *
 * 为什么单独成 hook：这是 G-8/G-10 的唯一落点，行为必须可测。
 * - 只走 `ports.addSyntaxPlugin`（命令式），绝不进 `plugins` prop（声明式全集）——
 *   否则切换任一内置插件开关时的全量替换会静默注销所有外部插件；
 * - 卸载或插件列表变化时逐个 `dispose()`，不留下悬挂注册。
 */
import { useLayoutEffect } from "react";

import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

/** 注册所需的最小端口面（便于测试注入 spy）。 */
export type SyntaxRegistrationPorts = Pick<CodeMirrorEditorPorts, "addSyntaxPlugin">;

/**
 * 把 `plugins` 逐个注册到端口，返回退订函数。
 *
 * 抽成纯函数是为了让"注册了哪些、按什么顺序、卸载时是否 dispose"能被直接断言，
 * 而不必渲染整棵 React 树。
 *
 * **失败必须回滚**：端口按插件 id 顺序注册，第 n 个被拒时前 n-1 个已经生效。
 * 若不回收，宿主会留下"只启用了一半"的状态，而调用方只看到一次抛错。
 * 这里逐项注册 + 失败时把已创建的句柄逆序释放，再把原异常抛出去。
 */
export function registerExternalSyntaxPlugins(
  ports: SyntaxRegistrationPorts,
  plugins: readonly MarkdownSyntaxPlugin[],
): () => void {
  const handles: { dispose(): void }[] = [];
  try {
    for (const plugin of plugins) {
      handles.push(ports.addSyntaxPlugin(plugin));
    }
  } catch (error) {
    // 逆序释放：后注册的通常依赖前者的节点/语言扩展。
    for (const handle of handles.toReversed()) {
      try {
        handle.dispose();
      } catch {
        // 回滚期间的二次失败不应掩盖原始错误。
      }
    }
    throw error;
  }
  return () => {
    for (const handle of handles) handle.dispose();
  };
}

/**
 * React 接线：ports 或插件列表变化时重新注册。
 *
 * `ports` 可能晚于插件列表到达（编辑器挂载是异步的），因此这里必须容忍 null。
 */
export function useExternalSyntaxRegistration(
  ports: SyntaxRegistrationPorts | null,
  plugins: readonly MarkdownSyntaxPlugin[],
): void {
  useLayoutEffect(() => {
    if (!ports) return undefined;
    return registerExternalSyntaxPlugins(ports, plugins);
  }, [ports, plugins]);
}
