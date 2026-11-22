/**
 * @file plugin-management.ts
 * @description 控制器语法插件注册协作器：增量注册（`use`）与全量替换（`setPlugins`）。
 *
 * 语义与生命周期契约（与拆分前一致）：
 * 1. 幂等守卫：全量替换前比对新旧插件实例，完全一致则跳过 Compartment 重配与重排；
 * 2. 原子化 Compartment 重构：同步更新 `SyntaxPluginRegistry`，按需重配 Lezer Markdown 语言
 *    与 `syntaxPluginRegistryFacet`，并派发 `refreshMarkdownParseCoverageEffect` /
 *    `refreshWysiwygProjectionEffect` 重绘投影；
 * 3. 零侵入：全程不销毁或替换 DOM 树，选区与历史栈完整无损。
 *
 * `SyntaxPluginRegistry` 与各 `Compartment` 由控制器持有，本模块只经显式上下文读写。
 */

import { markdown } from "@codemirror/lang-markdown";
import type { Compartment, StateEffect } from "@codemirror/state";
import type { Disposable } from "@md-editor/plugin-sdk";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { createMarkdownLanguageSupport } from "../../markdown/code-languages.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../markdown/extensions.ts";
import {
  refreshMarkdownParseCoverageEffect,
  syntaxPluginRegistryFacet,
} from "../../markdown/range-index.ts";
import type { MarkdownSyntaxPlugin, SyntaxPluginRegistry } from "@md-editor/plugin-sdk/syntax";
import { refreshWysiwygProjectionEffect } from "../../wysiwyg/state/types.ts";
import type { RendererViewAdapter } from "../types.ts";

export interface SyntaxPluginContext {
  readonly view: RendererViewAdapter;
  readonly registry: SyntaxPluginRegistry;
  readonly syntaxRegistryCompartment: Compartment;
  readonly markdownLanguageCompartment: Compartment;
  readonly useNativeCodeLanguages: boolean;
  readonly diagnostics: WysiwygDiagnostics;
}

/**
 * 增量注册插件：仅对含 `markdownExtension` 的"语法层面插件"重配 Lezer 语言分析器，
 * 其余只刷新 `syntaxPluginRegistryFacet` 与投影层。
 */
export function registerSyntaxPlugins(
  ctx: SyntaxPluginContext,
  plugins: readonly (MarkdownSyntaxPlugin | readonly MarkdownSyntaxPlugin[])[],
  origin: "declarative" | "imperative" = "declarative",
): void {
  const flattened: MarkdownSyntaxPlugin[] = [];
  for (const plugin of plugins) {
    if (Array.isArray(plugin)) {
      for (const p of plugin) {
        flattened.push(p);
      }
    } else if (plugin && typeof plugin === "object" && "id" in plugin) {
      flattened.push(plugin);
    }
  }
  if (flattened.length === 0) {
    return;
  }

  // 判断是否有真正扩展 Lezer Markdown 语法/词法分析器的插件（带 markdownExtension）
  const isSyntaxPlugin = flattened.some((plugin) => Boolean(plugin.markdownExtension));

  // **失败回滚**：注册表必须先写（下面构建语言扩展要读它），而构建扩展与
  // `dispatch` 都可能抛错 —— 视图解析新语言时若插件引用了不存在的 Lezer parser，
  // 会抛 "Position specified relative to unknown parser"，且这是**惰性**的：
  // 错误发生在 dispatch 期间的解析里，调用方拿不到句柄、桌面回滚也无从下手。
  // 结果就是失败的插件永久占用 ID，修正后同 ID 重试直接报 "already registered"（实测）。
  // 快照必须连注册代号一起还原，否则已发出的句柄在回滚后失效。
  const snapshot = ctx.registry.snapshot();
  try {
    ctx.registry.registerAll(flattened, origin);

    const effects: StateEffect<unknown>[] = [
      ctx.syntaxRegistryCompartment.reconfigure(syntaxPluginRegistryFacet.of(ctx.registry)),
    ];

    if (isSyntaxPlugin) {
      // 语法层面插件：需要重配 Lezer 语言分析器，并调度 AST RangeIndex 全量重新解析
      const pluginExtensions = ctx.registry.getMarkdownExtensions();
      const markdownExtensions = Object.freeze([...M1_MARKDOWN_EXTENSIONS, ...pluginExtensions]);
      effects.push(
        ctx.markdownLanguageCompartment.reconfigure(
          ctx.useNativeCodeLanguages
            ? createMarkdownLanguageSupport(
                { extensions: markdownExtensions, addKeymap: false },
                ctx.diagnostics,
              )
            : markdown({ extensions: markdownExtensions, addKeymap: false }),
        ),
        refreshMarkdownParseCoverageEffect.of(null),
      );
    }

    // 无论 UI 层面还是 AST 层面，均派发 refreshWysiwygProjectionEffect 触发投影层重新编译
    effects.push(refreshWysiwygProjectionEffect.of(null));

    ctx.view.dispatch({ effects });
  } catch (error) {
    ctx.registry.restore(snapshot);
    throw error;
  }
}

/**
 * 命令式注册的工厂：注册一次，返回带身份守卫的卸载句柄。
 *
 * 放在协作器里而不是 controller：注册语义属于本模块，controller 只做转发，
 * 也避免把销毁期判断写成两块重复代码。
 */
export function createImperativeSyntaxRegistration(
  ctx: SyntaxPluginContext,
  plugin: MarkdownSyntaxPlugin,
  isDestroyed: () => boolean,
): Disposable {
  registerSyntaxPlugins(ctx, [plugin], "imperative");
  // 句柄记住**本次**注册的代号：同一对象释放后重新注册时，旧句柄不得摘掉新注册。
  const token = ctx.registry.tokenOf(plugin.id);
  let released = false;
  return {
    dispose: () => {
      if (released) return;
      released = true;
      if (isDestroyed()) return;
      unregisterSyntaxPlugin(ctx, plugin, token);
    },
  };
}

/**
 * 反注册单个插件（`addSyntaxPlugin` 的 `Disposable` 走这条路径）。
 *
 * 身份守卫在 registry 内完成：若同名插件已被后来的注册替换，旧句柄不生效。
 */
export function unregisterSyntaxPlugin(
  ctx: SyntaxPluginContext,
  plugin: MarkdownSyntaxPlugin,
  token?: number,
): boolean {
  const wasSyntaxPlugin = Boolean(plugin.markdownExtension);
  if (!ctx.registry.dispose(plugin.id, plugin, token)) {
    return false;
  }

  const effects: StateEffect<unknown>[] = [
    ctx.syntaxRegistryCompartment.reconfigure(syntaxPluginRegistryFacet.of(ctx.registry)),
  ];

  if (wasSyntaxPlugin) {
    const markdownExtensions = Object.freeze([
      ...M1_MARKDOWN_EXTENSIONS,
      ...ctx.registry.getMarkdownExtensions(),
    ]);
    effects.push(
      ctx.markdownLanguageCompartment.reconfigure(
        ctx.useNativeCodeLanguages
          ? createMarkdownLanguageSupport(
              { extensions: markdownExtensions, addKeymap: false },
              ctx.diagnostics,
            )
          : markdown({ extensions: markdownExtensions, addKeymap: false }),
      ),
      refreshMarkdownParseCoverageEffect.of(null),
    );
  }

  effects.push(refreshWysiwygProjectionEffect.of(null));
  ctx.view.dispatch({ effects });
  return true;
}

/**
 * 全量替换已激活插件集合：实例清单一致时幂等跳过，否则原子重建 Compartment 链。
 */
export function replaceSyntaxPlugins(
  ctx: SyntaxPluginContext,
  plugins: readonly MarkdownSyntaxPlugin[],
): void {
  const flattened: MarkdownSyntaxPlugin[] = [];
  for (const plugin of plugins) {
    if (plugin && typeof plugin === "object" && "id" in plugin) {
      flattened.push(plugin);
    }
  }

  // 更新版本可保留 ID，但其解析器、投影或闭包已变化，必须重配新实例。
  //
  // 只比对**声明式**清单（不是全部插件）：否则"同一对象先命令式注册、再作为
  // 声明式集合提交"会被误判为无变化而提前返回，该条目仍留在命令式命名空间，
  // 释放命令式句柄就把它摘掉了。改成比声明式清单后，这种情况会进入
  // `replaceDeclarative` 的 ID 冲突校验并如实报错。
  const currentPlugins = ctx.registry.declarativePlugins;
  if (
    currentPlugins.length === flattened.length &&
    currentPlugins.every((curr, idx) => curr === flattened[idx])
  ) {
    return;
  }

  // **失败回滚**，理由与 `registerSyntaxPlugins` 相同：替换注册表之后构建语言扩展
  // 或 `dispatch` 期间的惰性解析都可能抛错，失败时不能让半替换的状态留在注册表里。
  const snapshot = ctx.registry.snapshot();
  try {
    // 全量原子替换注册中心插件
    ctx.registry.replaceDeclarative(flattened);

    // 组装新的 Lezer Markdown 语法扩展（内置基础扩展 + 已启用插件扩展）
    const pluginExtensions = ctx.registry.getMarkdownExtensions();
    const markdownExtensions = Object.freeze([...M1_MARKDOWN_EXTENSIONS, ...pluginExtensions]);

    const effects: StateEffect<unknown>[] = [
      ctx.syntaxRegistryCompartment.reconfigure(syntaxPluginRegistryFacet.of(ctx.registry)),
      ctx.markdownLanguageCompartment.reconfigure(
        ctx.useNativeCodeLanguages
          ? createMarkdownLanguageSupport(
              { extensions: markdownExtensions, addKeymap: false },
              ctx.diagnostics,
            )
          : markdown({ extensions: markdownExtensions, addKeymap: false }),
      ),
      refreshMarkdownParseCoverageEffect.of(null),
      refreshWysiwygProjectionEffect.of(null),
    ];

    ctx.view.dispatch({ effects });
  } catch (error) {
    ctx.registry.restore(snapshot);
    throw error;
  }
}
