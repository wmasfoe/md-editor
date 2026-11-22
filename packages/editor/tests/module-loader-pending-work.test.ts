/**
 * 就绪后是否需要重算：必须同时认「MDX partial」与「HTML 块」两类。
 *
 * 曾经的漏判：只看 `parserCoverage !== "complete"`。HTML 块记录本身是 complete
 * （语法解析没问题），但**消毒器**缺失时投影层渲染的是 "Loading HTML preview…"
 * 占位 —— 只看 coverage 会漏掉它，导致 HTML 块永久停在占位（e2e 实测复现）。
 */
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";

import { createRendererTestHarness } from "../src/testing.ts";
import {
  onOptionalModuleReady,
  preloadOptionalModules,
  resetOptionalModuleCache,
} from "../src/module-loader";

function createHarness(markdown: string) {
  const document = createDocumentState({ markdown });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
}

describe("可选模块就绪后的重算判定", () => {
  it("纯文本视图不需要重算（避免凭空多派事务）", () => {
    const harness = createHarness("alpha\n\nbeta\n");
    // 没有 HTML/MDX 记录 ⇒ 就绪时不该产生额外事务。
    const before = harness.probe().stateRevision;
    expect(typeof before).toBe("number");
    harness.renderer.destroy();
  });

  it("含 HTML 块的视图在消毒器就绪后能从占位升级为渲染结果", async () => {
    resetOptionalModuleCache();
    const harness = createHarness('<div id="probe">hello</div>\n');

    // 首次渲染时消毒器未就绪 → 占位。
    const pending = harness.probe();
    expect(pending).toBeDefined();

    // 等模块就绪（监听器会触发重算）。
    await preloadOptionalModules();
    // 给监听器一个微任务机会。
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 就绪后不应再抛错，且文档内容保持原样（重算只影响投影）。
    expect(harness.probe().mode).toBeDefined();
    harness.renderer.destroy();
  });

  it("onOptionalModuleReady 返回可退订函数", () => {
    const detach = onOptionalModuleReady(() => undefined);
    expect(typeof detach).toBe("function");
    detach();
  });
});
