import { describe, expect, it } from "vitest";
import { verifyStoredPlugin } from "../../../src/app/plugins/verify-plugin";
import type { PluginVersion } from "../../../src/app/plugins/storage";

async function version(): Promise<PluginVersion> {
  const pkg = {
    manifest: {
      id: "author.example",
      name: "Example",
      version: "1.0.0",
      description: "Example",
      apiVersion: 1 as const,
    },
    code: "export default {}",
    examples: [],
  };
  const raw = JSON.stringify(pkg);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const sha256 = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    package: pkg,
    raw,
    source: {
      owner: "author",
      repo: "plugins",
      releaseId: 1,
      tag: "v1",
      assetId: 2,
      pluginId: pkg.manifest.id,
      sha256,
    },
  };
}
describe("cached plugin verification", () => {
  it("validates the exact stored release bytes before use", async () => {
    const item = await version();
    expect((await verifyStoredPlugin(item.source.pluginId, item)).manifest.id).toBe(
      item.source.pluginId,
    );
    await expect(
      verifyStoredPlugin(item.source.pluginId, { ...item, raw: `${item.raw} ` }),
    ).rejects.toThrow("插件内容摘要不匹配");
    await expect(verifyStoredPlugin("other.plugin", item)).rejects.toThrow("插件来源不匹配");
    await expect(
      verifyStoredPlugin(item.source.pluginId, {
        ...item,
        package: { ...item.package, manifest: { ...item.package.manifest, name: "Changed" } },
      }),
    ).rejects.toThrow("插件清单不匹配");
  });
});
