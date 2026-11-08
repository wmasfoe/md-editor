/**
 * @file style/index.ts
 * @module @md-editor/ai/style
 * @description
 * 用户风格学习子入口（`@md-editor/ai/style`）。
 *
 * 只有桌面端使用风格学习；Web 与 uTools 引用主入口时不会打包这里的 Markdown 解析与学习引擎。
 * 主入口只依赖本目录中不含 `marked` 的模块（types、dimensions、merge、render、gate）。
 */

export * from "./types.ts";
export * from "./dimensions.ts";
export * from "./hash.ts";
export * from "./extraction.ts";
export * from "./statistics.ts";
export * from "./classify.ts";
export * from "./lifecycle.ts";
export * from "./aggregate.ts";
export * from "./identity.ts";
export * from "./merge.ts";
export * from "./render.ts";
export * from "./gate.ts";
export * from "./host.ts";
export * from "./engine.ts";
