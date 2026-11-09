import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyStyleProfileDocument, type StyleProfileDocument } from "@md-editor/ai/style";
import {
  clearPendingEditFeedback,
  flushEditFeedback,
  pendingEditFeedbackSize,
  rememberAcceptedAiText,
} from "../../../src/app/ai/style-learning/edit-feedback-buffer";

function documentWithWorkspace(): StyleProfileDocument {
  return {
    ...createEmptyStyleProfileDocument(),
    workspaces: [
      {
        id: "ws-1",
        rootPath: "/notes",
        linkState: "linked",
        samples: [],
        rules: [],
        editFeedback: [],
        roundCount: 1,
        changesSinceRound: 0,
      },
    ],
  };
}

beforeEach(() => clearPendingEditFeedback());

describe("edit feedback buffer", () => {
  it("I-7/U-EF-1: on save, edits to accepted AI text become features and the AI text is dropped", () => {
    const aiText = "我们用React写界面,然后打包.";
    rememberAcceptedAiText("ws-1", "post.md", aiText);
    expect(pendingEditFeedbackSize()).toBe(1);

    const next = flushEditFeedback(
      documentWithWorkspace(),
      "ws-1",
      "post.md",
      "# 标题\n\n我们用 React 写界面，然后打包。",
      "2026-11-09T00:00:00Z",
    );
    expect(next.workspaces[0]!.editFeedback).toEqual(
      expect.arrayContaining([
        { at: "2026-11-09T00:00:00Z", dimension: "cjkLatinSpacing", value: "spaced" },
        { at: "2026-11-09T00:00:00Z", dimension: "cjkPunctuationWidth", value: "fullwidth" },
      ]),
    );
    expect(pendingEditFeedbackSize()).toBe(0);
    // 持久化的文档里不包含 AI 原文或保存后的正文。
    expect(JSON.stringify(next)).not.toMatch(/React|界面|打包/u);
  });

  it("returns the same document when nothing was accepted or nothing changed", () => {
    const document = documentWithWorkspace();
    expect(flushEditFeedback(document, "ws-1", "post.md", "正文", "t")).toBe(document);
    rememberAcceptedAiText("ws-1", "post.md", "原样保留的一句话。");
    expect(flushEditFeedback(document, "ws-1", "post.md", "原样保留的一句话。", "t")).toBe(
      document,
    );
    expect(pendingEditFeedbackSize()).toBe(0);
  });

  it("clears pending AI text when style learning is turned off", () => {
    rememberAcceptedAiText("ws-1", "a.md", "一句。");
    rememberAcceptedAiText("ws-1", "b.md", "两句。");
    clearPendingEditFeedback();
    expect(pendingEditFeedbackSize()).toBe(0);
  });
});
