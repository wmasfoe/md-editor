// uTools preload: only host dialogs and file-entry events can grant filesystem access.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const host = window.utools;
const showOpenDialog = host?.showOpenDialog?.bind(host);
const showSaveDialog = host?.showSaveDialog?.bind(host);
const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
]);
const MARKDOWN_EXTS = ["md", "markdown", "mdx", "txt"];
const MARKDOWN_FILTER = [{ name: "Markdown", extensions: MARKDOWN_EXTS }];
const IGNORED_NAMES = new Set(["node_modules", "dist", "build", "target"]);
const BLOCKED_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let currentDocument = null;
let workspaceRoot = null;
let workspaceNodes = new Map();

function isMarkdown(file) {
  return MARKDOWN_EXTS.includes(path.extname(file).slice(1).toLowerCase());
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

// Recheck canonical paths on use so replaced symlinks and junctions don't inherit a grant.
function checkExisting(target, kind) {
  const stat = fs.lstatSync(target);
  if (
    fs.realpathSync.native(target) !== target ||
    (kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  ) {
    throw new Error("文件或目录不在授权范围内");
  }
  return stat;
}

function selectedPath(input, kind) {
  if (typeof input !== "string" || !path.isAbsolute(input)) {
    throw new Error("无效的本地路径");
  }
  const parent = fs.realpathSync.native(path.dirname(input));
  const target = path.join(parent, path.basename(input));
  if (kind === "markdown" && !isMarkdown(target)) {
    throw new Error("请选择 Markdown 或纯文本文档");
  }
  return target;
}

function openDocument(target) {
  checkExisting(target, "file");
  const markdown = fs.readFileSync(target, "utf8");
  currentDocument = { path: target, id: randomUUID() };
  return { filePath: target, markdown, id: currentDocument.id };
}

function documentPath(id) {
  if (!currentDocument || id !== currentDocument.id) {
    throw new Error("文档已切换，请重新打开或重试");
  }
  checkExisting(currentDocument.path, "file");
  return currentDocument.path;
}

function scanNode(target, depth, nodes) {
  const name = path.basename(target) || target;
  if (depth > 0 && (name.startsWith(".") || IGNORED_NAMES.has(name))) return null;
  try {
    const stat = fs.lstatSync(target);
    const kind = stat.isDirectory() ? "directory" : isMarkdown(target) ? "markdown" : "asset";
    if (kind === "asset" && !IMAGE_TYPES.has(path.extname(target).toLowerCase())) return null;
    checkExisting(target, kind);
    const id = randomUUID();
    const node = { name, path: target, kind, id };
    if (kind === "directory") {
      node.children =
        depth >= 8
          ? []
          : fs
              .readdirSync(target)
              .map((entry) => scanNode(path.join(target, entry), depth + 1, nodes))
              .filter(Boolean)
              // oxlint-disable-next-line unicorn/no-array-sort -- Electron 22 lacks toSorted; this array is local.
              .sort(
                (a, b) =>
                  Number(b.kind === "directory") - Number(a.kind === "directory") ||
                  a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" }),
              );
    }
    nodes.set(id, { path: target, kind });
    return node;
  } catch {
    return null;
  }
}

function scanWorkspace(root) {
  checkExisting(root, "directory");
  const nodes = new Map();
  const tree = scanNode(root, 0, nodes);
  if (!tree) throw new Error("无法读取工作区");
  workspaceRoot = root;
  workspaceNodes = nodes;
  return { rootPath: root, rootName: tree.name, tree };
}

function workspaceNode(id, kind, allowRoot = false) {
  const node = workspaceNodes.get(id);
  if (
    !node ||
    (kind && node.kind !== kind) ||
    (!allowRoot && node.path === workspaceRoot) ||
    !isWithin(workspaceRoot, node.path)
  ) {
    throw new Error("请选择已授权工作区内的项目");
  }
  checkExisting(workspaceRoot, "directory");
  checkExisting(node.path, node.kind);
  return node.path;
}

function safeName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.startsWith(".") ||
    /[<>:"/\\|?*]/u.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/u.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
  ) {
    throw new Error("无效的文件或文件夹名称");
  }
  return name;
}

function resolveDocumentImage(id, src) {
  if (typeof src !== "string") return BLOCKED_IMAGE;
  const reference = src.trim().replace(/^<(.+)>$/u, "$1");
  if (/^(https?:\/\/|data:image\/)/iu.test(reference)) return reference;
  try {
    const relative = decodeURIComponent(reference.split(/[?#]/u)[0]).replaceAll("\\", "/");
    if (
      !relative ||
      relative.startsWith("/") ||
      relative.includes(":") ||
      relative.includes("\0")
    ) {
      return BLOCKED_IMAGE;
    }
    const mime = IMAGE_TYPES.get(path.extname(relative).toLowerCase());
    if (!mime) return BLOCKED_IMAGE;
    const docDir = path.dirname(documentPath(id));
    const roots =
      workspaceRoot && isWithin(workspaceRoot, docDir) ? [docDir, workspaceRoot] : [docDir];
    for (const root of roots) {
      const candidate = path.resolve(root, relative);
      if (!roots.some((allowed) => isWithin(allowed, candidate))) continue;
      try {
        checkExisting(candidate, "file");
        return `data:${mime};base64,${fs.readFileSync(candidate).toString("base64")}`;
      } catch {
        // A relative reference may be relative to the workspace rather than the document.
      }
    }
  } catch {
    // Invalid URI encoding or a stale document grant.
  }
  return BLOCKED_IMAGE;
}

let enterListener;
let pendingEnter;
let outListener;
host?.onPluginEnter?.((action) => {
  let entry = { code: action.code };
  try {
    if (action.type === "files" && (action.code === "open-file" || action.code === "open-folder")) {
      // API redirects can supply their own payload; only direct host entry can grant access.
      if (!["main", "panel", "hotkey"].includes(action.from)) {
        throw new Error("请从 uTools 或文件选择器打开本地文件");
      }
      const first = Array.isArray(action.payload) ? action.payload[0] : null;
      const selected = first?.path;
      if (action.code === "open-file") {
        entry.document = openDocument(selectedPath(selected, "markdown"));
      } else {
        entry.folder = scanWorkspace(selectedPath(selected, "directory"));
      }
    } else if (action.type === "over" && typeof action.payload === "string") {
      entry.text = action.payload;
    }
  } catch (error) {
    entry = { code: action.code, error: error.message };
  }
  if (enterListener) enterListener(entry);
  else pendingEnter = entry;
});
host?.onPluginOut?.(() => outListener?.());

window.inkpointNodeBridge = Object.freeze({
  subscribeLifecycle(onEnter, onOut) {
    enterListener = onEnter;
    outListener = onOut;
    const pending = pendingEnter;
    pendingEnter = null;
    if (pending) onEnter(pending);
    return () => {
      if (enterListener !== onEnter) return;
      enterListener = null;
      outListener = null;
    };
  },
  pickDocument() {
    const selected = showOpenDialog?.({ filters: MARKDOWN_FILTER, properties: ["openFile"] })?.[0];
    return selected ? openDocument(selectedPath(selected, "markdown")) : null;
  },
  pickWorkspace() {
    const selected = showOpenDialog?.({ properties: ["openDirectory"] })?.[0];
    return selected ? scanWorkspace(selectedPath(selected, "directory")) : null;
  },
  openWorkspaceDocument(id) {
    return openDocument(workspaceNode(id, "markdown"));
  },
  writeCurrentDocument(id, markdown) {
    if (typeof markdown !== "string") throw new Error("无效的文档内容");
    const target = documentPath(id);
    fs.writeFileSync(target, markdown, "utf8");
    return target;
  },
  saveNewDocument(markdown) {
    if (typeof markdown !== "string") throw new Error("无效的文档内容");
    const selected = showSaveDialog?.({
      title: "保存 Markdown 文档",
      defaultPath: "未命名.md",
      filters: MARKDOWN_FILTER,
      buttonLabel: "保存",
    });
    if (!selected) return null;
    const target = selectedPath(selected, "markdown");
    try {
      fs.lstatSync(target);
      checkExisting(target, "file");
      fs.writeFileSync(target, markdown, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.writeFileSync(target, markdown, { encoding: "utf8", flag: "wx" });
    }
    currentDocument = { path: target, id: randomUUID() };
    return { filePath: target, id: currentDocument.id };
  },
  closeDocument() {
    currentDocument = null;
  },
  saveDocumentImage(id, mime, buffer) {
    const extension = [...IMAGE_TYPES].find(([, type]) => type === mime)?.[0];
    if (!extension) throw new Error("不支持的图片格式");
    const assets = path.join(path.dirname(documentPath(id)), "assets");
    try {
      fs.mkdirSync(assets);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    checkExisting(assets, "directory");
    if (!(buffer instanceof ArrayBuffer)) throw new Error("无效的图片内容");
    const bytes = new Uint8Array(buffer);
    const fileName = `image-${randomUUID()}${extension}`;
    fs.writeFileSync(path.join(assets, fileName), bytes, { flag: "wx" });
    return { markdownPath: `assets/${fileName}` };
  },
  resolveDocumentImage,
  refreshWorkspace() {
    if (!workspaceRoot) throw new Error("请先选择工作区");
    return scanWorkspace(workspaceRoot);
  },
  closeWorkspace() {
    workspaceRoot = null;
    workspaceNodes.clear();
  },
  createWorkspaceItem(parentId, name, kind) {
    const parent = workspaceNode(parentId, "directory", true);
    const base = safeName(name);
    if (kind !== "directory" && kind !== "markdown") throw new Error("无效的项目类型");
    const target = path.join(
      parent,
      kind === "markdown" && !isMarkdown(base) ? base + ".md" : base,
    );
    if (kind === "directory") fs.mkdirSync(target);
    else fs.writeFileSync(target, "", { flag: "wx" });
    return target;
  },
  renameWorkspaceItem(id, newName) {
    const source = workspaceNode(id);
    const target = path.join(path.dirname(source), safeName(newName));
    const kind = workspaceNodes.get(id).kind;
    if (
      (kind === "markdown" && !isMarkdown(target)) ||
      (kind === "asset" && !IMAGE_TYPES.has(path.extname(target).toLowerCase()))
    ) {
      throw new Error("请保留受支持的文件扩展名");
    }
    try {
      fs.lstatSync(target);
      throw new Error("目标已存在同名文件或文件夹");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    fs.renameSync(source, target);
    workspaceNodes.clear();
    if (currentDocument && isWithin(source, currentDocument.path)) {
      currentDocument.path = path.join(target, path.relative(source, currentDocument.path));
    }
    return target;
  },
  deleteWorkspaceItem(id) {
    const source = workspaceNode(id);
    fs.rmSync(source, { recursive: workspaceNodes.get(id).kind === "directory" });
    workspaceNodes.clear();
    if (currentDocument && isWithin(source, currentDocument.path)) currentDocument = null;
  },
});
