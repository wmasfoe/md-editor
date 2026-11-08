import { describe, expect, it } from "vitest";

import { STANDARD_LOCAL_MODEL_ID } from "../../src/index.ts";
import {
  MAX_CHUNKS_PER_SAMPLE,
  STYLE_CLASSIFY_CHUNK_CHARS,
  STYLE_CLASSIFY_GBNF,
  buildStyleClassifyRequest,
  chunkStyleProse,
  parseStyleClassifyOutput,
  voteStyleLabels,
} from "../../src/style/index.ts";

describe("style classification", () => {
  it("U-CL-1: requests only the local Standard model with prose and an enum grammar", () => {
    const request = buildStyleClassifyRequest("一段正文。");
    expect(request.modelId).toBe(STANDARD_LOCAL_MODEL_ID);
    expect(request.task).toBe("style-analysis");
    expect(request.messages?.[1]).toEqual({ role: "user", content: "一段正文。" });
    expect(JSON.stringify(request)).not.toMatch(/\.md|\/notes\//u);
    expect(request.grammar).toBe(STYLE_CLASSIFY_GBNF);
    expect(STYLE_CLASSIFY_GBNF).toContain('"formality=" formality-value');
    expect(STYLE_CLASSIFY_GBNF).toContain(
      'formality-value ::= "formal" | "neutral" | "casual" | "unknown"',
    );
  });

  it("U-CL-1: parses enum values and maps anything else to unknown", () => {
    expect(
      parseStyleClassifyOutput("formality=formal;organization=conclusion-first;exampleUsage=rare"),
    ).toEqual({ formality: "formal", organization: "conclusion-first", exampleUsage: "rare" });
    expect(parseStyleClassifyOutput("formality=poetic;organization=;garbage")).toEqual({
      formality: "unknown",
      organization: "unknown",
      exampleUsage: "unknown",
    });
  });

  it("U-CL-1: chunks prose within the size limit and caps chunks per sample", () => {
    const paragraph = "字".repeat(900);
    const chunks = chunkStyleProse(Array.from({ length: 10 }, () => paragraph));
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_SAMPLE);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(STYLE_CLASSIFY_CHUNK_CHARS);
    }
    expect(chunkStyleProse(["字".repeat(5000)])[0]).toHaveLength(STYLE_CLASSIFY_CHUNK_CHARS);
  });

  it("votes per dimension and treats ties as unknown", () => {
    expect(
      voteStyleLabels([
        { formality: "formal", organization: "mixed" },
        { formality: "formal", organization: "context-first" },
        { formality: "casual", organization: "unknown" },
      ]),
    ).toEqual({ formality: "formal", organization: "unknown", exampleUsage: "unknown" });
  });
});
