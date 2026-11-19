import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerDirectory = mkdtempSync(resolve(tmpdir(), "editor-web-consumer-"));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: resolve(consumerDirectory, "npm-cache"),
};

try {
  execFileSync("npm", ["pack", packageDirectory, "--pack-destination", consumerDirectory], {
    cwd: consumerDirectory,
    env: npmEnvironment,
    stdio: "inherit",
  });
  const archive = resolve(consumerDirectory, "md-editor-editor-web-0.0.0.tgz");
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      consumerDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: consumerDirectory, env: npmEnvironment, stdio: "inherit" },
  );
  const smokeFile = resolve(consumerDirectory, "consumer.mjs");
  writeFileSync(
    smokeFile,
    `import { mountPlayground } from "@md-editor/editor-web";
import { statSync } from "node:fs";
const wasm = new URL("./node_modules/@md-editor/editor-web/dist/inkpoint_editor_web_bg.wasm", import.meta.url);
if (statSync(wasm).size === 0) throw new Error("Packed consumer is missing the WebAssembly module");
if (typeof mountPlayground !== "function") throw new Error("Missing mountPlayground export");
console.log("Packed @md-editor/editor-web import resolved with its WASM artifact");
`,
  );
  execFileSync("node", [smokeFile], { cwd: consumerDirectory, stdio: "inherit" });
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true });
}
