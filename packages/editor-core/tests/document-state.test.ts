import { describe, expect, it } from "vitest";
import {
  createCommandRegistry,
  createDocumentState,
  createFeatureRegistry,
  createKeymapRegistry,
  switchEditorModeSafely,
} from "../src";

describe("DocumentState", () => {
  it("starts clean for a new document", () => {
    const document = createDocumentState({ markdown: "# Draft" });

    expect(document.getSnapshot()).toMatchObject({
      markdown: "# Draft",
      savedMarkdown: "# Draft",
      filePath: null,
      mode: "wysiwyg",
      isDirty: false,
    });
  });

  it("tracks dirty edits and clears dirty state after save", () => {
    const document = createDocumentState({ markdown: "One" });

    expect(
      document.applyEditorChange("Two", {
        kind: "renderer",
        clientId: "document-state-test",
        sequence: 1,
      }).status,
    ).toBe("applied");
    const checkpoint = document.beginSave({ kind: "prompt" });
    expect(
      document.settleSave(checkpoint, {
        status: "succeeded",
        commit: "committed",
        filePath: "/tmp/two.md",
        warnings: [],
      }),
    ).toMatchObject({ status: "applied" });
    expect(document.getSnapshot()).toMatchObject({
      markdown: "Two",
      savedMarkdown: "Two",
      filePath: "/tmp/two.md",
      isDirty: false,
    });
  });

  it("updates the saved baseline without discarding edits made while saving", () => {
    const document = createDocumentState({ markdown: "One", filePath: "/tmp/post.md" });

    document.applyEditorChange("Two", {
      kind: "renderer",
      clientId: "document-state-test",
      sequence: 1,
    });
    const checkpoint = document.beginSave({ kind: "current-path", path: "/tmp/post.md" });
    document.applyEditorChange("Three", {
      kind: "renderer",
      clientId: "document-state-test",
      sequence: 2,
    });
    document.settleSave(checkpoint, {
      status: "succeeded",
      commit: "committed",
      filePath: "/tmp/post.md",
      warnings: [],
    });

    expect(document.getSnapshot()).toMatchObject({
      markdown: "Three",
      savedMarkdown: "Two",
      filePath: "/tmp/post.md",
      isDirty: true,
    });
  });

  it("changes modes without discarding markdown", () => {
    const document = createDocumentState({ markdown: "- item" });
    const current = document.getSnapshot();

    expect(
      document.commitMode({
        operationId: "mode:document-state-test",
        mode: "source",
        expectedGeneration: current.documentGeneration,
        expectedStateRevision: current.stateRevision,
        origin: { kind: "command", commandId: "mode.source" },
      }),
    ).toMatchObject({ status: "applied", snapshot: { markdown: "- item", mode: "source" } });
  });

  it("switches modes without serializing or replacing Markdown", async () => {
    const document = createDocumentState({ markdown: "# Title" });

    const result = await switchEditorModeSafely(document, "source", {
      renderer: {
        applyMode: (request) => ({
          status: "applied",
          receipt: {
            operationId: request.operationId,
            clientId: "test-renderer",
            documentGeneration: request.expectedGeneration,
            expectedStateRevision: request.expectedStateRevision,
            previousMode: "wysiwyg",
            appliedMode: request.mode,
            viewId: "test-view",
            stateEpochId: "test-state",
          },
        }),
        rollbackMode: () => {
          throw new Error("rollback must not run after a successful core commit");
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        markdown: "# Title",
        mode: "source",
      },
    });
  });

  it("keeps previous content and mode when the renderer port rejects a mode switch", async () => {
    const document = createDocumentState({ markdown: "# Safe" });

    const result = await switchEditorModeSafely(document, "source", {
      renderer: {
        applyMode: () => ({ status: "failed", errorCode: "renderer-failed" }),
        rollbackMode: () => {
          throw new Error("rollback must not run when renderer did not apply");
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: "Renderer mode change failed: failed",
      snapshot: {
        markdown: "# Safe",
        mode: "wysiwyg",
      },
    });
    expect(document.getSnapshot()).toMatchObject({
      markdown: "# Safe",
      mode: "wysiwyg",
    });
  });
});

describe("registries", () => {
  it("registers and dispatches commands", async () => {
    const document = createDocumentState();
    const commands = createCommandRegistry();
    let executed = false;

    commands.register({
      id: "document.insert-heading",
      title: "Insert heading",
      run: () => {
        executed = true;
      },
    });

    await expect(commands.dispatch("document.insert-heading", { document })).resolves.toBe(true);
    expect(executed).toBe(true);
    await expect(commands.dispatch("missing", { document })).resolves.toBe(false);
  });

  it("rejects ambiguous key bindings", () => {
    const keymaps = createKeymapRegistry();

    keymaps.register({ id: "save", key: "Mod+S", commandId: "document.save" });

    expect(() =>
      keymaps.register({ id: "save-as", key: "Mod+S", commandId: "document.save-as" }),
    ).toThrow("Ambiguous key binding");
  });

  it("activates registered features", async () => {
    const features = createFeatureRegistry();
    const commands = createCommandRegistry();
    const keymaps = createKeymapRegistry();
    let executed = false;

    features.register({
      id: "source-mode",
      title: "Source Mode",
      setup: ({ commands: featureCommands }) => {
        featureCommands.register({
          id: "mode.source",
          title: "Source Mode",
          run: () => {
            executed = true;
          },
        });
      },
    });

    features.activateAll({ commands, keymaps });
    expect(commands.list().map((command) => command.id)).toEqual(["mode.source"]);
    await expect(
      commands.dispatch("mode.source", { document: createDocumentState() }),
    ).resolves.toBe(true);
    expect(executed).toBe(true);
  });
});
