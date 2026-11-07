import { describe, expect, it } from "vitest";
import { validateCatalog, validatePluginPackage } from "../src/index.ts";

const manifest = {
  id: "author.plugin",
  name: "Plugin",
  description: "Example",
  version: "1.0.0",
  apiVersion: 1 as const,
};
const entry = { ...manifest, asset: "plugin.inkpoint.json" };
const pkg = { manifest, code: "export default {activate(){}}", examples: [] };

describe("release catalog contracts", () => {
  it("accepts a repository with any number of entries within its byte budget", () => {
    const plugins = Array.from({ length: 1001 }, (_, index) => ({
      ...entry,
      id: `author.plugin-${index}`,
      asset: `plugin-${index}.inkpoint.json`,
    }));
    expect(validateCatalog({ schemaVersion: 1, plugins }).plugins).toHaveLength(1001);
  });

  it("rejects shared assets and duplicate IDs", () => {
    expect(() =>
      validateCatalog({ schemaVersion: 1, plugins: [entry, { ...entry, id: "author.other" }] }),
    ).toThrow("duplicate");
    expect(() =>
      validateCatalog({
        schemaVersion: 1,
        plugins: [entry, { ...entry, asset: "other.inkpoint.json" }],
      }),
    ).toThrow("duplicate");
  });

  it.each(["id", "name", "version", "description", "apiVersion"] as const)(
    "checks %s against the selected release entry",
    (field) => {
      const changed = { ...manifest, [field]: field === "apiVersion" ? 2 : "different" };
      expect(() => validatePluginPackage({ ...pkg, manifest: changed }, entry)).toThrow(
        /manifest/i,
      );
    },
  );
});
