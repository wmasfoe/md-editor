import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { createDesktopNativeSaveAdapter } from "../src/desktop/file-adapter";
import { createDesktopRuntimeFileService } from "../src/desktop/file-service";
import {
  attachSaveRuntime,
  MAIN_WINDOW_LABEL,
  SaveRuntimeAttachError,
} from "../src/desktop/save-runtime";

describe("desktop save runtime boundary", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReturnValue(true);
  });

  it("attaches through the caller-injected command without sending a spoofable label", async () => {
    tauri.invoke.mockResolvedValue({
      status: "attached",
      epoch: 2,
      id: 7,
      sequenceSeed: 0,
    });

    await expect(attachSaveRuntime()).resolves.toEqual({ epoch: 2, id: 7, sequenceSeed: 0 });
    expect(tauri.invoke).toHaveBeenCalledWith("attach_save_runtime");
  });

  it.each([
    [{ status: "rejected", reason: "non-main-webview" }, "REJECTED"],
    [{ status: "indeterminate", errorCode: "join-failed" }, "INDETERMINATE"],
    [{ status: "attached", epoch: 0, id: 1, sequenceSeed: 0 }, "INVALID_PAYLOAD"],
  ] as const)("fails closed for attach payload %#", async (payload, code) => {
    tauri.invoke.mockResolvedValue(payload);

    const error = await captureRejection(attachSaveRuntime());
    expect(error).toBeInstanceOf(SaveRuntimeAttachError);
    expect(error).toMatchObject({ code });
  });

  it("passes the opaque epoch token and exact LF checkpoint to the ordered native command", async () => {
    tauri.invoke.mockResolvedValue({
      status: "committed",
      runtimeSequence: 4,
      filePath: "/chosen/post.md",
      warnings: [],
    });
    const adapter = createDesktopNativeSaveAdapter();

    await adapter.saveMarkdownJob({
      jobId: "save-4",
      checkpointSequence: 9,
      documentGeneration: 3,
      markdownLf: "body\n",
      destination: { kind: "prompt", suggestedPath: "/suggested/post.md" },
      orderingToken: { epoch: 2, id: 7, runtimeSequence: 4 },
    });

    expect(tauri.invoke).toHaveBeenCalledWith("save_markdown_document_ordered", {
      orderingToken: { epoch: 2, id: 7, runtimeSequence: 4 },
      markdownLf: "body\n",
      destination: { kind: "prompt", suggestedPath: "/suggested/post.md" },
    });
  });

  it("keeps FileService construction and module evaluation free of native commands", () => {
    const service = createDesktopRuntimeFileService({ epoch: 1, id: 1, sequenceSeed: 0 });

    expect(typeof service.enqueueSaveJob).toBe("function");
    expect("saveDocument" in service).toBe(false);
    expect("saveDocumentAs" in service).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("keeps the TypeScript and Rust main-window labels identical", () => {
    const rustContract = readFileSync(
      new URL("../src-tauri/src/platform_contract.rs", import.meta.url),
      "utf8",
    );

    expect(MAIN_WINDOW_LABEL).toBe("main");
    expect(rustContract).toContain(`MAIN_WINDOW_LABEL: &str = "${MAIN_WINDOW_LABEL}"`);
  });
});

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject.");
}
