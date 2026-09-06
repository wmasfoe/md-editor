/**
 * 官网 AI 展区两阶段连贯流（修病句 → 灵犀续写）预设数据与坐标生成器
 */

export interface AiGrammarItem {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly originalText: string;
  readonly explanation: string;
}

export interface AiContinuationStep {
  readonly stepIndex: number;
  readonly text: string;
}

export interface AiShowcaseFlowData {
  readonly initialMarkdown: string;
  readonly grammarItems: readonly AiGrammarItem[];
  readonly continuationOnlyMarkdown: string;
  readonly continuationSteps: readonly AiContinuationStep[];
}

export type AiShowcaseStage = "grammar" | "continuation";

function buildGrammarItems(
  text: string,
  rawItems: readonly { originalText: string; replacement: string; explanation: string }[],
): AiGrammarItem[] {
  let searchCursor = 0;
  const items: AiGrammarItem[] = [];

  for (const raw of rawItems) {
    const from = text.indexOf(raw.originalText, searchCursor);
    if (from === -1) {
      throw new Error(`Sample text does not contain target: "${raw.originalText}"`);
    }
    const to = from + raw.originalText.length;
    items.push({
      from,
      to,
      text: raw.replacement,
      originalText: raw.originalText,
      explanation: raw.explanation,
    });
    searchCursor = to;
  }

  return items;
}

const ZH_GRAMMAR_TEXT =
  "在数字时代的浪潮中，我们常常遗忘了书写的本真. 纸张与墨水的触感，渐渐被机械的敲击声所代取，然而真正的思考，往往需要一份从容与沉静。";

const EN_GRAMMAR_TEXT =
  "In an era of relentless distraction, true thinking demand a quiet sanctuary. Between thoughtful margins thoughts crystallize into lasting prose.";

export const SHOWCASE_AI_FLOW_DATA: Record<"zh" | "en", AiShowcaseFlowData> = {
  zh: {
    initialMarkdown: ZH_GRAMMAR_TEXT,
    grammarItems: buildGrammarItems(ZH_GRAMMAR_TEXT, [
      {
        originalText: ".",
        replacement: "。",
        explanation: "半角英文句号规范为中文全角句号",
      },
      {
        originalText: "所代取",
        replacement: "所取代",
        explanation: "纠正动宾语序倒装，使行文更地道",
      },
      {
        originalText: "，然而",
        replacement: "；然而",
        explanation: "转折长复句改用分号断句，语意更沉着",
      },
    ]),
    continuationOnlyMarkdown: "写作本是一场沉静的对话。",
    continuationSteps: [
      {
        stepIndex: 0,
        text: "在宣纸方寸之间，",
      },
      {
        stepIndex: 1,
        text: "任由思绪静静流淌，",
      },
      {
        stepIndex: 2,
        text: "重拾落笔成章的纯粹愉悦。",
      },
    ],
  },
  en: {
    initialMarkdown: EN_GRAMMAR_TEXT,
    grammarItems: buildGrammarItems(EN_GRAMMAR_TEXT, [
      {
        originalText: "demand",
        replacement: "demands",
        explanation: "Subject-verb agreement: singular subject requires 'demands'",
      },
      {
        originalText: "thoughts",
        replacement: ", thoughts",
        explanation: "Introductory prepositional phrase requires a trailing comma",
      },
      {
        originalText: "lasting prose.",
        replacement: "enduring prose.",
        explanation: "Refined lexical choice to match literary tone",
      },
    ]),
    continuationOnlyMarkdown: "Writing is a quiet conversation with oneself.",
    continuationSteps: [
      {
        stepIndex: 0,
        text: " With each stroke,",
      },
      {
        stepIndex: 1,
        text: " ideas find their quiet form,",
      },
      {
        stepIndex: 2,
        text: " anchored in enduring clarity.",
      },
    ],
  },
};
