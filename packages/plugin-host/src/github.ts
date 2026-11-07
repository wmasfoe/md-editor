import type { PluginCatalogEntry, PluginPackage } from "@md-editor/plugin-sdk";
import {
  MAX_CATALOG_BYTES,
  MAX_PACKAGE_BYTES,
  validateCatalog,
  validatePluginPackage,
} from "./validation.ts";

export interface PluginSource {
  owner: string;
  repo: string;
  releaseId: number;
  tag: string;
  assetId: number;
  pluginId: string;
  sha256: string;
}
export interface GitHubPluginCatalog {
  owner: string;
  repo: string;
  releaseId: number;
  tag: string;
  pinnedSha256?: string;
  pinnedPluginId?: string;
  plugins: Array<PluginCatalogEntry & { assetId: number; digest: string | null }>;
}
export interface GitHubOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}
const defaultBase = "https://download.jiaqi.im";
const name = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const hash = /^[a-f0-9]{64}$/;

export function createPluginInstallUrl(source: PluginSource): string {
  const url = new URL("/plugins/preview", defaultBase);
  for (const [key, value] of Object.entries(source)) url.searchParams.set(key, String(value));
  return url.href;
}
export function createPluginPreviewUrl(source: PluginSource): string {
  const url = new URL("https://editor.jiaqi.im/playground/plugins");
  url.searchParams.set("install", createPluginInstallUrl(source));
  return url.href;
}
export function parsePluginInstallUrl(value: string): PluginSource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== defaultBase || url.pathname !== "/plugins/preview") return null;
  const owner = url.searchParams.get("owner") ?? "",
    repo = url.searchParams.get("repo") ?? "",
    tag = url.searchParams.get("tag") ?? "",
    pluginId = url.searchParams.get("pluginId") ?? "",
    sha256 = url.searchParams.get("sha256") ?? "";
  const releaseId = Number(url.searchParams.get("releaseId")),
    assetId = Number(url.searchParams.get("assetId"));
  if (
    !name.test(owner) ||
    !name.test(repo) ||
    !tag ||
    !pluginId ||
    !hash.test(sha256) ||
    !Number.isSafeInteger(releaseId) ||
    releaseId <= 0 ||
    !Number.isSafeInteger(assetId) ||
    assetId <= 0
  )
    return null;
  return { owner, repo, releaseId, tag, assetId, pluginId, sha256 };
}
function parseSource(source: string): { owner: string; repo: string; selector: string } {
  const pinned = parsePluginInstallUrl(source);
  if (pinned) return { owner: pinned.owner, repo: pinned.repo, selector: `id/${pinned.releaseId}` };
  let path = source.trim();
  if (/^https?:/i.test(path)) {
    const url = new URL(path);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      throw new Error("Expected a public GitHub repository URL");
    path = url.pathname.replace(/^\//, "");
  }
  const parts = path.replace(/\/$/, "").split("/");
  const [owner, repo] = parts;
  if (!owner || !repo || !name.test(owner) || !name.test(repo))
    throw new Error("Invalid GitHub repository");
  if (
    parts.length === 2 ||
    (parts.length === 4 && parts[2] === "releases" && parts[3] === "latest")
  )
    return { owner, repo, selector: "latest" };
  if (parts.length === 4 && parts[2] === "releases" && /^[1-9][0-9]*$/.test(parts[3] ?? "")) {
    return { owner, repo, selector: `id/${parts[3]}` };
  }
  if (parts.length >= 5 && parts[2] === "releases" && parts[3] === "tag")
    return {
      owner,
      repo,
      selector: `tags/${encodeURIComponent(decodeURIComponent(parts.slice(4).join("/")))}`,
    };
  throw new Error("Invalid GitHub release URL");
}
async function read(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Plugin distribution returned ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Invalid plugin asset size");
  }
  if (!response.body) throw new Error("Invalid plugin asset size");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Plugin asset exceeds size limit");
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
function endpoint(owner: string, repo: string, options: GitHubOptions): string {
  return `${(options.baseUrl ?? defaultBase).replace(/\/$/, "")}/plugins/github/${owner}/${repo}/releases`;
}
async function fetchBytes(url: string, limit: number, options: GitHubOptions): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await read(await (options.fetch ?? fetch)(url, { signal: controller.signal }), limit);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function sha(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function verifyDigest(digest: string | null, actual: string): void {
  if (digest !== null && digest !== `sha256:${actual}`)
    throw new Error("GitHub asset digest mismatch");
}
export async function getPluginCatalog(
  source: string,
  options: GitHubOptions = {},
): Promise<GitHubPluginCatalog> {
  const { owner, repo, selector } = parseSource(source),
    base = endpoint(owner, repo, options);
  const release = JSON.parse(
    new TextDecoder().decode(await fetchBytes(`${base}/${selector}`, MAX_PACKAGE_BYTES, options)),
  ) as {
    id: number;
    tag: string;
    assets: Array<{ id: number; name: string; digest: string | null }>;
  };
  if (
    (selector.startsWith("id/") && release.id !== Number(selector.slice(3))) ||
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    typeof release.tag !== "string" ||
    !release.tag ||
    !Array.isArray(release.assets) ||
    release.assets.some(
      (asset) =>
        !Number.isSafeInteger(asset.id) ||
        asset.id <= 0 ||
        typeof asset.name !== "string" ||
        (asset.digest !== null && typeof asset.digest !== "string"),
    )
  )
    throw new Error("Invalid release metadata");
  const matches = (asset: string) => release.assets.filter((item) => item.name === asset);
  const catalogAssets = matches("inkpoint-plugin.json");
  if (catalogAssets.length !== 1) throw new Error("Release must contain one plugin catalog");
  const bytes = await fetchBytes(
    `${base}/${release.id}/assets/${catalogAssets[0]!.id}`,
    MAX_CATALOG_BYTES,
    options,
  );
  verifyDigest(catalogAssets[0]!.digest, await sha(bytes));
  const catalog = validateCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  const plugins = catalog.plugins.map((entry) => {
    const assets = matches(entry.asset);
    if (assets.length !== 1) throw new Error("Catalog asset missing or duplicated");
    return { ...entry, assetId: assets[0]!.id, digest: assets[0]!.digest };
  });
  const pinned = parsePluginInstallUrl(source);
  if (
    pinned &&
    (pinned.releaseId !== release.id ||
      pinned.tag !== release.tag ||
      !plugins.some((entry) => entry.id === pinned.pluginId && entry.assetId === pinned.assetId))
  )
    throw new Error("Pinned plugin source mismatch");
  return {
    owner,
    repo,
    releaseId: release.id,
    tag: release.tag,
    plugins: pinned ? plugins.filter((entry) => entry.id === pinned.pluginId) : plugins,
    ...(pinned ? { pinnedSha256: pinned.sha256, pinnedPluginId: pinned.pluginId } : {}),
  };
}
export async function downloadPlugin(
  catalog: GitHubPluginCatalog,
  pluginId: string,
  options: GitHubOptions = {},
): Promise<{ package: PluginPackage; source: PluginSource; raw: string }> {
  if (catalog.pinnedPluginId && catalog.pinnedPluginId !== pluginId)
    throw new Error("Pinned plugin id mismatch");
  const entry = catalog.plugins.find((item) => item.id === pluginId);
  if (!entry) throw new Error("Plugin not found in catalog");
  const bytes = await fetchBytes(
    `${endpoint(catalog.owner, catalog.repo, options)}/${catalog.releaseId}/assets/${entry.assetId}`,
    MAX_PACKAGE_BYTES,
    options,
  );
  const sha256 = await sha(bytes);
  verifyDigest(entry.digest, sha256);
  if (catalog.pinnedSha256 && catalog.pinnedSha256 !== sha256)
    throw new Error("Pinned plugin digest mismatch");
  // Preserve the exact UTF-8 representation for later integrity checks.
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const pluginPackage = validatePluginPackage(JSON.parse(raw), entry);
  return {
    package: pluginPackage,
    raw,
    source: {
      owner: catalog.owner,
      repo: catalog.repo,
      releaseId: catalog.releaseId,
      tag: catalog.tag,
      assetId: entry.assetId,
      pluginId,
      sha256,
    },
  };
}
