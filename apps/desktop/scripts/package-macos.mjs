import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bundleRoot = path.join(repositoryRoot, "target/gpui-preview");
const appName = "Inkpoint GPUI Preview";
const bundleIdentifier = "com.inkpoint.gpui-preview";
const binaryName = "inkpoint-gpui";
const version = process.env.GPUI_VERSION;

if (!version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version)) {
  throw new Error("Set GPUI_VERSION to the GPUI app's semantic version.");
}

const targetTriple = process.env.CARGO_BUILD_TARGET;
const binaryPath = path.join(
  repositoryRoot,
  "target",
  ...(targetTriple ? [targetTriple] : []),
  "release",
  binaryName,
);
if (!fs.existsSync(binaryPath)) {
  throw new Error(`The release binary is missing at ${binaryPath}. Build it before packaging.`);
}

fs.mkdirSync(bundleRoot, { recursive: true });
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-gpui-dmg-"));
const appBundle = path.join(bundleRoot, `${appName}.app`);
const dmgPath = path.join(bundleRoot, `${appName.replaceAll(" ", "-")}_${version}_aarch64.dmg`);
fs.rmSync(appBundle, { recursive: true, force: true });
fs.rmSync(dmgPath, { force: true });
const contentsRoot = path.join(appBundle, "Contents");
const macosRoot = path.join(contentsRoot, "MacOS");
const resourcesRoot = path.join(contentsRoot, "Resources");
const llamaRoot = path.join(resourcesRoot, "llama");
const appVersion = version.split("-", 1)[0];

fs.mkdirSync(macosRoot, { recursive: true });
fs.mkdirSync(llamaRoot, { recursive: true });
fs.copyFileSync(binaryPath, path.join(macosRoot, binaryName));
fs.chmodSync(path.join(macosRoot, binaryName), 0o755);
// 图标与 llama.cpp 运行时曾寄存在 Tauri 的 src-tauri 目录。Tauri 退役后
// 这两个资产由 GPUI 宿主直接拥有，路径固定在 apps/desktop/assets 与 apps/desktop/runtime。
fs.copyFileSync(
  path.join(repositoryRoot, "apps/desktop/assets/AppIcon.icns"),
  path.join(resourcesRoot, "AppIcon.icns"),
);

const llamaRuntimeRoot = path.join(repositoryRoot, "apps/desktop/runtime/llama");
const sidecarPath = path.join(llamaRuntimeRoot, "llama-server-aarch64-apple-darwin");
if (!fs.existsSync(sidecarPath)) {
  throw new Error(`The llama-server runtime is missing at ${sidecarPath}.`);
}
fs.copyFileSync(sidecarPath, path.join(llamaRoot, "llama-server"));
fs.chmodSync(path.join(llamaRoot, "llama-server"), 0o755);

const sharedRuntimeDirectory = path.join(llamaRuntimeRoot, "llama-runtime-macos-arm64");
if (fs.existsSync(sharedRuntimeDirectory)) {
  for (const entry of fs.readdirSync(sharedRuntimeDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".dylib")) {
      fs.copyFileSync(
        path.join(sharedRuntimeDirectory, entry.name),
        path.join(llamaRoot, entry.name),
      );
    }
  }
}

for (const entry of fs.readdirSync(path.dirname(sidecarPath), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".dylib")) {
    fs.copyFileSync(
      path.join(path.dirname(sidecarPath), entry.name),
      path.join(llamaRoot, entry.name),
    );
  }
}

const licensePath = path.join(sharedRuntimeDirectory, "LICENSE.llama.cpp");
if (fs.existsSync(licensePath)) {
  fs.copyFileSync(licensePath, path.join(llamaRoot, "LICENSE.llama.cpp"));
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>${binaryName}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>${appName}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${appVersion}</string>
<key>CFBundleVersion</key><string>${appVersion}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticGraphicsSwitching</key><true/>
<key>UTImportedTypeDeclarations</key><array><dict>
<key>UTTypeIdentifier</key><string>com.inkpoint.markdown</string>
<key>UTTypeDescription</key><string>Markdown Document</string>
<key>UTTypeConformsTo</key><array><string>public.text</string></array>
<key>UTTypeTagSpecification</key><dict>
<key>public.filename-extension</key><array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string><string>mkdn</string></array>
</dict>
</dict><dict>
<key>UTTypeIdentifier</key><string>com.inkpoint.mdx</string>
<key>UTTypeDescription</key><string>MDX Document</string>
<key>UTTypeConformsTo</key><array><string>public.markdown</string></array>
<key>UTTypeTagSpecification</key><dict>
<key>public.filename-extension</key><string>mdx</string>
</dict>
</dict></array>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Markdown Document</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array>
<string>net.daringfireball.markdown</string><string>public.markdown</string><string>com.inkpoint.markdown</string>
</array>
</dict><dict>
<key>CFBundleTypeName</key><string>MDX Document</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>com.inkpoint.mdx</string></array>
</dict></array>
</dict></plist>
`;
fs.writeFileSync(path.join(contentsRoot, "Info.plist"), infoPlist);

const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appBundle], {
  stdio: "inherit",
});
if (sign.status !== 0) {
  throw new Error("Could not ad-hoc sign the GPUI app bundle.");
}
const verifySignature = spawnSync("codesign", ["--verify", "--deep", "--strict", appBundle], {
  stdio: "inherit",
});
if (verifySignature.status !== 0) {
  throw new Error("The GPUI app bundle failed strict code-signature verification.");
}

const dmgStage = path.join(stageRoot, "dmg");
fs.mkdirSync(dmgStage, { recursive: true });
fs.cpSync(appBundle, path.join(dmgStage, `${appName}.app`), { recursive: true });
fs.symlinkSync("/Applications", path.join(dmgStage, "Applications"));

const createDmg = spawnSync(
  "hdiutil",
  ["create", "-volname", appName, "-srcfolder", dmgStage, "-ov", "-format", "UDZO", dmgPath],
  { stdio: "inherit" },
);
fs.rmSync(stageRoot, { recursive: true, force: true });
if (createDmg.status !== 0) {
  throw new Error("Could not create the GPUI DMG.");
}

console.log(`Created ${dmgPath}`);
