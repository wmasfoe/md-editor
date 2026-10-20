/**
 * T-27 / T-28：`setInlineStyleMarkers` 端口语义（applied / noop / destroyed）、
 * ledger 归类与探针字段。
 */
import { createDocumentState } from "@md-editor/editor-core";
import { describe, expect, it } from "vitest";
import { createRendererTestHarness } from "../src/testing.ts";

function createHarness() {
  const document = createDocumentState({ markdown: "Head\n\nxx **bold** yy\n" });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    useNativeCodeLanguages: false,
  } as never);
}

describe("setInlineStyleMarkers 端口", () => {
  it("T-27: applied → noop → destroyed", () => {
    const harness = createHarness();

    expect(harness.renderer.setInlineStyleMarkers(true)).toEqual({ status: "applied" });
    expect(harness.renderer.setInlineStyleMarkers(true)).toEqual({ status: "noop" });
    expect(harness.renderer.setInlineStyleMarkers(false)).toEqual({ status: "applied" });

    harness.renderer.destroy();
    expect(harness.renderer.setInlineStyleMarkers(true)).toEqual({ status: "destroyed" });
  });

  it("T-28: 探针暴露开关值、ledger 计数与显形点集失效计数", () => {
    const harness = createHarness();
    const before = harness.probe();

    expect(before.inlineStyleMarkers).toBe(false);
    expect(before.inlineStyleMarkerTransactionCount).toBe(0);
    expect(before.selectionFreezeWithoutDeltaCount).toBe(0);

    harness.renderer.setInlineStyleMarkers(true);
    const after = harness.probe();

    expect(after.inlineStyleMarkers).toBe(true);
    expect(after.inlineStyleMarkerTransactionCount).toBe(
      before.inlineStyleMarkerTransactionCount + 1,
    );
    // 开关 ON 后显形点集为常数空集。
    expect(after.wysiwygProjection.inlineMarkerRevealIds).toEqual([]);
  });
});
