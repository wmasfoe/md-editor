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

    expect(document.updateMarkdown("Two").isDirty).toBe(true);
    expect(document.markSaved({ filePath: "/tmp/two.md" })).toMatchObject({
      markdown: "Two",
      savedMarkdown: "Two",
      filePath: "/tmp/two.md",
      isDirty: false,
    });
  });

  it("updates the saved baseline without discarding edits made while saving", () => {
    const document = createDocumentState({ markdown: "One", filePath: "/tmp/post.md" });

    document.updateMarkdown("Two");
    document.updateMarkdown("Three");

    expect(
      document.updateSavedBaseline({ markdown: "Two", filePath: "/tmp/post.md" }),
    ).toMatchObject({
      markdown: "Three",
      savedMarkdown: "Two",
      filePath: "/tmp/post.md",
      isDirty: true,
    });
  });

  it("changes modes without discarding markdown", () => {
    const document = createDocumentState({ markdown: "- item" });

    expect(document.setMode("source")).toMatchObject({
      markdown: "- item",
      mode: "source",
    });
  });

  it("switches modes through a Markdown serialization adapter", async () => {
    const document = createDocumentState({ markdown: "# Title" });

    const result = await switchEditorModeSafely(document, "source", {
      beforeSwitch: (snapshot) => `${snapshot.markdown}\n\nBody`,
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        markdown: "# Title\n\nBody",
        mode: "source",
      },
    });
  });

  it("keeps previous content and mode when mode switching fails", async () => {
    const document = createDocumentState({ markdown: "# Safe" });

    const result = await switchEditorModeSafely(document, "source", {
      beforeSwitch: () => {
        throw new Error("serialize failed");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: "serialize failed",
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

    commands.register({
      id: "document.insert-heading",
      title: "Insert heading",
      run: ({ document: state }) => {
        state.updateMarkdown("# Heading");
      },
    });

    await expect(commands.dispatch("document.insert-heading", { document })).resolves.toBe(true);
    expect(document.getSnapshot().markdown).toBe("# Heading");
    await expect(commands.dispatch("missing", { document })).resolves.toBe(false);
  });

  it("rejects ambiguous key bindings", () => {
    const keymaps = createKeymapRegistry();

    keymaps.register({ id: "save", key: "Mod+S", commandId: "document.save" });

    expect(() =>
      keymaps.register({ id: "save-as", key: "Mod+S", commandId: "document.save-as" }),
    ).toThrow("Ambiguous key binding");
  });

  it("activates registered features", () => {
    const features = createFeatureRegistry();
    const commands = createCommandRegistry();
    const keymaps = createKeymapRegistry();

    features.register({
      id: "source-mode",
      title: "Source Mode",
      setup: ({ commands: featureCommands }) => {
        featureCommands.register({
          id: "mode.source",
          title: "Source Mode",
          run: ({ document }) => {
            document.setMode("source");
          },
        });
      },
    });

    features.activateAll({ commands, keymaps });
    expect(commands.list().map((command) => command.id)).toEqual(["mode.source"]);
  });
});
