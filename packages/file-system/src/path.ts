/** Shared lexical path semantics. No platform APIs or filesystem access are used. */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  // Extended UNC paths retain their network-share identity after prefix removal.
  if (normalized.startsWith("//?/UNC/")) normalized = "//" + normalized.slice(8);
  else if (normalized.startsWith("//?/")) normalized = normalized.slice(4);
  normalized = normalized.replace(/^[a-z]:/i, (drive) => drive.toUpperCase());
  const root = normalized.match(/^\/\/[^/]+\/[^/]+(?=\/|$)|^[A-Z]:\/?|^\//)?.[0] ?? "";
  // C:notes is relative to the drive's current directory. Protect the drive
  // prefix from dot-segment removal without clamping relative parent segments.
  const driveRelative = /^[A-Z]:$/.test(root);
  const segments: string[] = [];
  for (const segment of normalized.slice(root.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") segments.pop();
      else if (!root || driveRelative) segments.push(segment);
    } else segments.push(segment);
  }
  const separator = root && !root.endsWith("/") && !driveRelative && segments.length ? "/" : "";
  return root + separator + segments.join("/");
}

function comparisonPath(path: string): string {
  const normalized = normalizePath(path);
  return /^[A-Z]:/i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function isSamePath(path: string, other: string): boolean {
  return comparisonPath(path) === comparisonPath(other);
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  // A UNC share is a root, just like / or C:/; never walk into its server name.
  if (
    normalized === "/" ||
    /^[A-Z]:\/$/.test(normalized) ||
    /^\/\/[^/]+\/[^/]+$/.test(normalized)
  ) {
    return normalized;
  }
  const index = normalized.lastIndexOf("/");
  if (index === 0) return "/";
  if (index < 0) return normalized.match(/^[A-Z]:/)?.[0] ?? ".";
  const parent = normalized.slice(0, index);
  return /^[A-Z]:$/.test(parent) ? `${parent}/` : parent;
}

export function isSameOrChildPath(path: string, parentPath: string): boolean {
  const child = comparisonPath(path);
  const parent = comparisonPath(parentPath);
  return (
    child === parent ||
    (parent !== "" && child.startsWith(parent.endsWith("/") ? parent : `${parent}/`))
  );
}

export function relativePathFromRoot(rootPath: string, path: string): string {
  const root = normalizePath(rootPath);
  const normalized = normalizePath(path);
  if (isSamePath(normalized, root)) return "";
  if (!isSameOrChildPath(normalized, root)) return normalized;
  return normalized.slice(root.length + (root.endsWith("/") ? 0 : 1));
}

export function basename(path: string): string {
  const normalized = normalizePath(path).replace(/^[A-Z]:/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function joinPath(...segments: readonly string[]): string {
  const [first = "", ...rest] = segments
    .filter(Boolean)
    .map((segment) => segment.replace(/\\/g, "/"));
  // Only the first segment owns the root; a joining separator must not create UNC.
  const joined = rest.reduce(
    (path, segment) => `${path.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`,
    first,
  );
  return normalizePath(joined);
}
