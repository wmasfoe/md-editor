import { describe, expect, it } from "vitest";
import { getPluginCatalog, downloadPlugin, createPluginInstallUrl } from "../src/github.ts";

const entry = {
  id: "test",
  name: "Test",
  version: "1",
  description: "Test plugin",
  apiVersion: 1,
  asset: "plugin.json",
};
const pkg = {
  manifest: { id: "test", name: "Test", version: "1", description: "Test plugin", apiVersion: 1 },
  code: "export default {}",
  examples: [],
};
function mock(
  packageValue: unknown = pkg,
  assets = [
    { id: 1, name: "inkpoint-plugin.json", digest: null },
    { id: 2, name: "plugin.json", digest: null },
  ],
) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/latest")) return Response.json({ id: 10, tag: "v1", assets });
    if (url.endsWith("/id/10")) return Response.json({ id: 10, tag: "v1", assets });
    if (url.endsWith("/assets/1")) return Response.json({ schemaVersion: 1, plugins: [entry] });
    if (url.endsWith("/assets/2")) return Response.json(packageValue);
    throw new Error(url);
  }) as typeof fetch;
}
describe("GitHub plugin distribution", () => {
  it("loads and pins a selected package and checks the pinned digest", async () => {
    const options = { fetch: mock() };
    const catalog = await getPluginCatalog("owner/repo", options);
    const result = await downloadPlugin(catalog, "test", options);
    const pinned = await getPluginCatalog(createPluginInstallUrl(result.source), options);
    expect((await downloadPlugin(pinned, "test", options)).package.manifest.id).toBe("test");
    pinned.pinnedSha256 = "0".repeat(64);
    await expect(downloadPlugin(pinned, "test", options)).rejects.toThrow("digest mismatch");
  });
  it("preserves original package bytes for offline integrity verification", async () => {
    const raw = JSON.stringify({ ...pkg, code: "export default '你好'" }, null, 2) + "\n";
    const baseFetch = mock();
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/assets/2")
        ? new Response(raw)
        : baseFetch(input, init)) as typeof globalThis.fetch;
    const catalog = await getPluginCatalog("owner/repo", { fetch });
    const result = await downloadPlugin(catalog, "test", { fetch });
    expect(result.raw).toBe(raw);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.raw));
    expect(
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ).toBe(result.source.sha256);
  });
  it("rejects invalid UTF-8 package bytes", async () => {
    const baseFetch = mock();
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/assets/2")
        ? new Response(new Uint8Array([0xff]))
        : baseFetch(input, init)) as typeof globalThis.fetch;
    const catalog = await getPluginCatalog("owner/repo", { fetch });
    await expect(downloadPlugin(catalog, "test", { fetch })).rejects.toThrow(
      /encoded data|encoding|UTF-8/i,
    );
  });
  it("rejects missing and duplicate catalog assets", async () => {
    for (const assets of [
      [{ id: 1, name: "inkpoint-plugin.json", digest: null }],
      [
        { id: 1, name: "inkpoint-plugin.json", digest: null },
        { id: 2, name: "plugin.json", digest: null },
        { id: 3, name: "plugin.json", digest: null },
      ],
    ]) {
      await expect(getPluginCatalog("owner/repo", { fetch: mock(pkg, assets) })).rejects.toThrow(
        "asset",
      );
    }
  });
  it("checks the selected manifest and GitHub digest", async () => {
    const catalog = await getPluginCatalog("owner/repo", { fetch: mock() });
    await expect(
      downloadPlugin(catalog, "test", {
        fetch: mock({ ...pkg, manifest: { ...pkg.manifest, name: "Wrong" } }),
      }),
    ).rejects.toThrow("match");
    catalog.plugins[0]!.digest = `sha256:${"0".repeat(64)}`;
    await expect(downloadPlugin(catalog, "test", { fetch: mock() })).rejects.toThrow("digest");
  });
});
