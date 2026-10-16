/**
 * @file plugin-management.ts
 * @description 控制器语法插件注册协作器：增量注册（`use`）与全量替换（`setPlugins`）。
 *
 * 语义与生命周期契约（与拆分前一致）：
 * 1. 幂等守卫：全量替换前比对新旧插件 ID 清单，完全一致则跳过 Compartment 重配与重排；
 * 2. 原子化 Compartment 重构：同步更新 `SyntaxPluginRegistry`，按需重配 Lezer Markdown 语言
 *    与 `syntaxPluginRegistryFacet`，并派发 `refreshMarkdownParseCoverageEffect` /
 *    `refreshWysiwygProjectionEffect` 重绘投影；
 * 3. 零侵入：全程不销毁或替换 DOM 树，选区与历史栈完整无损。
 *
 * `SyntaxPluginRegistry` 与各 `Compartment` 由控制器持有，本模块只经显式上下文读写。
 */

import { markdown } from "@codemirror/lang-markdown";
import type { Compartment, StateEffect } from "@codemirror/state";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { createMarkdownLanguageSupport } from "../../markdown/code-languages.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../markdown/extensions.ts";
import {
  refreshMarkdownParseCoverageEffect,
  syntaxPluginRegistryFacet,
} from "../../markdown/range-index.ts";
import type { MarkdownSyntaxPlugin } from "../../plugins/syntax-plugin.ts";
import type { SyntaxPluginRegistry } from "../../plugins/syntax-registry.ts";
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

  ctx.registry.registerAll(flattened);

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
}

/**
 * 全量替换已激活插件集合：ID 清单一致时幂等跳过，否则原子重建 Compartment 链。
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

  // 检查是否与当前注册表已有的插件一致（按 id 顺序与内容比较）
  const currentPlugins = ctx.registry.plugins;
  if (
    currentPlugins.length === flattened.length &&
    currentPlugins.every((curr, idx) => curr.id === flattened[idx]?.id)
  ) {
    return;
  }

  // 全量原子替换注册中心插件
  ctx.registry.setPlugins(flattened);

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
}
