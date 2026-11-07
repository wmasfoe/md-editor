import type {
  PluginCatalog,
  PluginCatalogEntry,
  PluginPackage,
  PluginSettingDefinition,
  PluginSettingValue,
} from "@md-editor/plugin-sdk";

export const MAX_CATALOG_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function requireManifest(value: unknown): asserts value is PluginCatalogEntry {
  if (
    !object(value) ||
    !nonempty(value.id) ||
    !idPattern.test(value.id) ||
    !nonempty(value.name) ||
    !nonempty(value.version) ||
    !nonempty(value.description) ||
    value.apiVersion !== 1
  )
    throw new Error("Invalid plugin manifest");
}

function checkSize(value: unknown, limit: number): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("Invalid JSON value");
  }
  if (json === undefined || new TextEncoder().encode(json).byteLength > limit)
    throw new Error("Plugin data exceeds size limit");
}

export function validateCatalog(value: unknown): PluginCatalog {
  checkSize(value, MAX_CATALOG_BYTES);
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins))
    throw new Error("Invalid plugin catalog");
  const ids = new Set<string>();
  const assets = new Set<string>();
  for (const entry of value.plugins) {
    requireManifest(entry);
    if (!nonempty(entry.asset) || ids.has(entry.id) || assets.has(entry.asset))
      throw new Error("Invalid or duplicate catalog entry");
    ids.add(entry.id);
    assets.add(entry.asset);
  }
  return value as unknown as PluginCatalog;
}

export function isSettingValue(
  definition: PluginSettingDefinition,
  value: unknown,
): value is PluginSettingValue {
  switch (definition.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && definition.values.includes(value);
  }
}

export function validatePluginPackage(
  value: unknown,
  selected?: PluginCatalogEntry,
): PluginPackage {
  checkSize(value, MAX_PACKAGE_BYTES);
  if (!object(value)) throw new Error("Invalid plugin package");
  requireManifest(value.manifest);
  if (
    selected &&
    (["id", "name", "version", "description", "apiVersion"] as const).some(
      (key) => selected[key] !== (value.manifest as unknown as Record<string, unknown>)[key],
    )
  )
    throw new Error("Plugin manifest does not match catalog");
  if (
    !nonempty(value.code) ||
    (value.styles !== undefined && typeof value.styles !== "string") ||
    !Array.isArray(value.examples)
  )
    throw new Error("Invalid plugin package content");
  const ids = new Set<string>();
  for (const example of value.examples) {
    if (
      !object(example) ||
      !nonempty(example.id) ||
      ids.has(example.id) ||
      !nonempty(example.name) ||
      typeof example.markdown !== "string" ||
      (example.instructions !== undefined && typeof example.instructions !== "string")
    )
      throw new Error("Invalid plugin example");
    if (
      example.selection !== undefined &&
      (!object(example.selection) ||
        !Number.isInteger(example.selection.anchor) ||
        !Number.isInteger(example.selection.head) ||
        (example.selection.anchor as number) < 0 ||
        (example.selection.head as number) < 0 ||
        (example.selection.anchor as number) > example.markdown.length ||
        (example.selection.head as number) > example.markdown.length)
    )
      throw new Error("Invalid example selection");
    ids.add(example.id);
  }
  if (value.settings !== undefined) {
    if (!object(value.settings)) throw new Error("Invalid plugin settings");
    for (const [key, definition] of Object.entries(value.settings)) {
      if (
        !nonempty(key) ||
        !object(definition) ||
        !nonempty(definition.label) ||
        !["string", "number", "boolean", "enum"].includes(String(definition.type))
      )
        throw new Error("Invalid plugin setting");
      if (
        definition.type === "enum" &&
        (!Array.isArray(definition.values) ||
          definition.values.length === 0 ||
          definition.values.some((item) => typeof item !== "string") ||
          new Set(definition.values).size !== definition.values.length)
      )
        throw new Error("Invalid plugin setting options");
      if (!isSettingValue(definition as unknown as PluginSettingDefinition, definition.default))
        throw new Error("Invalid plugin setting default");
    }
  }
  return value as unknown as PluginPackage;
}
