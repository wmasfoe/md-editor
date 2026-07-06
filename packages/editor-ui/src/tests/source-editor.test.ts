import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceEditorSource = readFileSync(
  new URL("../components/SourceEditor.tsx", import.meta.url),
  "utf8"
);
const sourceEditorStyles = readFileSync(
  new URL("../components/SourceEditor.css", import.meta.url),
  "utf8"
);

describe("source editor UI contract", () => {
  it("keeps source mode visually wrapped without changing document line numbers", () => {
    expect(sourceEditorSource).toContain("EditorView.lineWrapping");
    expect(sourceEditorStyles).toContain(".source-editor .cm-content.cm-lineWrapping");
    expect(sourceEditorStyles).toContain("overflow-wrap: anywhere;");
  });

  it("keeps source search in the editor top panel", () => {
    const replaceInputRule = sourceEditorStyles.match(
      /\.source-editor \.cm-panel\.cm-search input\[name="replace"\] \{(?<body>[^}]+)\}/u
    );
    const replaceButtonsRule = sourceEditorStyles.match(
      /\.source-editor \.cm-panel\.cm-search button\[name="replace"\],[\s\S]+?button\[name="replaceAll"\] \{(?<body>[^}]+)\}/u
    );

    expect(sourceEditorSource).toContain("search({ top: true })");
    expect(sourceEditorStyles).toContain(".source-editor .cm-panels-top");
    expect(sourceEditorStyles).toContain("min-height: 42px;");
    expect(replaceInputRule?.groups?.body).toContain("display: none;");
    expect(replaceButtonsRule?.groups?.body).toContain("display: none;");
  });

  it("keeps source line numbers out of text selection", () => {
    const gutterRule = sourceEditorStyles.match(/\.source-editor \.cm-gutters \{(?<body>[^}]+)\}/u);
    const gutterElementRule = sourceEditorStyles.match(
      /\.source-editor \.cm-gutterElement \{(?<body>[^}]+)\}/u
    );

    expect(gutterRule?.groups?.body).toContain("user-select: none;");
    expect(gutterRule?.groups?.body).toContain("-webkit-user-select: none;");
    expect(gutterElementRule?.groups?.body).toContain("user-select: none;");
    expect(gutterElementRule?.groups?.body).toContain("-webkit-user-select: none;");
  });

  it("styles Markdown semantics without hiding source markers", () => {
    expect(sourceEditorSource).toContain("syntaxHighlighting(sourceMarkdownHighlightStyle)");
    expect(sourceEditorSource).toContain("tags.heading1");
    expect(sourceEditorSource).toContain("tags.heading6");
    expect(sourceEditorSource).toContain("tags.monospace");
    expect(sourceEditorSource).toContain("tags.strong");
    expect(sourceEditorSource).toContain("tags.emphasis");
    expect(sourceEditorSource).not.toContain("display: \"none\"");
    expect(sourceEditorSource).not.toContain("visibility: \"hidden\"");
  });
});
