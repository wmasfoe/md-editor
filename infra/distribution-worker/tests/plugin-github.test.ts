import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePluginGitHub } from "../src/distribution/plugin-github.ts";
import type { Env } from "../src/types.ts";

const noEnv: Env = {};

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
      noEnv,
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
      noEnv,
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
      noEnv,
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
        noEnv,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pending)?.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });
});

const release = () => Response.json({ id: 42, tag_name: "v1" });
const assets = () => Response.json([{ id: 1, name: "inkpoint-plugin.json" }]);
const route = (input: RequestInfo | URL) =>
  String(input).endsWith("/assets?per_page=100&page=1") ? assets() : release();
/** Reads the Authorization header a mocked fetch call was made with. */
const authorizationOf = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

describe("plugin GitHub gateway rate-limit protection", () => {
  it("authenticates upstream requests when GITHUB_TOKEN is configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => route(input));
    vi.stubGlobal("fetch", fetchMock);
    await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/latest"),
      { GITHUB_TOKEN: "secret" },
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(authorizationOf(init)).toBe("Bearer secret");
    }
    expect(fetchMock).toHaveBeenCalled();
  });

  it("stays anonymous when no token is configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => route(input));
    vi.stubGlobal("fetch", fetchMock);
    await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/latest"),
      noEnv,
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(authorizationOf(init)).toBeUndefined();
    }
  });

  it("never forwards the token to a redirect target on another host", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assets?per_page=100&page=1")) return assets();
      if (url.endsWith("/assets/1"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/blob" },
        });
      if (url.startsWith("https://objects.githubusercontent.com")) return new Response("{}");
      return release();
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/42/assets/1"),
      { GITHUB_TOKEN: "secret" },
    );
    expect(response?.status).toBe(200);
    const redirected = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith("https://objects.githubusercontent.com"),
    );
    expect(redirected).toBeDefined();
    expect(authorizationOf(redirected?.[1])).toBeUndefined();
  });

  it("asks the edge to cache upstream metadata but never the binary asset", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assets/1")) return new Response("{}");
      return route(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    await handlePluginGitHub(
      new Request("https://example.com/plugins/github/owner/repo/releases/42/assets/1"),
      noEnv,
    );
    const byUrl = (suffix: string) =>
      fetchMock.mock.calls.find(([input]) => String(input).endsWith(suffix))?.[1] as
        (RequestInit & { cf?: { cacheTtl?: number; cacheEverything?: boolean } }) | undefined;
    expect(byUrl("/assets?per_page=100&page=1")?.cf?.cacheEverything).toBe(true);
    expect(byUrl("/assets/1")?.cf).toBeUndefined();
  });

  it("uses a long TTL for immutable releases and a short TTL for moving selectors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => route(input));
    vi.stubGlobal("fetch", fetchMock);
    const ttl = async (path: string) => {
      fetchMock.mockClear();
      await handlePluginGitHub(
        new Request(`https://example.com/plugins/github/owner/repo/releases/${path}`),
        noEnv,
      );
      const call = fetchMock.mock.calls.find(([input]) => !String(input).includes("/assets"));
      return (call?.[1] as { cf?: { cacheTtl?: number } } | undefined)?.cf?.cacheTtl;
    };
    const immutable = await ttl("id/42");
    const latest = await ttl("latest");
    expect(immutable).toBeGreaterThan(latest ?? Infinity);
  });
});
