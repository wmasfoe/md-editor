import fs from "node:fs";
import path from "node:path";

const UTOOLS_TAG_PREFIX = "utools-v";
const MAX_LOGO_SIZE = 256;
const FORBIDDEN_RELEASE_SUFFIXES = [".map", ".gz"];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveFrom(rootDir, targetPath) {
  return path.isAbsolute(targetPath) ? targetPath : path.join(rootDir, targetPath);
}

function readPngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  const hasValidHeader =
    header.length === 24 &&
    header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
    header.toString("ascii", 12, 16) === "IHDR";

  if (!hasValidHeader) {
    throw new Error("uTools logo must be a valid PNG file.");
  }

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function findForbiddenReleaseFiles(directory, rootDirectory = directory) {
  const forbiddenFiles = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      forbiddenFiles.push(...findForbiddenReleaseFiles(entryPath, rootDirectory));
      continue;
    }

    const lowerCaseName = entry.name.toLowerCase();
    if (FORBIDDEN_RELEASE_SUFFIXES.some((suffix) => lowerCaseName.endsWith(suffix))) {
      forbiddenFiles.push(path.relative(rootDirectory, entryPath).split(path.sep).join("/"));
    }
  }

  return forbiddenFiles;
}

export function validateUtoolsRelease({ rootDir = process.cwd(), tag, distDir } = {}) {
  const packageManifestPath = path.join(rootDir, "apps/utools/package.json");
  const pluginManifestPath = path.join(rootDir, "apps/utools/plugin.json");
  const packageManifest = readJson(packageManifestPath);
  const pluginManifest = readJson(pluginManifestPath);
  const version = packageManifest.version;

  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid uTools package version: ${JSON.stringify(version)}.`);
  }

  if (pluginManifest.version !== version) {
    throw new Error(
      `uTools version mismatch: package.json=${version}, plugin.json=${pluginManifest.version}.`,
    );
  }

  const expectedTag = `${UTOOLS_TAG_PREFIX}${version}`;
  if (tag && tag !== expectedTag) {
    throw new Error(`uTools tag mismatch: expected ${expectedTag}, got ${tag}.`);
  }

  if (distDir) {
    const absoluteDistDir = resolveFrom(rootDir, distDir);
    const distManifest = readJson(path.join(absoluteDistDir, "plugin.json"));

    if (distManifest.version !== version) {
      throw new Error(
        `uTools dist version mismatch: expected ${version}, got ${distManifest.version}.`,
      );
    }

    if (distManifest.main !== "index.html") {
      throw new Error(`uTools dist main must be index.html, got ${distManifest.main}.`);
    }

    if (Object.hasOwn(distManifest, "development")) {
      throw new Error("uTools dist plugin.json must not contain development settings.");
    }

    for (const relativePath of ["index.html", "logo.png", "preload/index.js"]) {
      if (!fs.existsSync(path.join(absoluteDistDir, relativePath))) {
        throw new Error(`Missing required uTools release file: ${relativePath}.`);
      }
    }

    const logoDimensions = readPngDimensions(path.join(absoluteDistDir, "logo.png"));
    if (logoDimensions.width > MAX_LOGO_SIZE || logoDimensions.height > MAX_LOGO_SIZE) {
      throw new Error(
        `uTools logo must not exceed ${MAX_LOGO_SIZE}x${MAX_LOGO_SIZE} pixels, got ${logoDimensions.width}x${logoDimensions.height}.`,
      );
    }

    const forbiddenFiles = findForbiddenReleaseFiles(absoluteDistDir);
    if (forbiddenFiles.length > 0) {
      throw new Error(
        `uTools release contains forbidden debug files: ${forbiddenFiles.toSorted().join(", ")}.`,
      );
    }
  }

  return { version, tag: expectedTag };
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--tag", "--dist", "--github-output"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}.`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after ${argument}.`);
    }

    if (argument === "--tag") options.tag = value;
    if (argument === "--dist") options.distDir = value;
    if (argument === "--github-output") options.githubOutput = value;
    index += 1;
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateUtoolsRelease(options);

  if (options.githubOutput) {
    fs.appendFileSync(
      options.githubOutput,
      `version=${result.version}\ntag=${result.tag}\n`,
      "utf8",
    );
  }

  console.log(`Validated uTools release ${result.tag}.`);
}

if (process.argv[1]?.endsWith("validate-utools-release.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
