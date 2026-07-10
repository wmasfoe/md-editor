import fs from "node:fs";

export function hasVersionSection(contents, version) {
  return versionSectionPattern(version).test(contents);
}

export function updateChangelogContents(contents, { version, notes, date, mode }) {
  if (!version) {
    throw new Error("Expected a release version for changelog update.");
  }

  const targetExists = hasVersionSection(contents, version);

  // 发版脚本必须可重试：普通模式只创建新版本，resume 只复用已创建版本，避免重复或静默覆盖。
  if (mode === "resume") {
    if (!targetExists) {
      throw new Error(`CHANGELOG.md is missing section for ${version}; cannot resume release.`);
    }
    return contents;
  }

  if (targetExists) {
    throw new Error(
      `CHANGELOG.md already contains section for ${version}; use --resume only for partial release retries.`,
    );
  }

  const nextSection = formatChangelogSection({ version, notes, date });
  const trimmed = contents.trim();

  if (!trimmed) {
    return `# Changelog\n\n${nextSection}\n`;
  }

  const titleMatch = trimmed.match(/^#\s+Changelog\s*$/im);
  if (!titleMatch || titleMatch.index === undefined) {
    return `# Changelog\n\n${nextSection}\n\n${trimmed}\n`;
  }

  const insertAt = titleMatch.index + titleMatch[0].length;
  const title = trimmed.slice(0, insertAt).trimEnd();
  const tail = trimmed.slice(insertAt).trimStart();
  return `${title}\n\n${nextSection}\n\n${tail}\n`;
}

export function updateChangelogFile({
  path,
  version,
  notes,
  date = today(),
  mode = "normal",
  dryRun = false,
}) {
  const current = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
  const next = updateChangelogContents(current, { version, notes, date, mode });

  if (!dryRun && next !== current) {
    fs.writeFileSync(path, next);
  }

  return {
    changed: next !== current,
    path,
    version,
  };
}

function formatChangelogSection({ version, notes, date }) {
  const items = formatNotes(notes);
  return [`## ${version} - ${date}`, "", ...items].join("\n");
}

function formatNotes(notes) {
  const lines = String(notes ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const effectiveLines = lines.length > 0 ? lines : ["暂无发布说明。"];

  // 允许用户输入普通文本或项目符号，最终统一写成 Markdown bullet。
  return effectiveLines.map((line) =>
    line.match(/^[-*]\s+/u) ? line.replace(/^[-*]\s+/u, "- ") : `- ${line}`,
  );
}

function versionSectionPattern(version) {
  return new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s+-\\s+.+)?\\s*$`, "mu");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
