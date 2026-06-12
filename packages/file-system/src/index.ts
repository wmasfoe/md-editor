import { err, ok, type Result } from "@md-editor/shared";

export interface MarkdownDocumentFile {
  readonly filePath: string;
  readonly markdown: string;
}

export interface SaveMarkdownInput {
  readonly filePath: string | null;
  readonly markdown: string;
  readonly forceDialog?: boolean;
}

export interface FileServiceAdapter {
  openMarkdownFile(): Promise<MarkdownDocumentFile | null>;
  saveMarkdownFile(input: SaveMarkdownInput): Promise<MarkdownDocumentFile | null>;
}

export interface NewDocumentResult {
  readonly markdown: string;
  readonly filePath: null;
}

export interface FileService {
  newDocument(defaultMarkdown?: string): NewDocumentResult;
  openDocument(): Promise<MarkdownDocumentFile | null>;
  saveDocument(input: SaveMarkdownInput): Promise<MarkdownDocumentFile | null>;
  saveDocumentAs(input: Omit<SaveMarkdownInput, "forceDialog">): Promise<MarkdownDocumentFile | null>;
}

export interface ImagePasteInput {
  readonly documentPath: string | null;
  readonly mimeType: string;
  readonly existingAssetNames?: readonly string[];
}

export interface ImagePasteTarget {
  readonly assetsDirectory: string;
  readonly fileName: string;
  readonly absolutePath: string;
  readonly markdownPath: string;
}

export type ImagePasteError = "SAVE_FIRST" | "UNSUPPORTED_IMAGE_TYPE";

export function createFileService(adapter: FileServiceAdapter): FileService {
  return {
    newDocument(defaultMarkdown = "# Untitled\n\n") {
      // 新建文档必须从干净状态开始，避免把上一份文档的 dirty 标记带进来。
      return {
        markdown: defaultMarkdown,
        filePath: null
      };
    },
    openDocument() {
      return adapter.openMarkdownFile();
    },
    saveDocument(input) {
      return adapter.saveMarkdownFile(input);
    },
    saveDocumentAs(input) {
      return adapter.saveMarkdownFile({ ...input, forceDialog: true });
    }
  };
}

const imageExtensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

export function planImagePasteTarget(
  input: ImagePasteInput
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

  const documentDirectory = dirname(input.documentPath);
  const assetsDirectory = joinPath(documentDirectory, "assets");
  const fileName = nextAssetFileName(extension, input.existingAssetNames ?? []);

  return ok({
    assetsDirectory,
    fileName,
    absolutePath: joinPath(assetsDirectory, fileName),
    markdownPath: `assets/${fileName}`
  });
}

export function nextAssetFileName(extension: string, existingNames: readonly string[]): string {
  const names = new Set(existingNames);
  const base = timestampSlug(new Date());
  let candidate = `${base}.${extension}`;
  let index = 2;

  // 这里只避开当前可见的文件名冲突；真正写盘时仍需要原子创建/写入，
  // 用来处理并发或外部进程带来的竞态。
  while (names.has(candidate)) {
    candidate = `${base}-${index}.${extension}`;
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

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "." : normalized.slice(0, index);
}

export function joinPath(...segments: readonly string[]): string {
  return segments
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

function timestampSlug(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}
