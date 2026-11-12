/**
 * 模型 changelog 的 raw 地址。
 * 仓库现为 inkpoint-editor/md-editor-models（默认分支 master）。
 * 旧的 wmasfoe/md-editor-models 地址会自动 301 到这里。
 */
export const MODEL_CHANGELOG_URL =
  "https://raw.githubusercontent.com/inkpoint-editor/md-editor-models/master/changelog.json";

/** 模型仓库主页，与 {@link MODEL_CHANGELOG_URL} 同属 inkpoint-editor/md-editor-models。 */
export const MODEL_REPO_URL = "https://github.com/inkpoint-editor/md-editor-models";

/** 根据 PR 编号构建 inkpoint-editor/md-editor-models 仓库的 Pull Request 页面直链 */
export function buildModelPrUrl(prNumber: number): string {
  return `${MODEL_REPO_URL}/pull/${prNumber}`;
}

export type JsonRecord = Record<string, unknown>;

/** 提取发布记录中的 PR 编号数组，优先读取 sourcePR，兼容历史或备选 sourcePr */
export function asPrNumbers(value: unknown): number[] {
  if (Array.isArray(value)) {
    const numbers = value
      .map((item) => (typeof item === "number" ? item : Number.parseInt(String(item), 10)))
      .filter((num) => Number.isInteger(num) && num > 0);
    return Array.from(new Set(numbers));
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return [value];
  }

  return [];
}

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
