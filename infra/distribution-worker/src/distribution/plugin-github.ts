import type { Env } from "../types.ts";

/** Public GitHub release access for plugin catalogs; callers cannot supply upstream URLs. */
const headers = {
  "User-Agent": "Inkpoint-Plugin-Distribution",
  "X-GitHub-Api-Version": "2022-11-28",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};
const validName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const validId = /^[1-9][0-9]*$/;

/**
 * Edge cache lifetimes for upstream metadata, in seconds.
 * A release addressed by numeric ID and its asset list are effectively immutable once published,
 * while `latest` and tags can move, so they get a short lifetime to pick up new publishes quickly.
 */
const IMMUTABLE_TTL = 3600;
const MOVING_TTL = 60;

type Cacheable = { cacheTtl: number } | false;

/**
 * Unauthenticated requests share a 60/hour limit per egress IP, which Workers share. A token lifts
 * that to 5000/hour. `cache` lets Cloudflare serve repeated metadata reads without hitting GitHub;
 * binary asset downloads are never cached here because they redirect to GitHub's asset CDN.
 */
async function github(
  env: Env,
  path: string,
  signal: AbortSignal,
  options: { binary?: boolean; cache?: Cacheable } = {},
): Promise<Response> {
  const { binary = false, cache = false } = options;
  let url = `https://api.github.com${path}`;
  for (let redirects = 0; redirects < 4; redirects++) {
    // Credentials must only ever be sent to GitHub's API host, never to a redirect target.
    const sendToken = Boolean(env.GITHUB_TOKEN) && new URL(url).hostname === "api.github.com";
    const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
      headers: {
        ...headers,
        Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
        ...(sendToken ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
      redirect: "manual",
      signal,
    };
    if (cache && redirects === 0) init.cf = { cacheTtl: cache.cacheTtl, cacheEverything: true };
    const response = await fetch(url, init);
    if (response.status < 300 || response.status >= 400) {
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("GitHub redirect has no location");
    const next = new URL(location, url);
    // Release downloads are hosted on GitHub's dedicated asset domains.
    if (
      next.protocol !== "https:" ||
      ![
        "api.github.com",
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(next.hostname) ||
      next.username ||
      next.password ||
      next.port
    )
      throw new Error("Invalid GitHub redirect");
    url = next.href;
  }
  throw new Error("Too many GitHub redirects");
}

async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Asset exceeds size limit");
  }
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Asset exceeds size limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function handlePluginGitHub(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/plugins/github/")) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET")
    return new Response("Method not allowed", { status: 405, headers: cors });
  const parts = url.pathname.split("/").slice(3);
  const [owner, repo, releases, selector, ...rest] = parts;
  if (!owner || !repo || !validName.test(owner) || !validName.test(repo) || releases !== "releases")
    return new Response("Invalid repository", { status: 400, headers: cors });
  const base = `/repos/${owner}/${repo}/releases`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    if (
      selector &&
      validId.test(selector) &&
      rest[0] === "assets" &&
      rest.length === 2 &&
      validId.test(rest[1] ?? "")
    ) {
      // Verify membership against the release before retrieving the asset.
      const assets = await listAssets(env, base, selector, controller.signal, IMMUTABLE_TTL);
      const asset = assets.find((item) => item.id === Number(rest[1]));
      if (!asset) throw new Error("Asset does not belong to release");
      const response = await github(env, `${base}/assets/${rest[1]}`, controller.signal, {
        binary: true,
      });
      const bytes = await bounded(
        response,
        asset.name === "inkpoint-plugin.json" ? 1024 * 1024 : 10 * 1024 * 1024,
      );
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: { ...cors, "Content-Type": "application/octet-stream" },
      });
    }
    let suffix: string;
    let ttl = MOVING_TTL;
    if (selector === "latest" && rest.length === 0) suffix = "/latest";
    else if (selector === "id" && rest.length === 1 && validId.test(rest[0] ?? "")) {
      suffix = `/${rest[0]}`;
      ttl = IMMUTABLE_TTL;
    } else if (selector === "tags" && rest.length === 1 && rest[0]) suffix = `/tags/${rest[0]}`;
    else return new Response("Invalid release selector", { status: 400, headers: cors });
    const response = await github(env, `${base}${suffix}`, controller.signal, {
      cache: { cacheTtl: ttl },
    });
    const release = JSON.parse(new TextDecoder().decode(await bounded(response, 1024 * 1024))) as {
      id: number;
      tag_name: string;
      draft?: boolean;
    };
    if (
      !Number.isSafeInteger(release.id) ||
      release.id <= 0 ||
      typeof release.tag_name !== "string" ||
      release.draft
    )
      throw new Error("Invalid release");
    // The asset list of a resolved release ID cannot change underneath that ID, so cache it long
    // even when the release itself was found through a moving selector.
    const assets = await listAssets(
      env,
      base,
      String(release.id),
      controller.signal,
      IMMUTABLE_TTL,
    );
    return new Response(JSON.stringify({ id: release.id, tag: release.tag_name, assets }), {
      headers: cors,
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    controller.abort();
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "GitHub request failed" }),
      { status: timedOut ? 504 : 502, headers: cors },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function listAssets(
  env: Env,
  base: string,
  releaseId: string,
  signal: AbortSignal,
  ttl: number,
): Promise<Array<{ id: number; name: string; digest: string | null }>> {
  const assets: Array<{ id: number; name: string; digest: string | null }> = [];
  let metadataBytes = 0;
  for (let page = 1; ; page++) {
    const response = await github(
      env,
      `${base}/${releaseId}/assets?per_page=100&page=${page}`,
      signal,
      { cache: { cacheTtl: ttl } },
    );
    const bytes = await bounded(response, 1024 * 1024);
    metadataBytes += bytes.byteLength;
    if (metadataBytes > 10 * 1024 * 1024)
      throw new Error("Release asset metadata exceeds size limit");
    const batch = JSON.parse(new TextDecoder().decode(bytes)) as Array<{
      id: number;
      name: string;
      digest?: string | null;
    }>;
    if (
      !Array.isArray(batch) ||
      batch.some(
        (item) => !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== "string",
      )
    )
      throw new Error("Invalid release assets");
    assets.push(
      ...batch.map((item) => ({ id: item.id, name: item.name, digest: item.digest ?? null })),
    );
    if (batch.length < 100) return assets;
  }
}
