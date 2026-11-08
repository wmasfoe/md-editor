/**
 * @file style/types.ts
 * @module @md-editor/ai/style
 * @description
 * 用户写作风格画像的领域类型。
 *
 * 画像分三层，按维度逐级覆盖：用户自定义 > 工作区（目录）画像 > 全局画像。
 * AI 画像只存维度的枚举取值与证据样本 id，规则文字由代码模板渲染，
 * 因此人物、项目、事实等内容不会进入 AI 画像。自定义层允许用户自由书写。
 */

import type { ClassDimensionId, StatDimensionId, StyleDimensionId } from "./dimensions.ts";

/** 落盘文档版本，与 Rust `style_learning::store` 校验的版本一致 */
export const STYLE_DOCUMENT_VERSION = 1;

export type StyleRuleStatus = "draft" | "active" | "retired";

/** 一次汇总轮对某个维度的观察结果 */
export interface StyleObservationRound {
  readonly round: number;
  /** 本轮得出的取值；`unknown` 表示证据不足 */
  readonly value: string;
  /** 支持该取值的样本 id */
  readonly supportSampleIds: readonly string[];
  /** 统计维度的聚合值，用于判断多轮之间是否稳定 */
  readonly aggregate?: number;
}

/** 某一层画像在某个维度上的规则记录 */
export interface StyleRuleRecord {
  readonly dimension: StyleDimensionId;
  /** 生效或候选的取值 */
  readonly value: string;
  readonly status: StyleRuleStatus;
  /** 只保留最近若干轮观察 */
  readonly rounds: readonly StyleObservationRound[];
}

/** 单个样本的统计值；weight 为证据量（字符数或边界数），用于跨样本加权聚合 */
export interface StyleSampleStat {
  readonly value: number;
  readonly weight: number;
}

/** 参与学习的样本。只存 hash 与派生特征，不存原文 */
export interface StyleSampleRecord {
  readonly id: string;
  /** 以 `/` 分隔的工作区相对路径 */
  readonly relPath: string;
  readonly sha256: string;
  /** 段落归一化 hash，用于目录身份校验与找回 */
  readonly paragraphHashes: readonly string[];
  /** 散文是否足够参与统计；不足的文件也记录下来，避免每次重新读取 */
  readonly eligible: boolean;
  readonly stats: Partial<Record<StatDimensionId, StyleSampleStat>>;
  /** 本地模型分类结果；未分类时为空对象 */
  readonly labels: Partial<Record<ClassDimensionId, string>>;
}

/** 采纳 AI 建议后用户修改的特征（只存特征，不存文本） */
export interface StyleEditFeatureRecord {
  readonly at: string;
  readonly dimension: StyleDimensionId;
  readonly value: string;
}

export type StyleLinkState = "linked" | "unlinked";

/** 一个工作区（目录）的 AI 画像 */
export interface WorkspaceStyleProfileRecord {
  readonly id: string;
  readonly rootPath: string;
  readonly linkState: StyleLinkState;
  readonly unlinkedSince?: string;
  /** 最近一次自动找回前的根目录，用于在设置页撤销找回 */
  readonly relinkedFrom?: { readonly rootPath: string; readonly at: string };
  readonly samples: readonly StyleSampleRecord[];
  readonly rules: readonly StyleRuleRecord[];
  readonly editFeedback: readonly StyleEditFeatureRecord[];
  /** 已完成的汇总轮数 */
  readonly roundCount: number;
  /** 上一轮之后累计的样本变化数（新增、修改、删除） */
  readonly changesSinceRound: number;
  readonly lastRoundAt?: string;
}

/** 由多个工作区画像推导出的全局画像 */
export interface GlobalStyleProfileRecord {
  readonly rules: readonly StyleRuleRecord[];
  readonly roundCount: number;
}

/** 用户自定义规则 */
export type CustomStyleRule =
  /** 覆盖某个维度；`none` 表示停用该维度 */
  | {
      readonly kind: "dimension";
      readonly id: string;
      readonly dimension: StyleDimensionId;
      readonly value: string;
    }
  /** 自由文本，追加在画像末尾，不覆盖任何维度 */
  | { readonly kind: "note"; readonly id: string; readonly text: string };

/** 自定义层停用某个维度时使用的取值 */
export const STYLE_DIMENSION_DISABLED = "none";

/** 画像文档（“清除风格学习数据”会删除它） */
export interface StyleProfileDocument {
  readonly version: typeof STYLE_DOCUMENT_VERSION;
  /** 写入序号，由存储层在每次成功保存时递增；用于拒绝基于过期副本的写入 */
  readonly revision?: number;
  /** 数据代次：清除数据时换新；跨代次的学习结果一律丢弃，避免把已清除的数据写回来 */
  readonly epoch?: string;
  readonly workspaces: readonly WorkspaceStyleProfileRecord[];
  readonly global: GlobalStyleProfileRecord;
  readonly custom: readonly CustomStyleRule[];
  /** 采纳过的 AI 文本的句子 hash：workspaceId -> relPath -> hashes */
  readonly aiSegments: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

/** 排除列表文档（清除学习数据时保留）：工作区根路径 -> 工作区相对路径列表 */
export interface StyleExclusionsDocument {
  readonly version: typeof STYLE_DOCUMENT_VERSION;
  readonly workspaces: Readonly<Record<string, readonly string[]>>;
}

export type StyleLayer = "global" | "workspace" | "custom";

/** 合并后的一条规则（注入 prompt 前的最终形态） */
export interface MergedStyleRule {
  readonly layer: StyleLayer;
  /** 自由文本规则没有维度 */
  readonly dimension?: StyleDimensionId;
  readonly value?: string;
  readonly text: string;
}

/** 三层合并后的画像 */
export interface MergedStyleProfile {
  readonly rules: readonly MergedStyleRule[];
}

export function createEmptyStyleProfileDocument(): StyleProfileDocument {
  return {
    version: STYLE_DOCUMENT_VERSION,
    epoch: globalThis.crypto.randomUUID(),
    workspaces: [],
    global: { rules: [], roundCount: 0 },
    custom: [],
    aiSegments: {},
  };
}

export function createEmptyStyleExclusionsDocument(): StyleExclusionsDocument {
  return { version: STYLE_DOCUMENT_VERSION, workspaces: {} };
}
