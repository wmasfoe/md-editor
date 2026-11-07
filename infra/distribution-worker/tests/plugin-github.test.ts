import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePluginGitHub } from "../src/distribution/plugin-github.ts";

afterEach(() => vi.unstubAllGlobals());
describe("plugin GitHub gateway", () => {
  it("paginates release assets beyond 100", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/latest")) return Response.json({ id: 42, tag_name: "v1" });
      if (new URL(url).searchParams.get("page") === "1")
        return Response.json(
          Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `asset${i}` })),
        );
      return Response.json([{ id: 101, name: "inkpoint-plugin.json" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/latest"),
    );
    expect(response?.status).toBe(200);
    expect(((await response!.json()) as { assets: unknown[] }).assets).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("rejects asset IDs outside the release and unsafe redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    const missing = await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/42/assets/99"),
    );
    expect(missing?.status).toBe(502);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: "https://evil.example/asset" } }),
      ),
    );
    const redirect = await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/latest"),
    );
    expect(redirect?.status).toBe(502);
  });
  it("aborts a slow request", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: RequestInfo | URL, init?: RequestInit) =>
            new Promise((_resolve, reject) =>
              init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
            ),
        ),
      );
      const pending = handlePluginGitHub(
        new Request("https://example.com/plugins/github/owner/repo/releases/latest"),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pending)?.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });
});
