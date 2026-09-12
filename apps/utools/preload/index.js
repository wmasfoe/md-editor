// apps/utools/preload/index.js
// uTools 预加载脚本：运行在 Node.js + Electron 渲染进程中
// 遵循 uTools 审核规范：采用 CommonJS 规范，源码清晰可读，不进行任何混淆或压缩

const fs = require("node:fs");
const path = require("node:path");

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "build",
  ".vscode",
  ".idea",
  ".next",
  "target",
  ".cache",
]);

const MD_EXTS = new Set([".md", ".markdown", ".mdx", ".txt"]);
const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);

function scanNode(nodePath, depth = 0) {
  const name = path.basename(nodePath);
  if (depth > 0 && (name.startsWith(".") || IGNORED_NAMES.has(name))) {
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(nodePath);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    if (depth > 8) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(nodePath);
    } catch {
      return null;
    }
    const children = [];
    for (const entry of entries) {
      const child = scanNode(path.join(nodePath, entry), depth + 1);
      if (child) children.push(child);
    }
    children.sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") return -1;
      if (a.kind !== "directory" && b.kind === "directory") return 1;
      return a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" });
    });
    return {
      name,
      path: nodePath,
      kind: "directory",
      children,
    };
  }

  if (stat.isFile()) {
    const ext = path.extname(name).toLowerCase();
    if (MD_EXTS.has(ext)) {
      return {
        name,
        path: nodePath,
        kind: "markdown",
      };
    }
    if (ASSET_EXTS.has(ext)) {
      return {
        name,
        path: nodePath,
        kind: "asset",
      };
    }
  }

  return null;
}

/**
 * 为渲染进程暴露的原生文件系统与路径桥接
 * 所有敏感或系统调用统一在此收敛，避免前端页面直接依赖复杂 Node 模块
 */
window.inkpointNodeBridge = {
  /**
   * 同步读取本地文件文本内容（UTF-8 编码）
   */
  readFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  },

  /**
   * 同步写盘本地文件（UTF-8 编码）
   */
  writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
  },

  /**
   * 同步写入本地二进制文件（如图片字节）
   */
  writeBinaryFile(filePath, buffer) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    fs.writeFileSync(filePath, buf);
  },

  /**
   * 保存粘贴图片到文档旁边的 assets 资产目录，并返回相对路径（与桌面端规范一致）
   */
  savePastedImage(documentPath, mimeType, buffer, preferredName) {
    const extMap = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/bmp": "bmp",
    };
    const ext = extMap[mimeType] || "png";
    const docDir = path.dirname(documentPath);
    const assetsDir = path.join(docDir, "assets");
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    const timestamp = Date.now();
    const baseName = preferredName
      ? preferredName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_")
      : `image-${timestamp}`;
    let fileName = `${baseName}.${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(assetsDir, fileName))) {
      fileName = `${baseName}-${counter}.${ext}`;
      counter++;
    }
    const targetPath = path.join(assetsDir, fileName);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    fs.writeFileSync(targetPath, buf);
    return {
      absolutePath: targetPath,
      markdownPath: `assets/${fileName}`,
    };
  },

  /**
   * 将本地文档引用的图片路径解析为可渲染的 Data URL
   */
  resolveImageSrc(documentPath, src, workspaceRoot) {
    if (!src) return src;
    if (
      src.startsWith("data:") ||
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("#")
    ) {
      return src;
    }
    try {
      let cleanSrc = src.trim();
      if (cleanSrc.startsWith("<") && cleanSrc.endsWith(">")) {
        cleanSrc = cleanSrc.slice(1, -1);
      }
      // 去除 query 参数与 hash 锚点，并执行 URI 解码
      const noQuery = cleanSrc.split(/[?#]/u)[0] ?? cleanSrc;
      try {
        cleanSrc = decodeURIComponent(noQuery);
      } catch {
        cleanSrc = noQuery;
      }

      // 处理 file:// 协议路径
      if (cleanSrc.startsWith("file://")) {
        cleanSrc = cleanSrc.replace(/^file:\/\//, "");
        if (process.platform === "win32" && cleanSrc.startsWith("/")) {
          cleanSrc = cleanSrc.slice(1);
        }
      }

      let targetPath = null;

      if (path.isAbsolute(cleanSrc)) {
        if (fs.existsSync(cleanSrc)) {
          targetPath = cleanSrc;
        } else if (workspaceRoot) {
          const relativeToRoot = cleanSrc.replace(/^[/\\]+/, "");
          const fromWorkspace = path.join(workspaceRoot, relativeToRoot);
          if (fs.existsSync(fromWorkspace)) {
            targetPath = fromWorkspace;
          }
        }
      } else {
        if (documentPath) {
          const fromDoc = path.resolve(path.dirname(documentPath), cleanSrc);
          if (fs.existsSync(fromDoc)) {
            targetPath = fromDoc;
          }
        }
        if (!targetPath && workspaceRoot) {
          const fromWorkspace = path.resolve(workspaceRoot, cleanSrc);
          if (fs.existsSync(fromWorkspace)) {
            targetPath = fromWorkspace;
          }
        }
      }

      if (!targetPath || !fs.existsSync(targetPath)) {
        return src;
      }

      const ext = path.extname(targetPath).toLowerCase();
      const mimeMap = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".avif": "image/avif",
        ".apng": "image/apng",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
      };
      const mime = mimeMap[ext] || "image/png";
      const b64 = fs.readFileSync(targetPath).toString("base64");
      return `data:${mime};base64,${b64}`;
    } catch {
      return src;
    }
  },

  /**
   * 检查本地文件或目录是否存在
   */
  exists(filePath) {
    return fs.existsSync(filePath);
  },

  /**
   * 判断指定路径是否为目录
   */
  isDirectory(filePath) {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  },

  /**
   * 获取路径所属目录
   */
  getDirname(filePath) {
    return path.dirname(filePath);
  },

  /**
   * 获取文件基准名称
   */
  getBasename(filePath) {
    return path.basename(filePath);
  },

  /**
   * 扫描目录构建 MarkdownFolder 结构树
   */
  scanFolder(dirPath) {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`目录不存在: ${dirPath}`);
    }
    const rootStat = fs.statSync(dirPath);
    if (!rootStat.isDirectory()) {
      throw new Error(`路径不是目录: ${dirPath}`);
    }
    const rootName = path.basename(dirPath) || dirPath;
    const tree = scanNode(dirPath, 0) || {
      name: rootName,
      path: dirPath,
      kind: "directory",
      children: [],
    };
    return {
      rootPath: dirPath,
      rootName,
      tree,
    };
  },

  /**
   * 在指定父目录下创建文件或文件夹
   */
  createTreeItem(parentPath, name, kind) {
    const extension = kind === "markdown" && !/\.mdx?$/i.test(name) ? ".md" : "";
    const targetPath = path.join(parentPath, `${name}${extension}`);
    if (fs.existsSync(targetPath)) {
      throw new Error(`已存在同名${kind === "directory" ? "文件夹" : "文件"}: ${name}`);
    }
    if (kind === "directory") {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      fs.writeFileSync(targetPath, "", "utf-8");
    }
    return targetPath;
  },

  /**
   * 重命名文件或目录
   */
  renameTreeItem(oldPath, newName) {
    const dir = path.dirname(oldPath);
    const targetPath = path.join(dir, newName);
    if (fs.existsSync(targetPath)) {
      throw new Error(`目标已存在同名文件或文件夹: ${newName}`);
    }
    fs.renameSync(oldPath, targetPath);
    return targetPath;
  },

  /**
   * 删除文件或目录
   */
  deleteTreeItem(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
  },
};
