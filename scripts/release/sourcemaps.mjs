/**
 * @fileoverview 生产构建 source map 清理与防回流检查
 *
 * 桌面端 Vite 生产构建使用 `sourcemap: "hidden"`：生成 .map，但不写入
 * sourceMappingURL。Sentry 插件在 `vite build` 期间上传（有 token 时）。
 * 本模块在上传之后删除全部 .map，并去掉残留的 sourceMappingURL，
 * 这样 Tauri 嵌入 `frontendDist` 时不会把源码映射打进安装包。
 *
 * Debug ID 注释（`//# debugId=`）必须保留，Sentry 靠它匹配已上传的 map。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * 指向外部 .map 或内联 data: 的 source map 注释。
 * 不能只搜 `sourceMappingURL`：压缩后的 PostCSS 会用字符串拼出
 * `/*# sourceMappingURL=`，那是运行时代码，不是随包发布的映射。
 */
const SOURCE_MAPPING_COMMENT =
  /(?:\/\/[ \t]*[#@][ \t]*sourceMappingURL=(?:[^\s*]*\.map\b|data:)[^\n]*|\/\*[ \t]*[#@][ \t]*sourceMappingURL=(?:[^\s*]*\.map\b|data:).*?\*\/)/u;

export const SOURCE_MAPPING_URL_PATTERN = new RegExp(SOURCE_MAPPING_COMMENT.source, "gu");

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".svg"]);

const ARCHIVE_LISTERS = [
  {
    test: (name) => name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar"),
    command: "tar",
    args: (file) => ["-tzf", file],
  },
  {
    test: (name) => name.endsWith(".zip"),
    command: "unzip",
    args: (file) => ["-Z1", file],
  },
  {
    test: (name) => name.endsWith(".deb"),
    command: "dpkg-deb",
    args: (file) => ["-c", file],
  },
];

export function stripSourceMappingUrl(source) {
  return source.replace(SOURCE_MAPPING_URL_PATTERN, "");
}

export function hasSourceMappingComment(source) {
  return SOURCE_MAPPING_COMMENT.test(source);
}

function isMapFile(filePath) {
  return filePath.toLowerCase().endsWith(".map");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 在文件里查找 ASCII 片段。分块读取，并在块边界保留重叠，避免漏掉跨块的匹配。
 */
export function fileContains(filePath, needle, chunkSize = 1024 * 1024) {
  const needleBuf = Buffer.from(needle);
  if (needleBuf.length === 0) return false;
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let overlap = Buffer.alloc(0);
    let position = 0;
    while (position < size) {
      const length = Math.min(chunkSize, size - position);
      const buffer = Buffer.alloc(overlap.length + length);
      overlap.copy(buffer, 0);
      fs.readSync(fd, buffer, overlap.length, length, position);
      if (buffer.includes(needleBuf)) return true;
      const keep = Math.min(needleBuf.length - 1, buffer.length);
      overlap = buffer.subarray(buffer.length - keep);
      position += length;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function listArchiveMembers(filePath) {
  const name = path.basename(filePath);
  const lister = ARCHIVE_LISTERS.find((candidate) => candidate.test(name));
  if (!lister) return null;
  try {
    const output = execFileSync(lister.command, lister.args(filePath), {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split(/\r?\n/u).filter(Boolean);
  } catch {
    // 本机没有对应归档工具时，仍会对文件内容做 sourceMappingURL 扫描。
    return null;
  }
}

function walkFiles(root, visit) {
  const seenDirectories = new Set();
  const rootReal = fs.realpathSync(root);
  seenDirectories.add(rootReal);

  const visitEntry = (fullPath) => {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      let targetStat;
      try {
        targetStat = fs.statSync(fullPath);
      } catch {
        return;
      }
      if (targetStat.isDirectory()) {
        let real;
        try {
          real = fs.realpathSync(fullPath);
        } catch {
          return;
        }
        if (!isInside(rootReal, real) || seenDirectories.has(real)) return;
        seenDirectories.add(real);
        walkDirectory(fullPath);
        return;
      }
      if (targetStat.isFile()) visit(fullPath);
      return;
    }
    if (stat.isDirectory()) {
      walkDirectory(fullPath);
      return;
    }
    if (stat.isFile()) visit(fullPath);
  };

  const walkDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory)) {
      visitEntry(path.join(directory, entry));
    }
  };

  visitEntry(root);
}

function rewriteTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  const source = fs.readFileSync(filePath, "utf8");
  if (!hasSourceMappingComment(source)) return false;
  const next = stripSourceMappingUrl(source);
  if (next === source) return false;
  fs.writeFileSync(filePath, next);
  return true;
}

/**
 * 删除目录中的 .map，并去掉文本产物里的 sourceMappingURL。
 * @returns {{ mapFilesRemoved: number, filesRewritten: number }}
 */
export function stripSourcemaps(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Sourcemap strip root does not exist: ${root}`);
  }
  let mapFilesRemoved = 0;
  let filesRewritten = 0;
  const mapFiles = [];
  walkFiles(root, (filePath) => {
    if (filePath === root && !fs.statSync(filePath).isDirectory() && isMapFile(filePath)) {
      mapFiles.push(filePath);
      return;
    }
    if (isMapFile(filePath)) mapFiles.push(filePath);
  });
  for (const filePath of mapFiles) {
    fs.rmSync(filePath, { force: true });
    mapFilesRemoved += 1;
  }
  walkFiles(root, (filePath) => {
    if (isMapFile(filePath)) return;
    if (rewriteTextFile(filePath)) filesRewritten += 1;
  });
  return { mapFilesRemoved, filesRewritten };
}

function inspectFile(filePath, violations) {
  const display = filePath;
  if (isMapFile(filePath)) {
    violations.push(`${display} is a sourcemap file`);
  }
  const members = listArchiveMembers(filePath);
  if (members) {
    for (const member of members) {
      if (isMapFile(member)) {
        violations.push(`${display} contains sourcemap entry ${member}`);
      }
    }
  }
  if (!isMapFile(filePath) && fileHasSourceMappingComment(filePath)) {
    violations.push(`${display} contains sourceMappingURL`);
  }
}

/** 分块扫描，避免把安装包整文件读成一个字符串。重叠窗口覆盖跨块的注释。 */
function fileHasSourceMappingComment(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const chunkSize = 1024 * 1024;
    let overlap = "";
    let position = 0;
    while (position < size) {
      const length = Math.min(chunkSize, size - position);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, position);
      const text = overlap + buffer.toString("latin1");
      if (hasSourceMappingComment(text)) return true;
      overlap = text.slice(-4096);
      position += length;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 收集仍会随产物发布的 source map 痕迹。
 * 目录不存在也算失败，避免「路径写错所以什么都没扫到」被当成通过。
 * @param {string[]} roots
 * @returns {string[]}
 */
export function findShippedSourcemaps(roots) {
  const violations = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      violations.push(`${root} does not exist`);
      continue;
    }
    if (fs.statSync(root).isDirectory()) {
      walkFiles(root, (filePath) => inspectFile(filePath, violations));
      continue;
    }
    inspectFile(root, violations);
  }
  return violations;
}

export function assertNoShippedSourcemaps(roots) {
  const violations = findShippedSourcemaps(roots);
  if (violations.length === 0) return;
  throw new Error(
    `Shipped sourcemaps detected:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}
