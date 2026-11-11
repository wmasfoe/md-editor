/**
 * G004：只接受不会引入 Markdown 结构的 Unicode 字母、组合标记与数字。
 * Variation Selector 虽属于 Unicode Mark，但会改变前一个字符的呈现语义，
 * 因此与 emoji/ZWJ 一样保守回退到正常重建路径。
 */
export function isPlainTextInput(value: string): boolean {
  return /^[\p{L}\p{M}\p{N}]+$/u.test(value) && !/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(value);
}
