import type { ImageInsertionInput } from "@md-editor/editor";
import { describe, expect, it, vi } from "vitest";
import {
  getDroppedImage,
  getPastedImage,
  pasteImageInput,
  type PasteImageRuntime,
} from "../src/lib/paste-image";
import { runtime } from "../src/app/runtime/editor-runtime";

describe("paste-image helpers", () => {
  it("detects image files from paste DataTransfer", () => {
    const fakeFile = new File(["dummy"], "photo.png", { type: "image/png" });
    const dataTransfer = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => fakeFile,
        },
      ],
    } as unknown as DataTransfer;

    const result = getPastedImage(dataTransfer);
    expect(result).not.toBeNull();
    expect(result?.preferredName).toBe("photo.png");
    expect(result?.mimeType).toBe("image/png");
  });

  it("detects image files from drop DataTransfer", () => {
    const fakeFile = new File(["dummy"], "diagram.jpg", { type: "image/jpeg" });
    const dataTransfer = {
      files: [fakeFile],
    } as unknown as DataTransfer;

    const result = getDroppedImage(dataTransfer);
    expect(result).not.toBeNull();
    expect(result?.preferredName).toBe("diagram.jpg");
    expect(result?.mimeType).toBe("image/jpeg");
  });

  it("delegates the stored image address to the prepared editor insertion", async () => {
    // 设置已保存文件状态
    runtime.document.replaceDocument(
      {
        markdown: "Hello world!",
        savedMarkdown: "Hello world!",
        filePath: "/Users/test/docs/intro.md",
      },
      { kind: "command", commandId: "test.setup" },
    );

    let insertedImage: ImageInsertionInput | undefined;
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      prepareImageInsertion: () => (image) => {
        insertedImage = image;
        return { status: "noop" };
      },
      checkDirectoryExists: async () => true,
      assetsDirectory: "assets",
      storageProvider: {
        save: async ({ context }) => ({
          src: `./${context.defaultAssetsDir}/logo.png`,
          targetPath: `/Users/test/docs/${context.defaultAssetsDir}/logo.png`,
        }),
      },
    };

    await pasteImageInput(
      {
        file: fakeFile,
        mimeType: "image/png",
        preferredName: "logo.png",
      },
      pasteRuntime,
    );

    expect(insertedImage).toEqual({ src: "./assets/logo.png", alt: "logo" });
  });

  it("aborts pasting if the target directory does not exist and user cancels confirmation", async () => {
    runtime.document.replaceDocument(
      {
        markdown: "Content",
        savedMarkdown: "Content",
        filePath: "/Users/test/docs/intro.md",
      },
      { kind: "command", commandId: "test.setup" },
    );

    let saveCalled = false;
    let confirmationDescription = "";
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      prepareImageInsertion: () => () => ({ status: "noop" }),
      assetsDirectory: "./imgs",
      checkDirectoryExists: async () => false,
      requestConfirmation: async (options) => {
        confirmationDescription = options.description ?? "";
        return "cancel";
      },
      storageProvider: {
        save: async () => {
          saveCalled = true;
          return { src: "./imgs/logo.png", targetPath: "/Users/test/docs/imgs/logo.png" };
        },
      },
    };

    await pasteImageInput(
      {
        file: fakeFile,
        mimeType: "image/png",
        preferredName: "logo.png",
      },
      pasteRuntime,
    );

    expect(saveCalled).toBe(false);
    expect(confirmationDescription).toBe(
      "尝试将新插入的图片复制到目录 /Users/test/docs/imgs。但该目录不存在，是否立即创建？",
    );
  });

  it("proceeds with pasting if the target directory does not exist and user confirms", async () => {
    runtime.document.replaceDocument(
      {
        markdown: "Content",
        savedMarkdown: "Content",
        filePath: "/Users/test/docs/intro.md",
      },
      { kind: "command", commandId: "test.setup" },
    );

    let saveCalled = false;
    let insertedImage: ImageInsertionInput | undefined;
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      prepareImageInsertion: () => (image) => {
        insertedImage = image;
        return { status: "noop" };
      },
      assetsDirectory: "./imgs",
      checkDirectoryExists: async () => false,
      requestConfirmation: async () => "confirm",
      storageProvider: {
        save: async () => {
          saveCalled = true;
          return { src: "./imgs/logo.png", targetPath: "/Users/test/docs/imgs/logo.png" };
        },
      },
    };

    await pasteImageInput(
      {
        file: fakeFile,
        mimeType: "image/png",
        preferredName: "logo.png",
      },
      pasteRuntime,
    );

    expect(saveCalled).toBe(true);
    expect(insertedImage).toEqual({ src: "./imgs/logo.png", alt: "logo" });
  });

  it("calls afterSaveImage callback with document path after image is saved", async () => {
    runtime.document.replaceDocument(
      {
        markdown: "Content",
        savedMarkdown: "Content",
        filePath: "/Users/test/docs/intro.md",
      },
      { kind: "command", commandId: "test.setup" },
    );

    let afterSaveDocumentPath = "";
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      prepareImageInsertion: () => () => ({ status: "noop" }),
      assetsDirectory: "assets",
      checkDirectoryExists: async () => true,
      afterSaveImage: async (filePath) => {
        afterSaveDocumentPath = filePath;
      },
      storageProvider: {
        save: async () => ({
          src: "./assets/logo.png",
          targetPath: "/Users/test/docs/assets/logo.png",
        }),
      },
    };

    await pasteImageInput(
      {
        file: fakeFile,
        mimeType: "image/png",
        preferredName: "logo.png",
      },
      pasteRuntime,
    );

    expect(afterSaveDocumentPath).toBe("/Users/test/docs/intro.md");
  });
  it("captures the editor insertion before storage and surfaces stale results without replacing content", async () => {
    runtime.document.replaceDocument(
      { markdown: "original", filePath: "/docs/a.md" },
      { kind: "command", commandId: "test.setup" },
    );
    const calls: string[] = [];
    const replace = vi.spyOn(runtime.document, "replaceDocument");
    const actions: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      checkDirectoryExists: async () => true,
      prepareImageInsertion: () => {
        calls.push("prepare");
        return () => ({ status: "stale", actualGeneration: 2, actualContentRevision: 0 });
      },
      storageProvider: {
        save: async () => {
          calls.push("store");
          return { src: "a.png" };
        },
      },
    };
    await expect(
      pasteImageInput({ file: new File(["bytes"], "a.png"), mimeType: "image/png" }, actions),
    ).rejects.toThrow("文档已变化");
    expect(calls).toEqual(["prepare", "store"]);
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });
});
