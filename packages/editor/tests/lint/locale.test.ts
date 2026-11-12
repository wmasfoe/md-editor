import { EditorState } from "@codemirror/state";
import { createDocumentState } from "@md-editor/core";
import { createRendererTestHarness, type RendererTestHarness } from "../../src/testing.ts";
import { describe, expect, it } from "vitest";
import { lintLanguageField, setLintLanguageEffect } from "../../src/lint/markdown-lint-i18n.ts";
import { runMarkdownLint } from "../../src/lint/markdown-lint.ts";

const createState = (language: string) =>
  EditorState.create({
    doc: "#title",
    extensions: [lintLanguageField.init(() => language)],
  });
const messages = (state: EditorState) => runMarkdownLint(state);
const createHarness = (language: string) =>
  createRendererTestHarness({
    language,
    initialSnapshot: createDocumentState({ markdown: "#title", mode: "source" }).getSnapshot(),
    onEditorChange() {},
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
const rendererMessages = async (harness: RendererTestHarness) =>
  (await harness.renderer.runDocumentLint({ enableLinkCheck: false })).map((d) => d.message);

describe("instance lint language", () => {
  it("keeps diagnostic messages and fixes independent across states and updates", () => {
    const english = createState("en");
    const chinese = createState("zh");
    expect(messages(english).length).toBeGreaterThan(0);
    expect(messages(english)[0]?.message).not.toBe(messages(chinese)[0]?.message);
    expect(messages(english)[0]?.actions?.[0]?.name).not.toBe(
      messages(chinese)[0]?.actions?.[0]?.name,
    );
    const japanese = english.update({ effects: setLintLanguageEffect.of("ja") }).state;
    expect(messages(japanese)[0]?.message).not.toBe(messages(english)[0]?.message);
    expect(messages(chinese)[0]?.message).toBe(messages(createState("zh"))[0]?.message);
  });
});

it("routes renderer language changes without changing documents, history or another renderer", async () => {
  const first = createHarness("en");
  const second = createHarness("zh");
  try {
    const english = await rendererMessages(first);
    const chinese = await rendererMessages(second);
    expect(english).not.toEqual(chinese);
    expect(first.renderer.setLanguage("ja")).toEqual({ status: "applied" });
    expect(first.renderer.setLanguage("ja")).toEqual({ status: "noop" });
    expect(await rendererMessages(first)).not.toEqual(english);
    expect(await rendererMessages(second)).toEqual(chinese);
    expect(first.undo()).toBe(false);
    expect(first.probe().markdown).toBe("#title");
    const japanese = await rendererMessages(first);
    // Reconciliation replaces EditorState but must retain the view's language.
    const replacement = createDocumentState({ markdown: "#title", mode: "source" }).getSnapshot();
    expect(first.renderer.reconcile({ ...replacement, documentGeneration: 2 })).toEqual({
      status: "reconciled",
      strategy: "document-boundary",
    });
    expect(await rendererMessages(first)).toEqual(japanese);
    first.renderer.setLanguage(undefined);
    const hostLanguage = await rendererMessages(first);
    first.renderer.reconcile({ ...replacement, documentGeneration: 3 });
    expect(await rendererMessages(first)).toEqual(hostLanguage);
  } finally {
    first.renderer.destroy();
    second.renderer.destroy();
  }
  expect(first.renderer.setLanguage("en")).toEqual({ status: "destroyed" });
});
