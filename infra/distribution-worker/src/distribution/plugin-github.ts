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

async function github(path: string, signal: AbortSignal, binary = false): Promise<Response> {
  let url = `https://api.github.com${path}`;
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(url, {
      headers: {
        ...headers,
        Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
      },
      redirect: "manual",
      signal,
    });
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

export async function handlePluginGitHub(request: Request): Promise<Response | null> {
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
      const assets = await listAssets(base, selector, controller.signal);
      const asset = assets.find((item) => item.id === Number(rest[1]));
      if (!asset) throw new Error("Asset does not belong to release");
      const response = await github(`${base}/assets/${rest[1]}`, controller.signal, true);
      const bytes = await bounded(
        response,
        asset.name === "inkpoint-plugin.json" ? 1024 * 1024 : 10 * 1024 * 1024,
      );
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: { ...cors, "Content-Type": "application/octet-stream" },
      });
    }
    let suffix: string;
    if (selector === "latest" && rest.length === 0) suffix = "/latest";
    else if (selector === "id" && rest.length === 1 && validId.test(rest[0] ?? ""))
      suffix = `/${rest[0]}`;
    else if (selector === "tags" && rest.length === 1 && rest[0]) suffix = `/tags/${rest[0]}`;
    else return new Response("Invalid release selector", { status: 400, headers: cors });
    const response = await github(`${base}${suffix}`, controller.signal);
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
    const assets = await listAssets(base, String(release.id), controller.signal);
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
  base: string,
  releaseId: string,
  signal: AbortSignal,
): Promise<Array<{ id: number; name: string; digest: string | null }>> {
  const assets: Array<{ id: number; name: string; digest: string | null }> = [];
  let metadataBytes = 0;
  for (let page = 1; ; page++) {
    const response = await github(`${base}/${releaseId}/assets?per_page=100&page=${page}`, signal);
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
