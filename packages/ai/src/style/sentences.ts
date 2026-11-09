/**
 * @file style/sentences.ts
 * @module @md-editor/ai/style
 * @description 中英文句子切分（基于 `Intl.Segmenter`，无第三方依赖）。
 */

const sentenceSegmenter = new Intl.Segmenter("zh", { granularity: "sentence" });

/** 按句切分，去掉空句 */
export function splitStyleSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const { segment } of sentenceSegmenter.segment(text)) {
    const sentence = segment.trim();
    if (sentence) {
      sentences.push(sentence);
    }
  }
  return sentences;
}
