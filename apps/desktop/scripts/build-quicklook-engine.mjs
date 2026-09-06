import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const entryFile = path.resolve(
  desktopDir,
  "../../packages/renderer-codemirror/src/static/index.ts",
);
const outDir = path.resolve(desktopDir, "src-tauri/extensions/quicklook/Resources");

console.log("==> Building Quick Look Engine bundle from @md-editor/renderer-codemirror/static...");

await build({
  configFile: false,
  publicDir: false,
  build: {
    lib: {
      entry: entryFile,
      name: "InkpointStaticRenderer",
      fileName: () => "quicklook-engine.js",
      formats: ["iife"],
    },
    outDir,
    emptyOutDir: false,
    minify: true,
  },
});

console.log(
  "==> Successfully built quicklook-engine.js at:",
  path.join(outDir, "quicklook-engine.js"),
);
