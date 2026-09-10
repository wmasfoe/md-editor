import { describe, expect, it } from "vitest";
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

  it("inserts image at cursor position when getCursorPosition is provided", async () => {
    // 设置已保存文件状态
    runtime.document.replaceDocument(
      {
        markdown: "Hello world!",
        savedMarkdown: "Hello world!",
        filePath: "/Users/test/docs/intro.md",
      },
      { kind: "command", commandId: "test.setup" },
    );

    let appliedMarkdown = "";
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      applyMarkdown: (md) => {
        appliedMarkdown = md;
      },
      getCursorPosition: () => 5, // 光标在 "Hello" 后面 (index 5)
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

    expect(appliedMarkdown).toContain("Hello![logo](./assets/");
    expect(appliedMarkdown).toContain("world!");
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
      applyMarkdown: () => {},
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
    let appliedMarkdown = "";
    const fakeFile = new File(["dummy bytes"], "logo.png", { type: "image/png" });

    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => true,
      runFileAction: async (_label, action) => {
        await action();
      },
      applyMarkdown: (md) => {
        appliedMarkdown = md;
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
    expect(appliedMarkdown).toContain("![logo](./imgs/logo.png)");
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
      applyMarkdown: () => {},
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
});
