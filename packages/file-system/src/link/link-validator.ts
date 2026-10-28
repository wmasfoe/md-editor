/**
 * @fileoverview 本地相对链接与图片可达性探针 (LinkValidator)
 *
 * 遵循原则（吸收 VMark 实践）：
 * 1. 只查本地相对路径（外部 URL、mailto、纯锚点 # 跳过）；
 * 2. 相对源文件目录基于标准 URL 解码后再查；
 * 3. 异步并行 + 按解析后路径去重探针；
 * 4. 容错降级（Fail-open）：I/O 权限异常判 access-error 而非 missing。
 */

import { dirname, joinPath } from "../index.ts";

export interface LinkDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly rawTarget: string;
  readonly resolvedPath: string;
  readonly anchor?: string;
  readonly kind: "missing" | "anchor-missing" | "access-error";
  readonly message: string;
}

export interface LinkValidationOptions {
  /** 当前正在编辑的文档的绝对路径 */
  readonly documentPath: string;
  /** 磁盘或存储层的文件存在性探针 */
  readonly fileExists: (absolutePath: string) => Promise<boolean>;
  /** 可选：用于比对跨文档标题锚点的文件内容读取器 */
  readonly readFile?: (absolutePath: string) => Promise<string | null>;
}

/** 外部协议或无需检查的 scheme 判定 */
const EXTERNAL_URL_REGEX = /^(?:[a-z]+:|\/\/)/i;

interface ExtractedLink {
  readonly from: number;
  readonly to: number;
  readonly rawUrl: string;
}

/**
 * 规范化路径段，消除 `.` 与 `..`
 */
export function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const isAbsolute = normalized.startsWith("/");
  const isWindowsAbsolute = /^[a-zA-Z]:\//i.test(normalized);
  const segments = normalized.split("/");
  const result: string[] = [];

  for (const seg of segments) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!isAbsolute && !isWindowsAbsolute) {
        result.push("..");
      }
    } else {
      result.push(seg);
    }
  }

  if (isWindowsAbsolute) {
    const drive = normalized.slice(0, 2);
    const rest = result.slice(1).join("/");
    return rest ? `${drive}/${rest}` : `${drive}/`;
  }
  return (isAbsolute ? "/" : "") + result.join("/");
}

/**
 * 从 Markdown 文本中正则扫描所有标准内联链接与图片 `[...](...)` 和 `![...](...)`
 */
function extractMarkdownLinks(markdown: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  // 匹配形如 `[text](url)` 或 `![alt](url)`
  const linkRegex = /!?\[(?:[^\]\\]|\\.)*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    let url = match[1].trim();
    // 剥离尖括号包围 `<path>`
    if (url.startsWith("<") && url.endsWith(">")) {
      url = url.slice(1, -1).trim();
    }
    // match.index 是整个匹配的起始，寻找括号内 url 的偏移
    const parenIndex = match[0].indexOf("(");
    const urlOffsetInMatch = match[0].indexOf(match[1], parenIndex);
    const from = match.index + urlOffsetInMatch;
    const to = from + match[1].length;

    links.push({ from, to, rawUrl: url });
  }

  return links;
}

/**
 * 校验 Markdown 文本中的本地相对链接
 */
export async function validateMarkdownRelativeLinks(
  markdown: string,
  options: LinkValidationOptions,
): Promise<readonly LinkDiagnostic[]> {
  const { documentPath, fileExists, readFile } = options;
  const docDir = dirname(documentPath);
  const extracted = extractMarkdownLinks(markdown);

  if (extracted.length === 0) {
    return [];
  }

  // 1. 过滤：只保留本地相对路径（跳过外部 URL、跳过同文件纯锚点 `#...`）
  interface Candidate {
    readonly link: ExtractedLink;
    readonly cleanPath: string;
    readonly anchor?: string;
    readonly resolvedPath: string;
  }

  const candidates: Candidate[] = [];
  const uniquePathsToProbe = new Set<string>();

  for (const item of extracted) {
    const raw = item.rawUrl;
    if (EXTERNAL_URL_REGEX.test(raw) || raw.startsWith("#") || raw.length === 0) {
      continue;
    }

    // 分离目标文件路径与锚点 `#`
    const hashIndex = raw.indexOf("#");
    const targetFilePath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const anchor = hashIndex >= 0 ? raw.slice(hashIndex + 1) : undefined;

    let decodedTarget: string;
    try {
      decodedTarget = decodeURIComponent(targetFilePath);
    } catch {
      decodedTarget = targetFilePath;
    }

    if (!decodedTarget.trim()) {
      continue;
    }

    // 计算绝对路径并规整化 . / ..
    const isAbs = decodedTarget.startsWith("/") || /^[a-zA-Z]:\//i.test(decodedTarget);
    const rawResolved = isAbs ? decodedTarget : joinPath(docDir, decodedTarget);
    const resolvedPath = normalizePath(rawResolved);

    candidates.push({
      link: item,
      cleanPath: decodedTarget,
      anchor,
      resolvedPath,
    });
    uniquePathsToProbe.add(resolvedPath);
  }

  // 2. 异步并行探针存在性（按解析后路径去重）
  const existenceMap = new Map<string, { exists: boolean; accessError?: boolean }>();
  await Promise.all(
    Array.from(uniquePathsToProbe).map(async (absPath) => {
      try {
        const exists = await fileExists(absPath);
        existenceMap.set(absPath, { exists });
      } catch {
        // Fail-open: 权限/沙箱异常标记 accessError
        existenceMap.set(absPath, { exists: false, accessError: true });
      }
    }),
  );

  // 3. 构建诊断列表
  const diagnostics: LinkDiagnostic[] = [];

  for (const candidate of candidates) {
    const probe = existenceMap.get(candidate.resolvedPath);
    if (!probe) continue;

    if (probe.accessError) {
      diagnostics.push({
        from: candidate.link.from,
        to: candidate.link.to,
        rawTarget: candidate.link.rawUrl,
        resolvedPath: candidate.resolvedPath,
        anchor: candidate.anchor,
        kind: "access-error",
        message: `无法访问目标文件（权限受限或路径不可读）：${candidate.cleanPath}`,
      });
      continue;
    }

    if (!probe.exists) {
      diagnostics.push({
        from: candidate.link.from,
        to: candidate.link.to,
        rawTarget: candidate.link.rawUrl,
        resolvedPath: candidate.resolvedPath,
        anchor: candidate.anchor,
        kind: "missing",
        message: `目标文件不存在：${candidate.cleanPath}`,
      });
      continue;
    }

    // 4. 若目标存在且带有锚点，且提供了 readFile，比对锚点有效性
    if (candidate.anchor && readFile && candidate.resolvedPath.endsWith(".md")) {
      try {
        const targetContent = await readFile(candidate.resolvedPath);
        if (targetContent !== null) {
          const headingSlugFound = checkHeadingSlugExists(targetContent, candidate.anchor);
          if (!headingSlugFound) {
            diagnostics.push({
              from: candidate.link.from,
              to: candidate.link.to,
              rawTarget: candidate.link.rawUrl,
              resolvedPath: candidate.resolvedPath,
              anchor: candidate.anchor,
              kind: "anchor-missing",
              message: `目标文件内未找到锚点标题 #${candidate.anchor}`,
            });
          }
        }
      } catch {
        // readFile 失败不打断主链
      }
    }
  }

  return diagnostics;
}

/**
 * 校验 Markdown 文本中是否存在对应 slug 的标题
 */
function checkHeadingSlugExists(markdown: string, anchor: string): boolean {
  const headingRegex = /^#{1,6}\s+(.+)$/gmu;
  let match: RegExpExecArray | null;
  const targetAnchor = anchor.trim().toLowerCase();

  while ((match = headingRegex.exec(markdown)) !== null) {
    const title = match[1].trim();
    // 简易 slug 规则：去标点、空格转中划线
    const slug = title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s-]/gu, "")
      .replace(/\s+/gu, "-");
    if (slug === targetAnchor || title.toLowerCase() === targetAnchor) {
      return true;
    }
  }

  return false;
}
