/**
 * @file style/index.ts
 * @module @md-editor/ai/style
 * @description
 * 用户风格学习的轻量入口（`@md-editor/ai/style`）：画像类型、维度目录、合并、渲染、闸门与身份校验。
 *
 * 不包含 Markdown 解析与学习引擎，引用它不会打包 `marked`。
 * 学习引擎在 `@md-editor/ai/style-engine`，只在真正运行学习时按需加载。
 */

export * from "./types.ts";
export * from "./dimensions.ts";
export * from "./hash.ts";
export * from "./lifecycle.ts";
export * from "./identity.ts";
export * from "./recompute.ts";
export * from "./merge.ts";
export * from "./render.ts";
export * from "./gate.ts";
export * from "./host.ts";
export * from "./sentences.ts";
export * from "./grammar-style.ts";
export * from "./edit-feedback.ts";
