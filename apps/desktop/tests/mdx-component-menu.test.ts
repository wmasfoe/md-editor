import { describe, expect, it } from "vitest";
import { useDocumentUiStore } from "../src/app/stores/document-ui-store";
import { runtime } from "../src/app/runtime/editor-runtime";
import { calloutPlugin } from "@md-editor/mdx-plugins";

describe("MDX component menu and insertion workflow", () => {
  it("manages MDX component menu visibility state in documentUiStore", () => {
    const store = useDocumentUiStore.getState();
    expect(store.isMdxComponentMenuOpen).toBe(false);

    store.openMdxComponentMenu();
    expect(useDocumentUiStore.getState().isMdxComponentMenuOpen).toBe(true);

    store.closeMdxComponentMenu();
    expect(useDocumentUiStore.getState().isMdxComponentMenuOpen).toBe(false);
  });

  it("lists insertable MDX plugins from editor runtime", () => {
    const insertable = runtime.mdxComponents.listInsertable();
    expect(insertable.length).toBeGreaterThan(0);
    const callout = insertable.find((p) => p.component.name === "Callout");
    expect(callout).toBeDefined();
    expect(callout?.insert?.label).toBe("Callout");
    expect(callout?.insert?.createSnippet()).toContain("<Callout");
  });

  it("has valid snippet generation contract for calloutPlugin", () => {
    const snippet = calloutPlugin.insert?.createSnippet();
    expect(snippet).toBeDefined();
    expect(snippet).toContain('<Callout type="info" title="提示">');
    expect(snippet).toContain("</Callout>");
  });
});
