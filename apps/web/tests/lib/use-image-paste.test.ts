import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImagePaste } from "../../src/lib/use-image-paste";
import { webFileSystem } from "../../src/lib/web-file-system";

vi.mock("react", () => ({ useEffect: vi.fn() }));
vi.mock("../../src/lib/web-file-system", () => ({ webFileSystem: { saveAssetImage: vi.fn() } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function UseTestImagePaste() {
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("window", {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    removeEventListener: vi.fn(),
  });
  const showToast = vi.fn();
  useImagePaste({ ports: null, showToast });
  vi.mocked(useEffect).mock.calls[0]![0]();
  return { listeners, showToast };
}

describe("image paste before editor readiness", () => {
  it.each(["paste", "drop"])("reports a %s without reading or storing the file", (kind) => {
    const { listeners, showToast } = UseTestImagePaste();
    const arrayBuffer = vi.fn();
    const file = { name: "photo.png", type: "image/png", arrayBuffer };
    const preventDefault = vi.fn();
    listeners.get(kind)!({
      preventDefault,
      stopPropagation: vi.fn(),
      ...(kind === "paste"
        ? { clipboardData: { items: [{ kind: "file", type: file.type, getAsFile: () => file }] } }
        : { dataTransfer: { files: [file] } }),
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("编辑器尚未就绪"));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(webFileSystem.saveAssetImage).not.toHaveBeenCalled();
  });
});
