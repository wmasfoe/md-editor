export const MODEL_CHANGELOG_URL =
  "https://raw.githubusercontent.com/wmasfoe/md-editor-models/master/changelog.json";

export type JsonRecord = Record<string, unknown>;

/** 将未知值收窄为页面可安全读取的普通对象。 */
export function asJsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** 缺失或非数组字段视为空；数组中的非对象项不参与结构化渲染。 */
export function asJsonRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asJsonRecord(item);
        return record ? [record] : [];
      })
    : [];
}

/** 只渲染非空文本，其他类型与空字符串保持缺省。 */
export function asDisplayText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text || null;
}
