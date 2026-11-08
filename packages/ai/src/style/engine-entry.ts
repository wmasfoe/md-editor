/**
 * @file style/engine-entry.ts
 * @module @md-editor/ai/style-engine
 * @description
 * 风格学习引擎入口（`@md-editor/ai/style-engine`）：散文抽取、统计、分类与学习轮次引擎。
 *
 * 依赖 `marked`，宿主应通过动态 import 在真正运行学习时再加载。
 */

export * from "./extraction.ts";
export * from "./statistics.ts";
export * from "./classify.ts";
export * from "./aggregate.ts";
export * from "./engine.ts";
