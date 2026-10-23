#!/usr/bin/env node
/**
 * @fileoverview 从 CHANGELOG 抽取发版所需的「本次更新内容」
 *
 * 发版链路里更新内容的唯一事实源是 `apps/desktop/CHANGELOG.md`：
 * - `--notes-out`：写入 Tauri updater manifest 的 `notes`（中文区块，含 `## <version>` 标题，
 *   桌面端用 @md-editor/changelog 的同一份 parser 解析）；
 * - `--body-out`：写入 GitHub Release body（中英双区块，便于英文用户阅读）。
 *
 * 版本区块缺失或没有有效列表项时直接失败，避免发版把 `Inkpoint <version>` 这类空内容推给用户。
 */

import fs from "node:fs";
import path from "node:path";

/** 去掉可选的 `v` 前缀，统一比较口径。 */
export function normalizeVersion(version) {
  return typeof version === "string" ? version.trim().replace(/^v/iu, "") : "";
}

/**
 * 抽取指定版本的区块。
 * 区块从 `## <version> …` 开始，到下一个 `## ` 或文末结束；返回内容包含版本标题行。
 *
 * @param {string} markdown CHANGELOG 全文
 * @param {string} version 目标版本（允许带 `v` 前缀）
 * @returns {string | null} 区块原文；未命中或没有列表项时返回 null
 */
export function extractVersionSection(markdown, version) {
  const normalized = normalizeVersion(version);
  if (!normalized || typeof markdown !== "string" || markdown.trim() === "") {
    return null;
  }

  const lines = markdown.split(/\r?\n/u);
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^##\s+(\S+)/u.exec(lines[index]);
    if (!heading) {
      continue;
    }
    if (start === -1) {
      if (normalizeVersion(heading[1]) === normalized) {
        start = index;
      }
      continue;
    }
    end = index;
    break;
  }

  if (start === -1) {
    return null;
  }

  const section = lines.slice(start, end).join("\n").trim();
  const hasListItem = section.split("\n").some((line) => /^\s*[-*]\s+\S/u.test(line));
  return hasListItem ? section : null;
}

/**
 * 组装 GitHub Release body：中文区块在前，英文区块在后，用分隔线区分。
 * 任一语言缺失时退化为单语言内容。
 */
export function buildReleaseBody({ zhNotes, enNotes }) {
  if (zhNotes && enNotes) {
    return `${zhNotes}\n\n---\n\n${enNotes}`;
  }
  return zhNotes ?? enNotes ?? null;
}

/**
 * 解析一次发版需要的全部更新内容。
 * `notes` 只取中文区块（manifest 单语字段），`body` 为中英合并结果。
 */
export function resolveReleaseNotes({ version, zhMarkdown, enMarkdown }) {
  const zhNotes = extractVersionSection(zhMarkdown, version);
  const enNotes = extractVersionSection(enMarkdown, version);
  return {
    zhNotes,
    enNotes,
    notes: zhNotes,
    body: buildReleaseBody({ zhNotes, enNotes }),
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function readIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${contents.trim()}\n`);
}

/** CLI 入口：缺内容时以非零码退出，让发版 job 直接失败。 */
export function runCli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const version = args.version ?? env.RELEASE_VERSION ?? "";
  if (!normalizeVersion(version)) {
    console.error("✗ 缺少版本号：传 --version 或设置 RELEASE_VERSION");
    process.exit(1);
  }

  const zhPath = args.zh ?? "apps/desktop/CHANGELOG.md";
  const enPath = args.en ?? "apps/desktop/CHANGELOG_EN.md";
  const notesOut = args["notes-out"] ?? "dist-desktop/release-notes.md";
  const bodyOut = args["body-out"] ?? "dist-desktop/release-body.md";

  const resolved = resolveReleaseNotes({
    version,
    zhMarkdown: readIfExists(zhPath),
    enMarkdown: readIfExists(enPath),
  });

  if (!resolved.notes) {
    console.error(
      `✗ ${zhPath} 中找不到 ${normalizeVersion(version)} 的有效更新内容（需要版本标题 + 至少一条列表项），发版中止。`,
    );
    process.exit(1);
  }

  writeFile(notesOut, resolved.notes);
  writeFile(bodyOut, resolved.body ?? resolved.notes);
  console.log(
    `✓ 更新内容已生成：${notesOut}（manifest notes） / ${bodyOut}（release body，${
      resolved.enNotes ? "中英双语" : "仅中文"
    }）`,
  );
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname));

if (isDirectRun) {
  runCli();
}
