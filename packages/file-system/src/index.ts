import { err, normalizeLineEndings, ok, type Result } from "@md-editor/shared";
import {
  createFileSaveScheduler,
  type FileSaveScheduler,
  type FileSaveSchedulerOptions,
  type NativeSaveAdapter,
  type NativeSaveRuntimeRegistration,
} from "./save-scheduler";

export * from "./save-scheduler";

export interface MarkdownDocumentFile {
  readonly filePath: string;
  readonly markdown: string;
}

export interface MarkdownFileTreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "markdown" | "asset";
  readonly children?: readonly MarkdownFileTreeNode[];
}

export interface MarkdownFolder {
  readonly rootPath: string;
  readonly rootName: string;
  readonly tree: MarkdownFileTreeNode;
}

export interface CreateTreeItemInput {
  readonly rootPath: string;
  readonly parentPath: string;
  readonly name: string;
  readonly kind: "markdown" | "directory";
}

export interface RenameTreeItemInput {
  readonly rootPath: string;
  readonly path: string;
  readonly name: string;
}

export interface DeleteTreeItemInput {
  readonly rootPath: string;
  readonly path: string;
}

export interface FileTreeMutationResult {
  readonly folder: MarkdownFolder;
  readonly affectedPath: string | null;
}

export interface FileServiceAdapter {
  openMarkdownFile(): Promise<MarkdownDocumentFile | null>;
  openMarkdownFolder(): Promise<MarkdownFolder | null>;
  readMarkdownFile(path: string): Promise<MarkdownDocumentFile>;
  refreshMarkdownFolder(rootPath: string): Promise<MarkdownFolder>;
  createMarkdownTreeItem(input: CreateTreeItemInput): Promise<FileTreeMutationResult>;
  renameMarkdownTreeItem(input: RenameTreeItemInput): Promise<FileTreeMutationResult>;
  deleteMarkdownTreeItem(input: DeleteTreeItemInput): Promise<FileTreeMutationResult>;
}

export interface NewDocumentResult {
  readonly markdown: string;
  readonly filePath: null;
}

export interface FileService {
  newDocument(defaultMarkdown?: string): NewDocumentResult;
  openDocument(): Promise<MarkdownDocumentFile | null>;
  openFolder(): Promise<MarkdownFolder | null>;
  openDocumentAtPath(path: string): Promise<MarkdownDocumentFile>;
  refreshFolder(rootPath: string): Promise<MarkdownFolder>;
  createTreeItem(input: CreateTreeItemInput): Promise<FileTreeMutationResult>;
  renameTreeItem(input: RenameTreeItemInput): Promise<FileTreeMutationResult>;
  deleteTreeItem(input: DeleteTreeItemInput): Promise<FileTreeMutationResult>;
}

export type RuntimeFileService = FileService & FileSaveScheduler;

export interface ImagePasteInput {
  readonly documentPath: string | null;
  readonly mimeType: string;
  readonly preferredName?: string;
  readonly existingAssetNames?: readonly string[];
  readonly assetsDirectory?: string;
}

export interface ImagePasteTarget {
  readonly assetsDirectory: string;
  readonly fileName: string;
  readonly absolutePath: string;
  readonly markdownPath: string;
}

export interface ImageSaveContext {
  readonly documentPath: string;
  readonly defaultAssetsDir: string;
  readonly preferredName?: string;
}

export interface ImageSaveInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly context: ImageSaveContext;
}

export interface ImageSaveResult {
  readonly src: string;
  readonly storageType: "local" | "remote";
}

export interface ImageStorageProvider {
  save(input: ImageSaveInput): Promise<ImageSaveResult>;
}

export type ImagePasteError = "SAVE_FIRST" | "UNSUPPORTED_IMAGE_TYPE";

export function createFileService(adapter: FileServiceAdapter): FileService {
  return {
    newDocument(defaultMarkdown = "# Untitled\n\n") {
      // 新建文档必须从干净状态开始，避免把上一份文档的 dirty 标记带进来。
      return {
        markdown: defaultMarkdown,
        filePath: null,
      };
    },
    async openDocument() {
      return normalizeDocumentFile(await adapter.openMarkdownFile());
    },
    openFolder() {
      return adapter.openMarkdownFolder();
    },
    async openDocumentAtPath(path) {
      return normalizeRequiredDocumentFile(await adapter.readMarkdownFile(path));
    },
    refreshFolder(rootPath) {
      return adapter.refreshMarkdownFolder(rootPath);
    },
    createTreeItem(input) {
      return adapter.createMarkdownTreeItem(input);
    },
    renameTreeItem(input) {
      return adapter.renameMarkdownTreeItem(input);
    },
    deleteTreeItem(input) {
      return adapter.deleteMarkdownTreeItem(input);
    },
  };
}

function normalizeDocumentFile(document: MarkdownDocumentFile | null): MarkdownDocumentFile | null {
  return document ? normalizeRequiredDocumentFile(document) : null;
}

function normalizeRequiredDocumentFile(document: MarkdownDocumentFile): MarkdownDocumentFile {
  return Object.freeze({
    filePath: document.filePath,
    markdown: normalizeLineEndings(document.markdown),
  });
}

export function createRuntimeFileService(
  adapter: FileServiceAdapter,
  nativeSaveAdapter: NativeSaveAdapter,
  registration: NativeSaveRuntimeRegistration,
  options?: FileSaveSchedulerOptions,
): RuntimeFileService {
  const files = createFileService(adapter);
  return {
    newDocument: files.newDocument,
    openDocument: files.openDocument,
    openFolder: files.openFolder,
    openDocumentAtPath: files.openDocumentAtPath,
    refreshFolder: files.refreshFolder,
    createTreeItem: files.createTreeItem,
    renameTreeItem: files.renameTreeItem,
    deleteTreeItem: files.deleteTreeItem,
    ...createFileSaveScheduler(nativeSaveAdapter, registration, options),
  };
}

const imageExtensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function planImagePasteTarget(
  input: ImagePasteInput,
): Result<ImagePasteTarget, ImagePasteError> {
  if (!input.documentPath) {
    // 未保存文档没有稳定的相对路径基准，所以 v0.1 会先要求 Save As，
    // 再允许把图片写入同级 assets 目录。
    return err("SAVE_FIRST", "Save the document before pasting images.");
  }

  const extension = imageExtensions[input.mimeType];
  if (!extension) {
    return err("UNSUPPORTED_IMAGE_TYPE", `Unsupported image type: ${input.mimeType}`);
  }

  const resolved = resolveAssetsDirectoryForDocument(
    input.documentPath,
    input.assetsDirectory ?? "assets",
  );
  const assetsDirectory = resolved.assetsDirectory;
  const fileName = nextAssetFileName(
    extension,
    input.existingAssetNames ?? [],
    input.preferredName,
  );

  return ok({
    assetsDirectory,
    fileName,
    absolutePath: joinPath(assetsDirectory, fileName),
    markdownPath: `${resolved.markdownDirectory}/${fileName}`,
  });
}

export function nextAssetFileName(
  extension: string,
  existingNames: readonly string[],
  preferredName?: string,
): string {
  const names = new Set(existingNames);
  const normalizedExtension = extension.replace(/^\./u, "").toLowerCase();
  const base = sanitizeAssetBaseName(preferredName) ?? timestampSlug(new Date());
  let candidate = `${base}.${normalizedExtension}`;
  let index = 2;

  // 这里只避开当前可见的文件名冲突；真正写盘时仍需要原子创建/写入，
  // 用来处理并发或外部进程带来的竞态。
  while (names.has(candidate)) {
    candidate = `${base}-${index}.${normalizedExtension}`;
    index += 1;
  }

  return candidate;
}

export function appendImageMarkdown(markdown: string, markdownPath: string, altText = ""): string {
  const imageMarkdown = `![${altText}](${markdownPath})`;

  if (markdown.length === 0) {
    return `${imageMarkdown}\n`;
  }

  // 图片粘贴先采用最小可预期行为：追加标准 Markdown 图片语法。
  // 后续接入编辑器光标 API 时，可以替换为当前位置插入而不影响文件写盘契约。
  const separator = markdown.endsWith("\n") ? "\n" : "\n\n";
  return `${markdown}${separator}${imageMarkdown}\n`;
}

export function imageAltTextFromFileName(name?: string): string {
  return (
    name
      ?.replace(/\.[^.]+$/u, "")
      .trim()
      .replace(/[_-]+/gu, " ")
      .replace(/\s+/gu, " ") ?? ""
  );
}

export interface ResolvedAssetsDirectory {
  readonly assetsDirectory: string;
  readonly markdownDirectory: string;
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function documentStem(documentPath: string): string {
  const name = basename(documentPath);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

export function resolveAssetsDirectoryForDocument(
  documentPath: string,
  pattern = "assets",
): ResolvedAssetsDirectory {
  const normalizedDocPath = documentPath.replace(/\\/g, "/");
  const isWindowsAbsolute = /^[a-zA-Z]:\//i.test(normalizedDocPath);
  const docDir = dirname(normalizedDocPath);
  const stem = documentStem(normalizedDocPath);

  // 变量替换 ${filename} 为当前文档基础文件名（无后缀）
  const rawPattern = (pattern || "assets").trim().replace(/\\/g, "/");
  const interpolated = rawPattern.replace(/\$\{filename\}/g, stem);

  // 计算 Markdown 相对路径目录前缀（强制全平台一律正斜杠 /）
  const startsWithDotDot = interpolated.startsWith("../");
  const startsWithDot = interpolated.startsWith("./");

  let markdownDirectory: string;
  if (startsWithDotDot) {
    markdownDirectory = interpolated.replace(/\/+/g, "/");
  } else if (startsWithDot) {
    markdownDirectory = `./${interpolated.replace(/^\.\/+/g, "").replace(/\/+/g, "/")}`;
  } else {
    markdownDirectory = interpolated.replace(/^\.\/+/g, "").replace(/\/+/g, "/");
  }
  markdownDirectory = markdownDirectory.replace(/\/+$/, "");

  // 计算目标目录在操作系统中的绝对路径
  const isAbsolute = interpolated.startsWith("/") || /^[a-zA-Z]:\//i.test(interpolated);
  let resolvedAbsDir: string;
  if (isAbsolute) {
    resolvedAbsDir = interpolated.replace(/\/+/g, "/");
  } else {
    // 相对路径：基于 docDir 进行路径合并与 .. / . 计算
    const docParts = docDir.split("/").filter(Boolean);
    const patternParts = interpolated.split("/").filter((p) => Boolean(p) && p !== ".");
    const merged = isWindowsAbsolute ? [docDir.slice(0, 2), ...docParts.slice(1)] : [...docParts];

    for (const part of patternParts) {
      if (part === "..") {
        if (isWindowsAbsolute) {
          if (merged.length > 1) {
            merged.pop();
          }
        } else {
          if (merged.length > 0) {
            merged.pop();
          }
        }
      } else {
        merged.push(part);
      }
    }

    if (isWindowsAbsolute) {
      const drive = docDir.slice(0, 2);
      const rest = merged.slice(1).join("/");
      resolvedAbsDir = rest ? `${drive}/${rest}` : `${drive}/`;
    } else {
      resolvedAbsDir = `/${merged.join("/")}`;
    }
  }

  return {
    assetsDirectory: resolvedAbsDir.replace(/\/+/g, "/"),
    markdownDirectory,
  };
}

export function defaultAssetsDirectoryForDocument(documentPath: string): string {
  return resolveAssetsDirectoryForDocument(documentPath, "assets").assetsDirectory;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return ".";
  }
  const prefix = normalized.slice(0, index);
  return /^[a-zA-Z]:$/.test(prefix) ? `${prefix}/` : prefix;
}

export function joinPath(...segments: readonly string[]): string {
  return segments.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function timestampSlug(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

function sanitizeAssetBaseName(name?: string): string | null {
  const base = name
    ?.replace(/\.[^.]+$/u, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return base ? base.slice(0, 80) : null;
}
