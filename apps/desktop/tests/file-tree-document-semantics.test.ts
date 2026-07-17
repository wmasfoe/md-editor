import type { FileTreeMutationResult } from "@md-editor/file-system";
import { beforeEach, describe, expect, it } from "vitest";
import { runtime } from "../src/app/runtime/editor-runtime";
import { applyFileTreeMutation } from "../src/app/stores/file-tree-store";

const folder: FileTreeMutationResult["folder"] = {
  rootPath: "/docs",
  rootName: "docs",
  tree: { kind: "directory", name: "docs", path: "/docs", children: [] },
};

describe("file-tree document semantics", () => {
  beforeEach(() => {
    runtime.document.replaceDocument(
      { markdown: "saved\n", savedMarkdown: "saved\n", filePath: "/docs/open.md" },
      { kind: "command", commandId: "test.reset" },
    );
  });

  it("uses metadata-only setDocumentPath for rename and preserves dirty generation", () => {
    runtime.document.applyEditorChange("dirty\n", {
      kind: "renderer",
      clientId: "file-tree-document-semantics",
      sequence: 1,
    });
    const before = runtime.document.getSnapshot();
    const transitionKinds: string[] = [];
    const unsubscribe = runtime.document.subscribeTransitions((event) => {
      transitionKinds.push(event.transition.kind);
    });

    applyFileTreeMutation({ folder, affectedPath: "/docs/renamed.md" }, "/docs/open.md");
    unsubscribe();

    expect(runtime.document.getSnapshot()).toMatchObject({
      markdown: "dirty\n",
      savedMarkdown: "saved\n",
      filePath: "/docs/renamed.md",
      isDirty: true,
      documentGeneration: before.documentGeneration,
      contentRevision: before.contentRevision,
    });
    expect(transitionKinds).toEqual(["metadata"]);
  });

  it("uses one document boundary when deletion removes the open file", () => {
    const before = runtime.document.getSnapshot();
    const transitionKinds: string[] = [];
    const unsubscribe = runtime.document.subscribeTransitions((event) => {
      transitionKinds.push(event.transition.kind);
    });

    applyFileTreeMutation({ folder, affectedPath: null }, "/docs/open.md");
    unsubscribe();

    expect(runtime.document.getSnapshot()).toMatchObject({
      markdown: "",
      savedMarkdown: "",
      filePath: null,
      isDirty: false,
      documentGeneration: before.documentGeneration + 1,
    });
    expect(transitionKinds).toEqual(["document-replace"]);
  });
});
