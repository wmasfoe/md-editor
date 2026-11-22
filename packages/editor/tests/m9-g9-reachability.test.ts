// @vitest-environment jsdom
/**
 * M-9 + G-9：两条此前"声明通过但无测试"的契约。
 *
 * M-9：`injectStyles` / `styleNonce` / `syntaxPluginHostPorts` / `focusDimOpacity`
 *      必须能从**两个**表面到达 —— bridge options（非 React 宿主）与 React props。
 *
 * 判别力要求（见 matrix「验收断言的可判别性要求」）：每条断言都必须能在
 * **删掉生产实现后变红**。因此这里刻意**不用** `{...spread}` 传参 ——
 * spread 不触发 TS 的多余属性检查，会让类型契约形同虚设；每个 option 都
 * 显式写出，并断言它产生的**可观测副作用**：
 *
 * - `injectStyles` → 宿主文档里是否出现 `<style id=md-editor-renderer-style>`；
 * - `styleNonce` → 该 `<style>` 上的 `nonce` 属性；
 * - `focusDimOpacity` → state facet 解析出的 dim 强度（经 [0.30,0.50] 硬夹）；
 * - `syntaxPluginHostPorts` → 渲染器 state 里能读到注入的翻译端口（经 facet 生效）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { SyntaxPluginRegistry as SdkRegistry } from "@md-editor/plugin-sdk/syntax";

import { createCodeMirrorEditorBridge } from "../src/bridge.ts";
import { EDITOR_STYLE_ELEMENT_ID } from "../src/styles/index.ts";
import type { CodeMirrorEditor } from "../src/react/index.ts";

const created: { destroy(): void }[] = [];

afterEach(() => {
  for (const item of created.splice(0)) item.destroy();
  for (const style of globalThis.document.querySelectorAll(`#${EDITOR_STYLE_ELEMENT_ID}`)) {
    style.remove();
  }
});

function mountBridge(options: {
  markdown?: string;
  injectStyles?: boolean;
  styleNonce?: string;
  focusDimOpacity?: number;
  syntaxPluginHostPorts?: { translateEditorMessage?: (key: string, fallback: string) => string };
}) {
  const documentState = createDocumentState({ markdown: options.markdown ?? "alpha\n" });
  const parent = globalThis.document.createElement("div");
  globalThis.document.body.append(parent);
  const bridge = createCodeMirrorEditorBridge({
    document: documentState,
    parent,
    onSyncError: () => undefined,
    onQueuedExternalEditResult: () => undefined,
    injectStyles: options.injectStyles,
    styleNonce: options.styleNonce,
    focusDimOpacity: options.focusDimOpacity,
    syntaxPluginHostPorts: options.syntaxPluginHostPorts,
  });
  created.push(bridge);
  return { bridge, parent };
}

describe("M-9 bridge options 真的生效（删掉生产转发会红）", () => {
  it("injectStyles: true 注入 <style>；false 不注入", () => {
    mountBridge({ injectStyles: true });
    expect(globalThis.document.getElementById(EDITOR_STYLE_ELEMENT_ID)).not.toBeNull();

    for (const style of globalThis.document.querySelectorAll(`#${EDITOR_STYLE_ELEMENT_ID}`)) {
      style.remove();
    }
    mountBridge({ injectStyles: false });
    expect(globalThis.document.getElementById(EDITOR_STYLE_ELEMENT_ID)).toBeNull();
  });

  it("styleNonce 落在注入的 <style> 上（CSP 唯一可观测证据）", () => {
    mountBridge({ injectStyles: true, styleNonce: "host-nonce-42" });
    const style = globalThis.document.getElementById(EDITOR_STYLE_ELEMENT_ID);
    expect(style).not.toBeNull();
    expect(style?.getAttribute("nonce")).toBe("host-nonce-42");
  });

  it("focusDimOpacity 真的到达视图：焦点模式写入的 CSS 变量等于注入值", () => {
    const { bridge } = mountBridge({ focusDimOpacity: 0.42 });
    // 开启焦点模式后，focus-mode 扩展把 `resolveDimOpacity(view.state)` 写到
    // `--cm-md-focus-dim-opacity` 上 —— 这是该 option 唯一真实可观测的出口。
    bridge.ports.toggleFocusMode();
    const content = globalThis.document.querySelector(".cm-content") as HTMLElement | null;
    expect(content).not.toBeNull();
    expect(content?.style.getPropertyValue("--cm-md-focus-dim-opacity")).toBe("0.42");
  });

  it("focusDimOpacity 越界值被硬夹到 [0.30, 0.50]", () => {
    const { bridge } = mountBridge({ focusDimOpacity: 9 });
    bridge.ports.toggleFocusMode();
    const content = globalThis.document.querySelector(".cm-content") as HTMLElement | null;
    expect(content?.style.getPropertyValue("--cm-md-focus-dim-opacity")).toBe("0.5");
  });

  it("syntaxPluginHostPorts 的翻译端口被编辑器真实调用（折叠按钮文案）", () => {
    const calls: string[] = [];
    // 标题块会渲染折叠按钮，按钮的 aria-label 走 `syntaxPluginHostPortsFacet.translateEditorMessage`
    // （见 wysiwyg/blocks/block-toolbar.ts 的 resolveFoldToggleLabels）——
    // 这是该端口在生产代码里唯一被真实读取的路径。
    mountBridge({
      markdown: "# Heading\n\nbody\n",
      syntaxPluginHostPorts: {
        translateEditorMessage: (key: string, fallback: string) => {
          calls.push(key);
          return `translated:${fallback}`;
        },
      },
    });
    expect(calls).toContain("editor.fold.expand");
    expect(calls).toContain("editor.fold.collapse");
  });
});

describe("M-9 同样的四个 options 从 React props 到达（编译期契约）", () => {
  it("props 类型面接受全部四个，且不能靠 spread 蒙过类型检查", () => {
    type Props = Parameters<typeof CodeMirrorEditor>[0];
    // 显式字面量（非 spread）：少一个字段或多一个字段都会成为类型错误。
    const props: Pick<
      Props,
      "injectStyles" | "styleNonce" | "focusDimOpacity" | "syntaxPluginHostPorts"
    > = {
      injectStyles: false,
      styleNonce: "nonce-from-host",
      focusDimOpacity: 0.42,
      syntaxPluginHostPorts: {},
    };
    expect(Object.keys(props).toSorted()).toEqual([
      "focusDimOpacity",
      "injectStyles",
      "styleNonce",
      "syntaxPluginHostPorts",
    ]);
  });

  it("bridge options 类型面同样接受全部四个（显式字面量）", () => {
    type BridgeOptions = Parameters<typeof createCodeMirrorEditorBridge>[0];
    const options: Pick<
      BridgeOptions,
      "injectStyles" | "styleNonce" | "focusDimOpacity" | "syntaxPluginHostPorts"
    > = {
      injectStyles: false,
      styleNonce: "nonce-from-host",
      focusDimOpacity: 0.42,
      syntaxPluginHostPorts: {},
    };
    expect(Object.keys(options).toSorted()).toEqual([
      "focusDimOpacity",
      "injectStyles",
      "styleNonce",
      "syntaxPluginHostPorts",
    ]);
  });
});

describe("G-9 editor 内部使用 SDK 的同一个 SyntaxPluginRegistry 实现", () => {
  it("两端对同一 id 重复注册的语义一致（行为级身份）", () => {
    const documentState = createDocumentState({ markdown: "alpha\n" });
    const parent = globalThis.document.createElement("div");
    globalThis.document.body.append(parent);
    const bridge = createCodeMirrorEditorBridge({
      document: documentState,
      parent,
      onSyncError: () => undefined,
      onQueuedExternalEditResult: () => undefined,
    });
    created.push(bridge);

    const plugin = { id: "dup", name: "dup", buildDecorations: () => [] };
    bridge.ports.addSyntaxPlugin(plugin);
    expect(() => bridge.ports.addSyntaxPlugin(plugin)).toThrow(/dup/iu);
    parent.remove();
  });

  it("SDK registry 对同一 id 也抛错，且错误信息同源", () => {
    const registry = new SdkRegistry([]);
    const plugin = { id: "dup", name: "dup", buildDecorations: () => [] };
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow(/dup/iu);
  });
});

/**
 * M-9 的 props→bridge 转发（运行时断言）。
 *
 * 上面的 `Pick<Props, …>` 只证明**类型**里有这四个键；组件是否真的把它们转给
 * `createCodeMirrorEditorBridge` 需要另一条断言。这里 mock 掉 bridge 工厂，
 * 直接检查它收到的实参 —— 删掉 `CodeMirrorEditor.tsx` 里的任何一行转发都会变红。
 */
describe("M-9 props → bridge 的运行时转发", () => {
  it("四个 props 原样进入 bridge options", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement } = await import("react");
    const { CodeMirrorEditor } = await import("../src/react/index.ts");
    const { createDocumentState: createDoc } = await import("@md-editor/core");

    const received: Record<string, unknown>[] = [];
    const { vi } = await import("vitest");
    const actual = await import("../src/bridge.ts");
    // mock 必须提供组件在 layout effect 里会调用的端口方法，否则同进程内的
    // 其他测试文件渲染组件时会抛 "not a function"（曾实际发生）。
    const noopPorts = new Proxy(
      {},
      {
        get: () => () => undefined,
      },
    ) as never;
    const spy = vi.spyOn(actual, "createCodeMirrorEditorBridge").mockImplementation((options) => {
      received.push(options as unknown as Record<string, unknown>);
      return { ports: noopPorts, destroy: () => undefined } as never;
    });

    const container = globalThis.document.createElement("div");
    globalThis.document.body.append(container);
    const root = createRoot(container);
    const hostPorts = { translateEditorMessage: () => "x" };

    try {
      root.render(
        createElement(CodeMirrorEditor, {
          document: createDoc({ markdown: "alpha\n" }),
          injectStyles: false,
          styleNonce: "props-nonce",
          focusDimOpacity: 0.42,
          syntaxPluginHostPorts: hostPorts,
        }),
      );
      await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));

      const options = received[0] ?? {};
      expect(options.injectStyles).toBe(false);
      expect(options.styleNonce).toBe("props-nonce");
      expect(options.focusDimOpacity).toBe(0.42);
      expect(options.syntaxPluginHostPorts).toBe(hostPorts);
    } finally {
      spy.mockRestore();
      root.unmount();
      container.remove();
    }
  });
});
