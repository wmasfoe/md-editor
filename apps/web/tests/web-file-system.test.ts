import { describe, expect, it } from "vitest";
import { WebFileSystem, isFileSystemAccessSupported } from "../src/lib/web-file-system";

describe("WebFileSystem Adapter", () => {
  it("detects File System Access API support flag", () => {
    expect(typeof isFileSystemAccessSupported).toBe("boolean");
  });

  it("starts with no opened directory handle", () => {
    const fs = new WebFileSystem();
    expect(fs.hasOpenedFolder()).toBe(false);
    expect(fs.getOpenedFolder()).toBeNull();
  });

  it("falls back to Base64 data URL when saving image without an opened folder and caches it", async () => {
    const fs = new WebFileSystem();
    const mockBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
    const result = await fs.saveAssetImage(mockBytes, "image/png", "test-screenshot.png");

    expect(result.isLocalDisk).toBe(false);
    expect(result.src).toMatch(/^data:image\/png;base64,/);

    // 缓存应记录该图片，后续 resolveImageSrc 可同步解析
    const resolved = fs.resolveImageSrc("test-screenshot.png");
    expect(resolved).toBe(result.src);
  });

  describe("resolveImageSrc", () => {
    it("preserves remote and embedded image sources", () => {
      const fs = new WebFileSystem();
      expect(fs.resolveImageSrc("https://example.com/logo.png")).toBe(
        "https://example.com/logo.png",
      );
      expect(fs.resolveImageSrc("http://example.com/logo.png")).toBe("http://example.com/logo.png");
      expect(fs.resolveImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
      expect(fs.resolveImageSrc("blob:http://localhost:3000/123")).toBe(
        "blob:http://localhost:3000/123",
      );
      expect(fs.resolveImageSrc("#anchor")).toBe("#anchor");
    });

    it("cleans angle brackets, query parameters, and hash anchors", () => {
      const fs = new WebFileSystem();
      fs.cacheAssetUrl("assets/pic.png", "blob:asset-url");

      expect(fs.resolveImageSrc("<assets/pic.png>")).toBe("blob:asset-url");
      expect(fs.resolveImageSrc("assets/pic.png?v=2")).toBe("blob:asset-url");
      expect(fs.resolveImageSrc("assets/pic.png#preview")).toBe("blob:asset-url");
      expect(fs.resolveImageSrc("<assets/pic.png?v=2#preview>")).toBe("blob:asset-url");
    });

    it("resolves relative paths with documentPath context", () => {
      const fs = new WebFileSystem();
      fs.cacheAssetUrl("/workspace/assets/diagram.png", "blob:diagram-blob");

      // 当前文档在 /workspace/docs/sub/readme.md，引用的相对路径为 ../../assets/diagram.png
      const resolved = fs.resolveImageSrc(
        "../../assets/diagram.png",
        "/workspace/docs/sub/readme.md",
      );
      expect(resolved).toBe("blob:diagram-blob");
    });

    it("resolves dot-relative paths and filename fallbacks", () => {
      const fs = new WebFileSystem();
      fs.cacheAssetUrl("assets/banner.webp", "blob:banner-blob");

      expect(fs.resolveImageSrc("./assets/banner.webp")).toBe("blob:banner-blob");
      expect(fs.resolveImageSrc("assets/banner.webp")).toBe("blob:banner-blob");
      expect(fs.resolveImageSrc("banner.webp")).toBe("blob:banner-blob");
    });

    it("clears cache and revokes URLs on revokeAllAssetUrls", () => {
      const fs = new WebFileSystem();
      fs.cacheAssetUrl("assets/cleanup.png", "blob:cleanup-blob");
      expect(fs.resolveImageSrc("assets/cleanup.png")).toBe("blob:cleanup-blob");

      fs.revokeAllAssetUrls();
      // 清空后应回退为原路径
      expect(fs.resolveImageSrc("assets/cleanup.png")).toBe("assets/cleanup.png");
    });
  });

  describe("onFolderChange", () => {
    it("subscribes and unsubscribes to folder change notifications", () => {
      const fs = new WebFileSystem();
      const listener = (folder: unknown) => {
        received = folder;
      };
      let received: unknown = "not-called";

      const unsubscribe = fs.onFolderChange(listener);
      fs.closeDirectory();
      expect(received).toBeNull();

      received = "reset";
      unsubscribe();
      fs.closeDirectory();
      expect(received).toBe("reset");
    });
  });
});
