export interface LinkHrefParts {
  readonly path: string;
  readonly fragment: string | null;
}

const HTTP_URL_PATTERN = /^https?:\/\//iu;
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export function isHttpLink(href: string): boolean {
  return HTTP_URL_PATTERN.test(href.trim());
}

export function isExternalSchemeLink(href: string): boolean {
  const value = href.trim();
  return EXTERNAL_SCHEME_PATTERN.test(value) && !isWindowsAbsolutePath(value);
}

export function splitLinkHref(href: string): LinkHrefParts {
  const trimmed = href.trim();
  const hashIndex = trimmed.indexOf("#");

  if (hashIndex < 0) {
    return { path: trimmed, fragment: null };
  }

  return {
    path: trimmed.slice(0, hashIndex),
    fragment: decodeLinkFragment(trimmed.slice(hashIndex + 1))
  };
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

export function normalizeLocalHrefPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const unwrapped = withoutQuery.startsWith("<") && withoutQuery.endsWith(">")
    ? withoutQuery.slice(1, -1)
    : withoutQuery;

  try {
    return decodeURI(unwrapped);
  } catch {
    return unwrapped;
  }
}

function decodeLinkFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value);
}
