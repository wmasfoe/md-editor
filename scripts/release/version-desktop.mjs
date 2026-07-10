import { execFileSync } from "node:child_process";
import fs from "node:fs";

const rootPackagePath = "package.json";
const desktopPackagePath = "apps/desktop/package.json";
const cargoManifestPath = "apps/desktop/src-tauri/Cargo.toml";
const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected a semver version, got "${version}".`);
  }
}

function bumpVersion(currentVersion, bump) {
  if (!["major", "minor", "patch"].includes(bump)) {
    assertSemver(bump);
    return bump;
  }

  const [major, minor, patch] = currentVersion.split(".").map((part) => Number.parseInt(part, 10));

  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Cannot ${bump} bump non-numeric version "${currentVersion}".`);
  }

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageJson(path, version) {
  const packageJson = readJson(path);
  packageJson.version = version;
  writeJson(path, packageJson);
}

function updateTauriConfig(version) {
  const config = readJson(tauriConfigPath);
  config.version = version;
  writeJson(tauriConfigPath, config);
}

function updateCargoManifest(version) {
  const contents = fs.readFileSync(cargoManifestPath, "utf8");
  let inPackageSection = false;
  let updated = false;

  const nextContents = contents
    .split(/(?<=\n)/u)
    .map((line) => {
      const trimmedLine = line.trim();

      if (/^\[[^\]]+\]$/u.test(trimmedLine)) {
        inPackageSection = trimmedLine === "[package]";
      }

      if (!inPackageSection || updated) {
        return line;
      }

      return line.replace(/^(\s*version\s*=\s*)"[^"]*"/u, (_match, prefix) => {
        updated = true;
        return `${prefix}"${version}"`;
      });
    })
    .join("");

  if (!updated) {
    throw new Error(`Unable to find [package] version in ${cargoManifestPath}.`);
  }

  fs.writeFileSync(cargoManifestPath, nextContents);
}

const requestedVersion = process.argv[2];

if (!requestedVersion) {
  console.error("Usage: pnpm release:version <patch|minor|major|x.y.z>");
  process.exit(1);
}

const currentVersion = readJson(tauriConfigPath).version;
const nextVersion = bumpVersion(currentVersion, requestedVersion);

execFileSync(
  "cargo",
  ["metadata", "--manifest-path", cargoManifestPath, "--no-deps", "--format-version", "1"],
  {
    stdio: "ignore",
  },
);

updatePackageJson(rootPackagePath, nextVersion);
updatePackageJson(desktopPackagePath, nextVersion);
updateTauriConfig(nextVersion);
updateCargoManifest(nextVersion);

execFileSync("cargo", ["update", "--manifest-path", cargoManifestPath, "-w"], {
  stdio: "inherit",
});

console.log(`Updated desktop release version: ${currentVersion} -> ${nextVersion}`);
