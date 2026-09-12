import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";

interface FileSystemHandleLike {
  readonly kind: "file" | "directory";
  readonly name: string;
}

interface FileSystemWritableFileStreamLike {
  write(data: unknown): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike extends FileSystemHandleLike {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
  move?(newName: string): Promise<void>;
}

interface FileSystemDirectoryHandleLike extends FileSystemHandleLike {
  readonly kind: "directory";
  entries(): AsyncIterable<[string, FileSystemHandleLike]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  move?(newName: string): Promise<void>;
}

interface WindowWithFileSystemAccess extends Window {
  showDirectoryPicker?(options?: {
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandleLike>;
  showOpenFilePicker?(options?: {
    types?: readonly { description?: string; accept: Record<string, readonly string[]> }[];
    multiple?: boolean;
  }): Promise<readonly FileSystemFileHandleLike[]>;
}

/**
 * 浏览器端现代 File System Access API 兼容性检测。
 * 目前 Chromium 内核浏览器（Chrome, Edge, Opera, Arc 等）原生支持，
 * Safari / Firefox 正在逐步实现。
 */
export const isFileSystemAccessSupported =
  typeof window !== "undefined" && "showDirectoryPicker" in window;

const IGNORED_NAMES = new Set([
  ".git",
  ".github",
  "node_modules",
  ".vscode",
  ".idea",
  ".DS_Store",
  "dist",
  "build",
  ".next",
  ".vercel",
  ".turbo",
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function getFileKind(filename: string): "markdown" | "asset" | "other" {
  const ext = getFileExtension(filename);
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (ASSET_EXTENSIONS.has(ext)) {
    return "asset";
  }
  return "other";
}

/**
 * 浏览器本地文件系统管理器。
 * 通过 File System Access API 保持对用户本地工作目录句柄的引用，
 * 在前端实现文件树扫描、按需读取、原子写盘、重命名与删除。
 */
export class WebFileSystem {
  private rootHandle: FileSystemDirectoryHandleLike | null = null;
  private fileHandleMap = new Map<string, FileSystemFileHandleLike>();
  private dirHandleMap = new Map<string, FileSystemDirectoryHandleLike>();
  private currentFolder: MarkdownFolder | null = null;

  // 图片资源同步高速缓存 (多重 Alias -> blob: 或 data: URL)
  private readonly assetUrlCache = new Map<string, string>();
  // 跟踪本会话中创建的所有 Object URL，以便适时释放内存
  private readonly createdObjectUrls = new Set<string>();
  // 异步加载图片完成后的通知订阅者
  private readonly assetChangeListeners = new Set<() => void>();
  // 目录与文件树变更通知订阅者（如外部复制粘贴新增、新建、删除、重命名）
  private readonly folderChangeListeners = new Set<(folder: MarkdownFolder | null) => void>();

  public hasOpenedFolder(): boolean {
    return this.rootHandle !== null;
  }

  public getOpenedFolder(): MarkdownFolder | null {
    return this.currentFolder;
  }

  /**
   * 订阅工作区文件树变更事件（新增图片、新建文件、删除等重新扫描后自动触发）
   */
  public onFolderChange(listener: (folder: MarkdownFolder | null) => void): () => void {
    this.folderChangeListeners.add(listener);
    return () => {
      this.folderChangeListeners.delete(listener);
    };
  }

  private notifyFolderChanged(folder: MarkdownFolder | null): void {
    for (const listener of this.folderChangeListeners) {
      try {
        listener(folder);
      } catch (err) {
        console.error("Error in folder change listener:", err);
      }
    }
  }

  /**
   * 订阅资源缓存更新事件（如异步图片加载就绪）
   */
  public onAssetCacheChange(listener: () => void): () => void {
    this.assetChangeListeners.add(listener);
    return () => {
      this.assetChangeListeners.delete(listener);
    };
  }

  private notifyAssetCacheChanged(): void {
    for (const listener of this.assetChangeListeners) {
      try {
        listener();
      } catch (err) {
        console.error("Error in asset change listener:", err);
      }
    }
  }

  /**
   * 释放所有由本实例创建的 Object URL，防止内存泄漏。
   */
  public revokeAllAssetUrls(): void {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      for (const url of this.createdObjectUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // 忽略释放失败
        }
      }
    }
    this.createdObjectUrls.clear();
    this.assetUrlCache.clear();
  }

  /**
   * 关闭当前已打开的本地工作区并清理所有句柄与缓存。
   */
  public closeDirectory(): void {
    this.revokeAllAssetUrls();
    this.rootHandle = null;
    this.currentFolder = null;
    this.fileHandleMap.clear();
    this.dirHandleMap.clear();
    this.notifyAssetCacheChanged();
    this.notifyFolderChanged(null);
  }

  /**
   * 弹出系统原生文件夹选择器，获取用户授权并构建文件树结构。
   */
  public async openDirectory(): Promise<MarkdownFolder | null> {
    if (!isFileSystemAccessSupported) {
      throw new Error("当前浏览器不支持 File System Access API，建议使用 Chrome 或 Edge 浏览器。");
    }

    const win = window as WindowWithFileSystemAccess;
    if (!win.showDirectoryPicker) {
      return null;
    }

    try {
      const handle = await win.showDirectoryPicker({
        mode: "readwrite",
      });

      this.revokeAllAssetUrls();
      this.rootHandle = handle;
      return await this.scanDirectory();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
      throw err;
    }
  }

  /**
   * 重新扫描当前打开的根目录并刷新文件树。
   */
  public async refreshDirectory(): Promise<MarkdownFolder | null> {
    if (!this.rootHandle) {
      return null;
    }
    return await this.scanDirectory();
  }

  /**
   * 递归扫描目录句柄，构建项目标准的 MarkdownFolder 树形数据。
   */
  private async scanDirectory(): Promise<MarkdownFolder> {
    if (!this.rootHandle) {
      throw new Error("No directory handle open");
    }

    this.fileHandleMap.clear();
    this.dirHandleMap.clear();

    const rootName = this.rootHandle.name;
    const rootPath = `/${rootName}`;
    this.dirHandleMap.set(rootPath, this.rootHandle);

    const scanNode = async (
      dirHandle: FileSystemDirectoryHandleLike,
      currentPath: string,
    ): Promise<MarkdownFileTreeNode[]> => {
      const children: MarkdownFileTreeNode[] = [];

      for await (const [name, handle] of dirHandle.entries()) {
        if (IGNORED_NAMES.has(name) || name.startsWith(".")) {
          continue;
        }

        const childPath = `${currentPath}/${name}`;

        if (handle.kind === "directory") {
          const subDirHandle = handle as FileSystemDirectoryHandleLike;
          this.dirHandleMap.set(childPath, subDirHandle);
          const subChildren = await scanNode(subDirHandle, childPath);
          children.push({
            name,
            path: childPath,
            kind: "directory",
            children: subChildren,
          });
        } else if (handle.kind === "file") {
          const kind = getFileKind(name);
          if (kind !== "other") {
            const fileHandle = handle as FileSystemFileHandleLike;
            this.fileHandleMap.set(childPath, fileHandle);
            children.push({
              name,
              path: childPath,
              kind,
            });

            // 如果是静态图片资源，预先读取并生成高速 Object URL 缓存
            if (kind === "asset") {
              try {
                const file = await fileHandle.getFile();
                this.registerAssetBlob(childPath, file);
              } catch (err) {
                console.warn("Failed to pre-cache asset blob URL:", err);
              }
            }
          }
        }
      }

      // 排序规则：目录在前，文件在后；同级按字母升序排序
      return children.toSorted((a, b) => {
        if (a.kind === "directory" && b.kind !== "directory") {
          return -1;
        }
        if (a.kind !== "directory" && b.kind === "directory") {
          return 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    };

    const treeChildren = await scanNode(this.rootHandle, rootPath);
    const folder: MarkdownFolder = {
      rootPath,
      rootName,
      tree: {
        name: rootName,
        path: rootPath,
        kind: "directory",
        children: treeChildren,
      },
    };

    this.currentFolder = folder;
    this.notifyFolderChanged(folder);
    return folder;
  }

  /**
   * 为图片文件或 Blob 生成浏览器可渲染的 Object URL 并登记至内部缓存。
   */
  public registerAssetBlob(path: string, fileOrBlob: Blob | File): string {
    let blobUrl = "";
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      blobUrl = URL.createObjectURL(fileOrBlob);
      this.createdObjectUrls.add(blobUrl);
    } else {
      // Node 测试环境或未实现 createObjectURL 的降级
      blobUrl = `blob:mock-asset/${encodeURIComponent(path)}`;
    }

    this.cacheAssetUrl(path, blobUrl);
    return blobUrl;
  }

  /**
   * 将 URL 按照绝对路径、根相对路径、点前缀相对路径与文件名多重别名存入高速缓存。
   */
  public cacheAssetUrl(path: string, url: string): void {
    const normalized = this.normalizePath(path);
    this.assetUrlCache.set(normalized, url);

    const noLeading = normalized.replace(/^\/+/, "");
    this.assetUrlCache.set(noLeading, url);
    this.assetUrlCache.set(`./${noLeading}`, url);

    const rootPath = this.currentFolder?.rootPath;
    if (rootPath) {
      const normalizedRoot = this.normalizePath(rootPath);
      if (normalized.startsWith(normalizedRoot)) {
        const relativeToRoot = normalized.slice(normalizedRoot.length).replace(/^\/+/, "");
        if (relativeToRoot) {
          this.assetUrlCache.set(relativeToRoot, url);
          this.assetUrlCache.set(`./${relativeToRoot}`, url);
        }
      }
    }

    // 单纯文件名索引（作为最后兜底）
    const fileName = normalized.split("/").pop();
    if (fileName && !this.assetUrlCache.has(fileName)) {
      this.assetUrlCache.set(fileName, url);
    }
  }

  /**
   * 从同步缓存中按多级别名检索对应的 Object URL。
   */
  public lookupAssetCache(key: string): string | null {
    if (!key) return null;
    const normalized = this.normalizePath(key);
    if (this.assetUrlCache.has(normalized)) {
      return this.assetUrlCache.get(normalized)!;
    }
    const noLeading = normalized.replace(/^\/+/, "");
    if (this.assetUrlCache.has(noLeading)) {
      return this.assetUrlCache.get(noLeading)!;
    }
    const withDot = `./${noLeading}`;
    if (this.assetUrlCache.has(withDot)) {
      return this.assetUrlCache.get(withDot)!;
    }

    // 检查是否有以 / + key 结尾的条目（如 assets/pic.png 匹配 /root/assets/pic.png）
    for (const [cachedKey, url] of this.assetUrlCache.entries()) {
      if (cachedKey.endsWith(`/${noLeading}`) || cachedKey === noLeading) {
        return url;
      }
    }
    return null;
  }

  /**
   * 同步解析 Markdown 图片源为浏览器可直接渲染的 URL（blob: / data: / http:）。
   * 对标桌面端 resolvePreviewImageSrc / convertFileSrc，满足 CodeMirror 同步 Decoration 计算要求。
   */
  public resolveImageSrc(source: string, documentPath?: string | null): string {
    if (!source) return source;

    const trimmed = source.trim();
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("#")
    ) {
      return trimmed;
    }

    // 清理包裹的尖括号、query 参数与 hash 锚点
    let cleanSrc = trimmed;
    if (cleanSrc.startsWith("<") && cleanSrc.endsWith(">")) {
      cleanSrc = cleanSrc.slice(1, -1).trim();
    }
    const noQuery = cleanSrc.split(/[?#]/u)[0] ?? cleanSrc;
    try {
      cleanSrc = decodeURIComponent(noQuery);
    } catch {
      cleanSrc = noQuery;
    }

    cleanSrc = cleanSrc.replace(/\\/g, "/");

    // 1. 直查多重缓存
    const directHit = this.lookupAssetCache(cleanSrc);
    if (directHit) {
      return directHit;
    }

    // 2. 结合 documentPath 相对目录解析
    if (documentPath) {
      const docDir = this.dirname(documentPath);
      const resolvedWithDoc = this.resolvePath(docDir, cleanSrc);
      const docHit = this.lookupAssetCache(resolvedWithDoc);
      if (docHit) {
        return docHit;
      }
    }

    // 3. 结合工作区根目录解析
    if (this.currentFolder?.rootPath) {
      const rootResolved = this.resolvePath(this.currentFolder.rootPath, cleanSrc);
      const rootHit = this.lookupAssetCache(rootResolved);
      if (rootHit) {
        return rootHit;
      }
    }

    // 4. 按纯文件名检索
    const fileName = cleanSrc.split("/").pop();
    if (fileName) {
      const nameHit = this.lookupAssetCache(fileName);
      if (nameHit) {
        return nameHit;
      }
    }

    // 5. 若未在缓存中命中，但存在对应的 FileHandle，异步触发读取预热并通知监听器
    this.scheduleAssetLoad(cleanSrc, documentPath);

    return source;
  }

  /**
   * 异步检索并返回指定路径的 Object URL。
   * 优先使用已有的高速缓存，未缓存则从 FileHandle 异步加载。
   */
  public async getAssetUrl(path: string): Promise<string | null> {
    const cached = this.lookupAssetCache(path);
    if (cached) {
      return cached;
    }

    let handle = this.fileHandleMap.get(path);
    if (!handle) {
      const normalized = this.normalizePath(path);
      for (const [key, candidate] of this.fileHandleMap.entries()) {
        if (
          this.normalizePath(key) === normalized ||
          key.endsWith(`/${path}`) ||
          key.endsWith(path)
        ) {
          handle = candidate;
          break;
        }
      }
    }

    if (handle) {
      try {
        const file = await handle.getFile();
        return this.registerAssetBlob(path, file);
      } catch (err) {
        console.warn(`Failed to read asset file for ${path}:`, err);
      }
    }

    return null;
  }

  private scheduleAssetLoad(cleanSrc: string, documentPath?: string | null): void {
    void this.findAndLoadAsset(cleanSrc, documentPath).then((url) => {
      if (url) {
        this.notifyAssetCacheChanged();
      }
    });
  }

  private async findAndLoadAsset(
    cleanSrc: string,
    documentPath?: string | null,
  ): Promise<string | null> {
    const candidatePaths: string[] = [];
    if (documentPath) {
      candidatePaths.push(this.resolvePath(this.dirname(documentPath), cleanSrc));
    }
    if (this.currentFolder?.rootPath) {
      candidatePaths.push(this.resolvePath(this.currentFolder.rootPath, cleanSrc));
    }
    candidatePaths.push(this.normalizePath(cleanSrc));
    candidatePaths.push(cleanSrc.replace(/^\/+/, ""));

    for (const candidate of candidatePaths) {
      const handle = this.fileHandleMap.get(candidate);
      if (handle) {
        try {
          const file = await handle.getFile();
          return this.registerAssetBlob(candidate, file);
        } catch (err) {
          console.warn("Failed to load asset file:", err);
        }
      }
    }

    const noLeading = cleanSrc.replace(/^\/+/, "");
    for (const [key, handle] of this.fileHandleMap.entries()) {
      if (key.endsWith(`/${noLeading}`) || key.endsWith(noLeading)) {
        try {
          const file = await handle.getFile();
          return this.registerAssetBlob(key, file);
        } catch (err) {
          console.warn("Failed to load asset file by suffix:", err);
        }
      }
    }

    return null;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  private dirname(p: string): string {
    const normalized = this.normalizePath(p);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
  }

  private resolvePath(baseDir: string, relativePath: string): string {
    if (relativePath.startsWith("/")) {
      return this.normalizePath(relativePath);
    }
    const parts = [...baseDir.split("/"), ...relativePath.split("/")];
    const resolved: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return `/${resolved.join("/")}`;
  }

  /**
   * 读取指定路径的 Markdown 文件文本内容。
   */
  public async readFile(path: string): Promise<string> {
    const handle = this.fileHandleMap.get(path);
    if (!handle) {
      throw new Error(`File not found in opened workspace: ${path}`);
    }
    const file = await handle.getFile();
    return await file.text();
  }

  /**
   * 将 Markdown 文本内容原子写入本地磁盘文件。
   */
  public async writeFile(path: string, content: string): Promise<void> {
    const handle = this.fileHandleMap.get(path);
    if (!handle) {
      throw new Error(`File not found for writing: ${path}`);
    }
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * 在指定父目录下创建新的 Markdown 文件或子目录。
   */
  public async createItem(
    parentPath: string,
    name: string,
    kind: "markdown" | "directory",
  ): Promise<string> {
    let resolvedParent = parentPath;
    if (!this.dirHandleMap.has(resolvedParent)) {
      const lastSlash = resolvedParent.lastIndexOf("/");
      if (lastSlash > 0) {
        resolvedParent = resolvedParent.slice(0, lastSlash);
      } else if (this.currentFolder?.rootPath) {
        resolvedParent = this.currentFolder.rootPath;
      }
    }

    const parentHandle = this.dirHandleMap.get(resolvedParent);
    if (!parentHandle) {
      throw new Error(`Parent directory not found: ${parentPath}`);
    }

    const cleanName = name.trim();
    const newPath = `${resolvedParent}/${cleanName}`;

    if (kind === "markdown") {
      const fileHandle = await parentHandle.getFileHandle(cleanName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write("");
      await writable.close();
      this.fileHandleMap.set(newPath, fileHandle);
    } else {
      const dirHandle = await parentHandle.getDirectoryHandle(cleanName, { create: true });
      this.dirHandleMap.set(newPath, dirHandle);
    }

    await this.scanDirectory();
    return newPath;
  }

  /**
   * 重命名文件或目录。
   */
  public async renameItem(path: string, newName: string): Promise<string> {
    const lastSlash = path.lastIndexOf("/");
    const parentPath = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    const parentHandle = this.dirHandleMap.get(parentPath);
    if (!parentHandle) {
      throw new Error(`Parent directory not found for: ${path}`);
    }

    const cleanNewName = newName.trim();
    const newPath = `${parentPath}/${cleanNewName}`;

    const fileHandle = this.fileHandleMap.get(path);
    if (fileHandle) {
      // Chromium 111+ 支持 move API
      if (typeof fileHandle.move === "function") {
        await fileHandle.move(cleanNewName);
      } else {
        const oldFile = await fileHandle.getFile();
        const content = await oldFile.arrayBuffer();
        const newFileHandle = await parentHandle.getFileHandle(cleanNewName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        const oldName = path.slice(lastSlash + 1);
        await parentHandle.removeEntry(oldName);
      }
    } else {
      const dirHandle = this.dirHandleMap.get(path);
      if (!dirHandle) {
        throw new Error(`Item not found for renaming: ${path}`);
      }
      if (typeof dirHandle.move === "function") {
        await dirHandle.move(cleanNewName);
      } else {
        throw new Error("当前浏览器不支持目录重命名，建议直接新建目录。");
      }
    }

    await this.scanDirectory();
    return newPath;
  }

  /**
   * 删除文件或目录。
   */
  public async deleteItem(path: string): Promise<void> {
    const lastSlash = path.lastIndexOf("/");
    const parentPath = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    const parentHandle = this.dirHandleMap.get(parentPath);
    if (!parentHandle) {
      throw new Error(`Parent directory not found for: ${path}`);
    }

    const name = path.slice(lastSlash + 1);
    const isDir = this.dirHandleMap.has(path);

    await parentHandle.removeEntry(name, { recursive: isDir });
    this.fileHandleMap.delete(path);
    this.dirHandleMap.delete(path);

    // 清理已缓存的 Object URL
    const cached = this.assetUrlCache.get(path);
    if (cached) {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(cached);
        } catch {
          // 忽略
        }
      }
      this.createdObjectUrls.delete(cached);
      this.assetUrlCache.delete(path);
      this.notifyAssetCacheChanged();
    }

    await this.scanDirectory();
  }

  /**
   * 将剪贴板或拖拽的图片存储至本地 assets/ 目录。
   * 如果当前已打开本地文件夹：自动在根目录下创建 assets/ 文件夹并保存为二进制图片；
   * 如果未打开本地文件夹：转为 Base64 Data URL 字符串，无需写盘即插即用。
   */
  public async saveAssetImage(
    bytes: Uint8Array,
    mimeType: string,
    preferredName?: string,
  ): Promise<{ src: string; isLocalDisk: boolean }> {
    const ext = mimeType.split("/")[1] || "png";
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "")
      .toLowerCase();
    const baseName = preferredName
      ? preferredName.replace(/\.[^.]+$/u, "").replace(/[^a-zA-Z0-9_-]/g, "_")
      : `image_${timestamp}`;
    const fileName = `${baseName}.${ext}`;

    if (this.rootHandle) {
      try {
        const assetsHandle = await this.rootHandle.getDirectoryHandle("assets", { create: true });
        const fileHandle = await assetsHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();

        // 立即创建并注册 Object URL 高速缓存，确保插入 Markdown 后秒级同步渲染
        try {
          const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
          const blobUrl = this.registerAssetBlob(`assets/${fileName}`, blob);
          this.cacheAssetUrl(`./assets/${fileName}`, blobUrl);
          this.cacheAssetUrl(fileName, blobUrl);
          if (this.currentFolder?.rootPath) {
            this.cacheAssetUrl(`${this.currentFolder.rootPath}/assets/${fileName}`, blobUrl);
          }
        } catch (blobErr) {
          console.warn("Failed to create blob URL on saveAssetImage:", blobErr);
        }

        // 重新扫描以使文件树更新显示新图片
        await this.scanDirectory();
        return { src: `./assets/${fileName}`, isLocalDisk: true };
      } catch (err) {
        console.warn("Failed to write image to local assets folder, falling back to Base64:", err);
      }
    }

    // 降级：转换为 Base64 Data URL（同时兼容 Node 测试环境与全系浏览器）
    let base64Str = "";
    if (typeof Buffer !== "undefined") {
      base64Str = Buffer.from(bytes).toString("base64");
    } else {
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Str = window.btoa(binary);
    }

    const dataUrl = `data:${mimeType};base64,${base64Str}`;
    this.cacheAssetUrl(fileName, dataUrl);
    this.cacheAssetUrl(`./assets/${fileName}`, dataUrl);
    return { src: dataUrl, isLocalDisk: false };
  }

  /**
   * 独立打开单个本地 Markdown 文件的便捷方法。
   */
  public async openSingleFile(): Promise<{ name: string; content: string } | null> {
    if (isFileSystemAccessSupported) {
      const win = window as WindowWithFileSystemAccess;
      if (win.showOpenFilePicker) {
        try {
          const handles = await win.showOpenFilePicker({
            types: [
              {
                description: "Markdown 文档",
                accept: {
                  "text/markdown": [".md", ".markdown", ".mdx"],
                  "text/plain": [".txt"],
                },
              },
            ],
            multiple: false,
          });
          const handle = handles[0];
          if (!handle) {
            return null;
          }
          const file = await handle.getFile();
          const content = await file.text();
          return { name: file.name, content };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return null;
          }
          throw err;
        }
      }
    }

    // 传统 <input type="file"> 降级
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.mdx,.txt";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const content = await file.text();
        resolve({ name: file.name, content });
      });
      input.click();
    });
  }
}

export const webFileSystem = new WebFileSystem();
