/**
 * @file format-bytes.ts
 * @description 字节数人类可读格式化。自 portal.ts 迁出：发布领域逻辑不应依赖 HTML 展示模块。
 */

/**
 * 格式化字节
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
