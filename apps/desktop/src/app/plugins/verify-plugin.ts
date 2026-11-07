import { validatePluginPackage } from "@md-editor/plugin-host";
import type { PluginVersion } from "./storage";

/** Recheck the exact downloaded bytes before executing an offline copy. */
export async function verifyStoredPlugin(id: string, version: PluginVersion) {
  if (version.source.pluginId !== id || typeof version.raw !== "string")
    throw new Error("插件来源不匹配");
  const bytes = new TextEncoder().encode(version.raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== version.source.sha256) throw new Error("插件内容摘要不匹配");
  const verified = validatePluginPackage(JSON.parse(version.raw));
  if (verified.manifest.id !== id) throw new Error("插件清单 ID 不匹配");
  for (const key of ["id", "name", "version", "description", "apiVersion"] as const) {
    if (version.package.manifest[key] !== verified.manifest[key]) throw new Error("插件清单不匹配");
  }
  return verified;
}
