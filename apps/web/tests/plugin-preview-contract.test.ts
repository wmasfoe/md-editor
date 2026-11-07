import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
describe("plugin trial isolation", () => {
  it("uses an opaque sandbox and sends the selected package through a private port", () => {
    const page = read("../src/plugin-preview/PluginPreviewPage.tsx");
    expect(page).toContain('sandbox="allow-scripts"');
    expect(page).not.toContain("allow-same-origin");
    expect(page).toContain("new MessageChannel()");
    expect(page).toContain("downloadPlugin(catalog, pluginId)");
  });
  it("has a separate entry with network and form restrictions", () => {
    const html = read("../plugin-guest.html");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("/src/plugin-preview/guest.tsx");
    expect(read("../src/plugin-preview/guest.tsx")).not.toContain('from "../App"');
  });
});
