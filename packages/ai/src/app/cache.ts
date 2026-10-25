/**
 * @file app/cache.ts
 * @module @md-editor/ai
 * @description
 * 冲突抗性的确定性 AI 请求缓存键构建器（不持有底层存储实例，供各端按需挂载内存或持久化缓存）。
 */

export interface AiCacheKeyInput {
  readonly namespace: string;
  readonly seed: string;
  readonly model?: string;
  readonly provider?: string;
}

export interface AiCacheEntry<TValue = unknown> {
  readonly key: string;
  readonly value: TValue;
  readonly createdAt: number;
}

/**
 * 生成防分隔符碰撞的标准化缓存键字符串。
 */
export function createAiCacheKey(input: AiCacheKeyInput): string {
  return JSON.stringify([input.namespace, input.provider ?? null, input.model ?? null, input.seed]);
}
