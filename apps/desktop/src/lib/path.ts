/**
 * 规范化文件系统路径：
 * 1. 统一反斜杠为正斜杠；
 * 2. 去除 Windows 扩展长度路径前缀（如 `\\?\` 或 `//?/`）；
 * 3. 统一 Windows 盘符为大写（如 `c:` -> `C:`）；
 * 4. 去除尾部多余斜杠（保留根路径 `/` 或 `C:/`）。
 */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");

  // 去除 Windows \\?\ 或 //?/ 前缀
  if (normalized.startsWith("//?/")) {
    normalized = normalized.slice(4);
  }

  // 规范化盘符大写（例如 c:/ -> C:/，c: -> C:）
  normalized = normalized.replace(
    /^([a-zA-Z]):(\/|$)/,
    (_, letter: string, rest: string) => `${letter.toUpperCase()}:${rest}`,
  );

  // 去除末尾斜杠，保留根路径如 "/" 或 "C:/"
  if (normalized.length > 1 && normalized.endsWith("/") && !/^[A-Z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, "");
  }

  return normalized;
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");

  if (index === 0) {
    return "/";
  }

  if (index < 0) {
    return /^[A-Z]:$/i.test(normalized) ? normalized : ".";
  }

  const result = normalized.slice(0, index);
  if (/^[A-Z]:$/.test(result)) {
    return `${result}/`;
  }

  return result;
}

export function isSameOrChildPath(path: string, parentPath: string): boolean {
  const nPath = normalizePath(path);
  const nParent = normalizePath(parentPath);

  if (nPath === nParent || nPath.startsWith(`${nParent}/`)) {
    return true;
  }

  // Windows 路径大小写不敏感容差比较（带盘符或 Windows 环境）
  if (/^[A-Z]:/i.test(nPath) && /^[A-Z]:/i.test(nParent)) {
    const lPath = nPath.toLowerCase();
    const lParent = nParent.toLowerCase();
    return lPath === lParent || lPath.startsWith(`${lParent}/`);
  }

  return false;
}
