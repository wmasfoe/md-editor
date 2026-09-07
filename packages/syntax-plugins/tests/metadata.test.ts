import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SYNTAX_PLUGINS_METADATA,
  getOfficialPluginMetadata,
  containerDirectivePlugin,
  mathPlugin,
  mermaidPlugin,
} from "../src/index.ts";

describe("syntax-plugins metadata", () => {
  it("defines metadata for all 3 official syntax plugins", () => {
    expect(OFFICIAL_SYNTAX_PLUGINS_METADATA).toHaveLength(3);
    const ids = OFFICIAL_SYNTAX_PLUGINS_METADATA.map((p) => p.id);
    expect(ids).toContain(mathPlugin.id);
    expect(ids).toContain(mermaidPlugin.id);
    expect(ids).toContain(containerDirectivePlugin.id);
  });

  it("marks all plugins as official and defaultEnabled by default", () => {
    for (const plugin of OFFICIAL_SYNTAX_PLUGINS_METADATA) {
      expect(plugin.isOfficial).toBe(true);
      expect(plugin.defaultEnabled).toBe(true);
      expect(plugin.name.length).toBeGreaterThan(0);
      expect(plugin.description.length).toBeGreaterThan(0);
      expect(plugin.tags.length).toBeGreaterThan(0);
      expect(plugin.syntaxHint.length).toBeGreaterThan(0);
    }
  });

  it("finds metadata by id using getOfficialPluginMetadata", () => {
    const math = getOfficialPluginMetadata("markdown.math");
    expect(math?.name).toBe("LaTeX 数学公式");
    expect(math?.category).toBe("syntax");

    const mermaid = getOfficialPluginMetadata("markdown.mermaid");
    expect(mermaid?.name).toBe("Mermaid 图表");
    expect(mermaid?.category).toBe("diagram");

    const unknown = getOfficialPluginMetadata("markdown.unknown");
    expect(unknown).toBeUndefined();
  });
});
