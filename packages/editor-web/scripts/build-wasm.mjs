import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const workspaceDirectory = resolve(packageDirectory, "../..");
const wasmTarget = "wasm32-unknown-unknown";
const crate = "inkpoint-editor-web";
const targetDirectory = process.env.CARGO_TARGET_DIR || resolve(workspaceDirectory, "target");
const toolchain = process.env.WASM_RUST_TOOLCHAIN || "nightly-2026-11-18";
const wasmArtifact = resolve(
  targetDirectory,
  wasmTarget,
  "release",
  `${crate.replaceAll("-", "_")}.wasm`,
);
const outputDirectory = resolve(packageDirectory, "dist");
const wasmBindgen = process.env.WASM_BINDGEN_BIN || "wasm-bindgen";

execFileSync(
  "cargo",
  [`+${toolchain}`, "build", "--locked", "--release", "--target", wasmTarget, "-p", crate],
  { cwd: workspaceDirectory, stdio: "inherit" },
);

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
execFileSync(
  wasmBindgen,
  [
    wasmArtifact,
    "--target",
    "web",
    "--out-dir",
    outputDirectory,
    "--out-name",
    `${crate.replaceAll("-", "_")}`,
  ],
  { cwd: workspaceDirectory, stdio: "inherit" },
);
