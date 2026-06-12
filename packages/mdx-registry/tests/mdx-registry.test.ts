import { describe, expect, it } from "vitest";
import { createMdxComponentRegistry } from "../src";

describe("MDXComponentRegistry", () => {
  it("registers, lists, retrieves, and unregisters descriptors", () => {
    const registry = createMdxComponentRegistry();

    registry.register({
      name: "Callout",
      displayName: "Callout",
      props: [{ name: "type", type: "enum", values: ["info", "warning"] }],
      acceptsChildren: true,
      version: "0.2"
    });

    expect(registry.get("Callout")?.displayName).toBe("Callout");
    expect(registry.list()).toHaveLength(1);
    expect(registry.unregister("Callout")).toBe(true);
    expect(registry.get("Callout")).toBeUndefined();
  });

  it("rejects duplicate component names", () => {
    const registry = createMdxComponentRegistry([
      {
        name: "Note",
        displayName: "Note",
        props: [],
        acceptsChildren: true,
        version: "0.1"
      }
    ]);

    expect(() =>
      registry.register({
        name: "Note",
        displayName: "Note",
        props: [],
        acceptsChildren: true,
        version: "0.1"
      })
    ).toThrow("MDX component already registered");
  });
});
