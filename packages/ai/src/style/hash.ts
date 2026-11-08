/**
 * @file style/hash.ts
 * @module @md-editor/ai/style
 * @description
 * 风格学习使用的文本归一化与非加密 hash。
 *
 * 这些 hash 只用于“同一段文字是否还在”的身份判断和 AI 采纳段排除，不承担安全用途，
 * 因此使用同步、零依赖的 53 位 cyrb53 算法。归一化规则带版本前缀，规则变化时旧 hash 自然失配。
 */

const NORMALIZATION_VERSION = "n1";

/** 折叠空白并去掉首尾空白；大小写与标点保持原样，避免把不同写法判成同一句 */
export function normalizeStyleText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** cyrb53：对字符串计算 53 位 hash，返回带版本前缀的十六进制串 */
export function hashStyleText(text: string): string {
  const input = normalizeStyleText(text);
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  const value = 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0);
  return `${NORMALIZATION_VERSION}:${value.toString(16)}`;
}
