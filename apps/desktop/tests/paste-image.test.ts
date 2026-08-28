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
});
