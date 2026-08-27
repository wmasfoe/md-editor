import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_LLAMA_CPP_TAG = process.env.LLAMA_CPP_RELEASE_TAG?.trim() || "b4600";
const BINARIES_DIR = path.resolve("apps/desktop/src-tauri/binaries");

/**
 * Mapping target triple to llama.cpp release asset configurations
 */
const TARGET_CONFIGS = {
  "aarch64-apple-darwin": {
    binaryName: "llama-server-aarch64-apple-darwin",
    isExecutable: true,
    assetNames: [
      `llama-${DEFAULT_LLAMA_CPP_TAG}-bin-macos-arm64.zip`,
      `llama-server-macos-arm64.zip`,
    ],
  },
  "x86_64-apple-darwin": {
    binaryName: "llama-server-x86_64-apple-darwin",
    isExecutable: true,
    assetNames: [`llama-${DEFAULT_LLAMA_CPP_TAG}-bin-macos-x64.zip`, `llama-server-macos-x64.zip`],
  },
  "x86_64-unknown-linux-gnu": {
    binaryName: "llama-server-x86_64-unknown-linux-gnu",
    isExecutable: true,
    assetNames: [
      `llama-${DEFAULT_LLAMA_CPP_TAG}-bin-ubuntu-x64.zip`,
      `llama-server-ubuntu-x64.zip`,
    ],
  },
  "aarch64-unknown-linux-gnu": {
    binaryName: "llama-server-aarch64-unknown-linux-gnu",
    isExecutable: true,
    assetNames: [
      `llama-${DEFAULT_LLAMA_CPP_TAG}-bin-ubuntu-arm64.zip`,
      `llama-server-ubuntu-arm64.zip`,
    ],
  },
  "x86_64-pc-windows-msvc": {
    binaryName: "llama-server-x86_64-pc-windows-msvc.exe",
    isExecutable: false,
    assetNames: [
      `llama-${DEFAULT_LLAMA_CPP_TAG}-bin-win-cpu-x64.zip`,
      `llama-${DEFAULT_LLAMA_CPP_TAG}-bin-win-avx2-x64.zip`,
    ],
  },
  "aarch64-pc-windows-msvc": {
    binaryName: "llama-server-aarch64-pc-windows-msvc.exe",
    isExecutable: false,
    assetNames: [`llama-${DEFAULT_LLAMA_CPP_TAG}-bin-win-arm64.zip`],
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let target = "";
  let checkOnly = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      target = args[++i];
    } else if (args[i].startsWith("--target=")) {
      target = args[i].slice("--target=".length);
    } else if (args[i] === "--check") {
      checkOnly = true;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  return { target, checkOnly, force };
}

function detectHostTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  return "x86_64-unknown-linux-gnu";
}

async function prepareLlamaRuntime() {
  const { target: targetArg, checkOnly, force } = parseArgs();
  const target = targetArg || detectHostTarget();

  const config = TARGET_CONFIGS[target];
  if (!config) {
    console.warn(
      `[prepare-llama-runtime] Unknown target: ${target}. Skipping llama-server download.`,
    );
    return;
  }

  const outputPath = path.join(BINARIES_DIR, config.binaryName);
  if (fs.existsSync(outputPath) && !force) {
    console.log(
      `[prepare-llama-runtime] ${config.binaryName} is already present at ${outputPath}.`,
    );
    return;
  }

  if (checkOnly) {
    console.log(`[prepare-llama-runtime] ${config.binaryName} is not present at ${outputPath}.`);
    process.exit(1);
  }

  if (process.env.SKIP_LLAMA_DOWNLOAD === "1") {
    console.log(
      `[prepare-llama-runtime] SKIP_LLAMA_DOWNLOAD=1 is set. Skipping download for ${target}.`,
    );
    return;
  }

  console.log(`[prepare-llama-runtime] Preparing llama-server for target ${target}...`);
  fs.mkdirSync(BINARIES_DIR, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(BINARIES_DIR, "tmp-llama-"));
  try {
    let downloaded = false;
    for (const assetName of config.assetNames) {
      const url = `https://github.com/ggerganov/llama.cpp/releases/download/${DEFAULT_LLAMA_CPP_TAG}/${assetName}`;
      const zipPath = path.join(tempDir, assetName);
      console.log(`[prepare-llama-runtime] Attempting to download from ${url}...`);

      try {
        execFileSync("curl", ["-fL", "--retry", "3", "--retry-delay", "2", "-o", zipPath, url], {
          stdio: "inherit",
        });
        downloaded = true;

        console.log(`[prepare-llama-runtime] Extracting ${zipPath}...`);
        if (process.platform === "win32") {
          execFileSync("powershell", [
            "-Command",
            `Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force`,
          ]);
        } else {
          execFileSync("unzip", ["-o", "-q", zipPath, "-d", tempDir]);
        }

        // Find llama-server executable in extracted files
        const searchNames = config.binaryName.endsWith(".exe")
          ? ["llama-server.exe", "server.exe"]
          : ["llama-server", "server"];
        let foundPath = null;

        function searchDir(dir) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              searchDir(full);
            } else if (searchNames.includes(entry.name.toLowerCase())) {
              foundPath = full;
              return;
            }
          }
        }
        searchDir(tempDir);

        if (foundPath) {
          fs.copyFileSync(foundPath, outputPath);
          if (config.isExecutable) {
            fs.chmodSync(outputPath, 0o755);
          }
          console.log(
            `[prepare-llama-runtime] Successfully installed ${config.binaryName} to ${outputPath}`,
          );

          // Also copy all shared libraries so linuxdeploy / bundlers can resolve them
          const binDir = path.dirname(foundPath);
          const entries = fs.readdirSync(binDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (
                ext === ".so" ||
                ext === ".dll" ||
                ext === ".dylib" ||
                entry.name.includes(".so.")
              ) {
                const libOut = path.join(BINARIES_DIR, entry.name);
                fs.copyFileSync(path.join(binDir, entry.name), libOut);
                console.log(
                  `[prepare-llama-runtime] Copied shared library ${entry.name} to ${libOut}`,
                );
              }
            }
          }
          return;
        } else {
          console.warn(`[prepare-llama-runtime] Could not find llama-server in ${assetName}.`);
        }
      } catch (err) {
        console.warn(
          `[prepare-llama-runtime] Failed to download or extract ${assetName}: ${err.message}`,
        );
      }
    }

    if (!downloaded) {
      console.warn(
        `[prepare-llama-runtime] Note: Could not download prebuilt llama-server for ${target}. App will continue without bundled sidecar.`,
      );
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

prepareLlamaRuntime().catch((err) => {
  console.error(`[prepare-llama-runtime] Error:`, err);
});
