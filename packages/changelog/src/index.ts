/**
 * @fileoverview 更新日志共享模型统一出口
 *
 * 官网（apps/site）与桌面端（apps/desktop）共用同一份解析与行内语义。
 */

export type { ChangelogEntry, ChangelogItem } from "./types.ts";
export { extractPrNumbers, findChangelogEntry, parseChangelog } from "./parse.ts";
export { tokenizeInlineMarkdown, type InlineToken } from "./inline.ts";
