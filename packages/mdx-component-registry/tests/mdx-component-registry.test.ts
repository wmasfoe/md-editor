import { describe, expect, it } from "vitest";
import {
  componentPluginFromDescriptor,
  createMdxComponentRegistry,
  type MdxComponentPlugin,
} from "../src";

const calloutPlugin: MdxComponentPlugin = {
  id: "mdx.callout",
  component: {
    name: "Callout",
    displayName: "Callout",
    props: [{ name: "type", type: "enum", values: ["info", "warning"] }],
    acceptsChildren: true,
    version: "0.2",
  },
  insert: {
    label: "Callout",
    keywords: ["note", "tip"],
    createSnippet: () => '<Callout type="info">内容</Callout>',
  },
};

describe("MdxComponentRegistry", () => {
  it("registers, lists, retrieves, and unregisters component plugins", () => {
    const registry = createMdxComponentRegistry();

    registry.register(calloutPlugin);

    expect(registry.getById("mdx.callout")?.component.displayName).toBe("Callout");
    expect(registry.getByComponentName("Callout")?.id).toBe("mdx.callout");
    expect(registry.list()).toHaveLength(1);
    expect(registry.listInsertable()).toEqual([calloutPlugin]);
    expect(registry.unregister("mdx.callout")).toBe(true);
    expect(registry.getByComponentName("Callout")).toBeUndefined();
  });

  it("rejects duplicate plugin ids and component names", () => {
    const registry = createMdxComponentRegistry([calloutPlugin]);

    expect(() => registry.register(calloutPlugin)).toThrow("MDX component plugin already registered");
    expect(() =>
      registry.register({
        ...calloutPlugin,
        id: "mdx.callout-copy",
      }),
    ).toThrow("MDX component already registered");
  });

  it("wraps a descriptor as a non-insertable compatibility plugin", () => {
    const plugin = componentPluginFromDescriptor({
      name: "Note",
      displayName: "Note",
      props: [],
      acceptsChildren: true,
      version: "0.1",
    });
    const registry = createMdxComponentRegistry([plugin]);

    expect(registry.getByComponentName("Note")).toEqual(plugin);
    expect(registry.listInsertable()).toEqual([]);
  });
});
