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

export function createAiCacheKey(input: AiCacheKeyInput): string {
  return JSON.stringify([
    input.namespace,
    input.provider ?? null,
    input.model ?? null,
    input.seed
  ]);
}
