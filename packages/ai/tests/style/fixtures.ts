/**
 * 风格学习测试的公共构造器与语料。
 */
import type {
  StyleObservationRound,
  StyleRuleRecord,
  StyleSampleRecord,
  WorkspaceStyleProfileRecord,
} from "../../src/style/index.ts";

/** 约 260 字、中英文之间加空格、全角标点、短段落的中文技术散文 */
export function spacedTechArticle(topic: string, paragraphs = 4): string {
  const body = Array.from(
    { length: paragraphs },
    (_, index) =>
      `第 ${index + 1} 部分讲 ${topic} 的用法。我们先给结论，再解释 React 和 TypeScript 为什么这样设计。最后看一个 Vite 配置的例子，确认它能正常运行。`,
  );
  return [`# ${topic}`, "", ...body.flatMap((paragraph) => [paragraph, ""])].join("\n");
}

export function sample(id: string, overrides: Partial<StyleSampleRecord> = {}): StyleSampleRecord {
  return {
    id,
    relPath: `${id}.md`,
    sha256: `sha-${id}`,
    paragraphHashes: [`p-${id}-1`, `p-${id}-2`],
    eligible: true,
    stats: {},
    labels: {},
    ...overrides,
  };
}

export function round(
  roundNumber: number,
  value: string,
  supportSampleIds: readonly string[],
  aggregate?: number,
): StyleObservationRound {
  return {
    round: roundNumber,
    value,
    supportSampleIds,
    ...(aggregate === undefined ? {} : { aggregate }),
  };
}

export function activeRule(
  dimension: StyleRuleRecord["dimension"],
  value: string,
): StyleRuleRecord {
  return { dimension, value, status: "active", rounds: [] };
}

export function workspace(
  id: string,
  overrides: Partial<WorkspaceStyleProfileRecord> = {},
): WorkspaceStyleProfileRecord {
  return {
    id,
    rootPath: `/notes/${id}`,
    linkState: "linked",
    samples: [],
    rules: [],
    editFeedback: [],
    roundCount: 0,
    changesSinceRound: 0,
    ...overrides,
  };
}

export const FIVE_FILES = ["a", "b", "c", "d", "e"];
