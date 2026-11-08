/**
 * @file style/dimensions.ts
 * @module @md-editor/ai/style
 * @description
 * 风格维度目录：每个维度的类别、可选取值、渲染模板与注入优先级。
 *
 * - 统计维度（stat）由代码直接计算；
 * - 分类维度（class）由本地 Standard 模型在枚举中选择；
 * - 机械维度（mechanical）有确定的书写规则，纠错时用于误报过滤与风格建议。
 */

export const STAT_DIMENSION_IDS = [
  "paragraphLength",
  "sentenceLength",
  "headingDensity",
  "listUsage",
  "emphasisUsage",
  "cjkLatinSpacing",
  "cjkPunctuationWidth",
  "termScript",
] as const;

export const CLASS_DIMENSION_IDS = ["formality", "organization", "exampleUsage"] as const;

export type StatDimensionId = (typeof STAT_DIMENSION_IDS)[number];
export type ClassDimensionId = (typeof CLASS_DIMENSION_IDS)[number];
export type StyleDimensionId = StatDimensionId | ClassDimensionId;

/** 证据不足时的取值，不会生成规则 */
export const STYLE_UNKNOWN_VALUE = "unknown";

export interface StyleDimensionDescriptor {
  readonly id: StyleDimensionId;
  readonly kind: "stat" | "class";
  readonly mechanical: boolean;
  /** 设置页展示的维度名 */
  readonly label: string;
  /** 取值 -> 规则文字 */
  readonly templates: Readonly<Record<string, string>>;
  /** 前缀超长时按权重从高到低保留 */
  readonly weight: number;
}

export const STYLE_DIMENSIONS: Readonly<Record<StyleDimensionId, StyleDimensionDescriptor>> = {
  paragraphLength: {
    id: "paragraphLength",
    kind: "stat",
    mechanical: false,
    label: "段落长度",
    templates: {
      short: "偏好简短段落，一段只讲一件事。",
      medium: "段落长度适中。",
      long: "习惯写较长的段落，把相关论述放在一起。",
    },
    weight: 7,
  },
  sentenceLength: {
    id: "sentenceLength",
    kind: "stat",
    mechanical: false,
    label: "句子长度",
    templates: {
      short: "多用短句。",
      medium: "句子长度适中。",
      long: "常用较长的复合句。",
    },
    weight: 8,
  },
  headingDensity: {
    id: "headingDensity",
    kind: "stat",
    mechanical: false,
    label: "标题习惯",
    templates: {
      sparse: "很少使用小标题。",
      regular: "按主题适度使用小标题。",
      dense: "频繁使用小标题划分内容。",
    },
    weight: 4,
  },
  listUsage: {
    id: "listUsage",
    kind: "stat",
    mechanical: false,
    label: "列表习惯",
    templates: {
      rare: "很少使用列表，偏好连贯的段落。",
      regular: "适度使用列表。",
      frequent: "常用列表组织要点。",
    },
    weight: 5,
  },
  emphasisUsage: {
    id: "emphasisUsage",
    kind: "stat",
    mechanical: false,
    label: "强调习惯",
    templates: {
      rare: "很少使用加粗或斜体强调。",
      regular: "会用加粗标出关键词。",
    },
    weight: 2,
  },
  cjkLatinSpacing: {
    id: "cjkLatinSpacing",
    kind: "stat",
    mechanical: true,
    label: "中英文空格",
    templates: {
      spaced: "中文与英文、数字之间加空格。",
      unspaced: "中文与英文、数字之间不加空格。",
    },
    weight: 9,
  },
  cjkPunctuationWidth: {
    id: "cjkPunctuationWidth",
    kind: "stat",
    mechanical: true,
    label: "标点宽度",
    templates: {
      fullwidth: "中文语境使用全角标点。",
      halfwidth: "中文语境使用半角标点。",
    },
    weight: 9,
  },
  termScript: {
    id: "termScript",
    kind: "stat",
    mechanical: true,
    label: "术语写法",
    templates: {
      "keep-english": "技术术语保留英文原文，不翻译。",
      translate: "术语尽量使用中文译名。",
    },
    weight: 10,
  },
  formality: {
    id: "formality",
    kind: "class",
    mechanical: false,
    label: "正式程度",
    templates: {
      formal: "语气正式、书面。",
      neutral: "语气平实，介于正式与口语之间。",
      casual: "语气轻松、口语化。",
    },
    weight: 6,
  },
  organization: {
    id: "organization",
    kind: "class",
    mechanical: false,
    label: "组织方式",
    templates: {
      "conclusion-first": "先给结论，再解释原因。",
      "context-first": "先交代背景，再引出结论。",
      mixed: "结论与背景的先后顺序视内容而定。",
    },
    weight: 6,
  },
  exampleUsage: {
    id: "exampleUsage",
    kind: "class",
    mechanical: false,
    label: "举例习惯",
    templates: {
      frequent: "解释概念时倾向给出例子。",
      rare: "较少举例，直接陈述。",
    },
    weight: 3,
  },
};

/** 维度允许的取值（不含 unknown） */
export function styleDimensionValues(dimension: StyleDimensionId): readonly string[] {
  return Object.keys(STYLE_DIMENSIONS[dimension].templates);
}

export function isStyleDimensionId(value: unknown): value is StyleDimensionId {
  return typeof value === "string" && Object.hasOwn(STYLE_DIMENSIONS, value);
}

export function isKnownStyleValue(dimension: StyleDimensionId, value: string): boolean {
  return Object.hasOwn(STYLE_DIMENSIONS[dimension].templates, value);
}
