import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => tauri);

import { savePastedImage } from "../../src/desktop/file-adapter";

describe("desktop image IPC", () => {
  beforeEach(() => tauri.invoke.mockReset());

  it("sends image bytes as a raw body and URL-safe Unicode metadata in headers", async () => {
    const bytes = new Uint8Array([0, 255, 12]);
    tauri.invoke.mockResolvedValue({ markdownPath: "./文档-assets/image.png" });
    await savePastedImage({
      context: {
        documentPath: "/notes/设计.md",
        defaultAssetsDir: "./文档-assets",
        preferredName: "图像",
      },
      mimeType: "image/png",
      bytes,
    });

    expect(tauri.invoke).toHaveBeenCalledOnce();
    const [command, body, options] = tauri.invoke.mock.calls[0];
    expect(command).toBe("save_pasted_image");
    expect(body).toBe(bytes);
    const encoded = options.headers["x-image-metadata"] as string;
    expect(decodeURIComponent(encoded)).toEqual(
      JSON.stringify({
        documentPath: "/notes/设计.md",
        defaultAssetsDir: "./文档-assets",
        preferredName: "图像",
        mimeType: "image/png",
      }),
    );
  });
});
