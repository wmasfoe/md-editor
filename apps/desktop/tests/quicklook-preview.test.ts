import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("macOS Quick Look App Extension", () => {
  const extensionDir = path.resolve(__dirname, "../src-tauri/extensions/quicklook");
  const resourcesDir = path.join(extensionDir, "Resources");
  const buildScriptPath = path.resolve(__dirname, "../scripts/build-quicklook.sh");
  const tauriConfigPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
  const tauriMacosConfigPath = path.resolve(__dirname, "../src-tauri/tauri.macos.conf.json");

  it("should have valid PreviewProvider.swift with size limit, JavaScriptCore and static engine invocation", () => {
    const swiftFile = path.join(extensionDir, "PreviewProvider.swift");
    expect(fs.existsSync(swiftFile)).toBe(true);

    const content = fs.readFileSync(swiftFile, "utf-8");
    expect(content).toContain("class PreviewProvider: QLPreviewProvider");
    expect(content).toContain("QLPreviewReply(fileURL:");
    expect(content).toContain("maxPreviewBytes");
    expect(content).toContain("QuickLookEngine");
    expect(content).toContain("InkpointStaticRenderer");
    expect(content).toContain("JavaScriptCore");
  });

  it("should have main.swift entry point calling NSExtensionMain", () => {
    const mainFile = path.join(extensionDir, "main.swift");
    expect(fs.existsSync(mainFile)).toBe(true);

    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain("NSExtensionMain");
  });

  it("should have Info.plist declaring Quick Look preview extension and markdown UTIs", () => {
    const infoPlist = path.join(extensionDir, "Info.plist");
    expect(fs.existsSync(infoPlist)).toBe(true);

    const content = fs.readFileSync(infoPlist, "utf-8");
    expect(content).toContain("com.apple.quicklook.preview");
    expect(content).toContain("dev.md-editor.app.quicklook");
    expect(content).toContain("QLIsDataBasedPreview");
    expect(content).toContain("net.daringfireball.markdown");
    expect(content).toContain("public.markdown");
    expect(content).toContain("text/markdown");
    expect(content).toContain("public.plain-text");
  });

  it("should contain bundled quicklook-engine.js compiled from @md-editor/renderer-codemirror/static", () => {
    const engineJs = path.join(resourcesDir, "quicklook-engine.js");
    expect(fs.existsSync(engineJs)).toBe(true);

    const stat = fs.statSync(engineJs);
    expect(stat.size).toBeGreaterThan(100000); // Bundled engine with marked and highlight.js

    const content = fs.readFileSync(engineJs, "utf-8");
    expect(content).toContain("InkpointStaticRenderer");
    expect(content).toContain("renderStaticDocument");
    expect(content).toContain("prefers-color-scheme: dark");
  });

  it("should have executable build-quicklook.sh targeting arm64-apple-macos12.0", () => {
    expect(fs.existsSync(buildScriptPath)).toBe(true);
    const scriptContent = fs.readFileSync(buildScriptPath, "utf-8");
    expect(scriptContent).toContain("arm64-apple-macos12.0");
    expect(scriptContent).toContain("InkpointQuickLook.appex");
    expect(scriptContent).toContain("codesign");
  });

  it("should configure fileAssociations in tauri.conf.json", () => {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf-8"));
    expect(tauriConfig.bundle?.fileAssociations).toBeDefined();

    const mdAssoc = tauriConfig.bundle.fileAssociations.find((assoc: { ext: string[] }) =>
      assoc.ext.includes("md"),
    );
    expect(mdAssoc).toBeDefined();
    expect(mdAssoc.ext).toContain("markdown");
  });

  it("should configure macOS.files in tauri.macos.conf.json to bundle the appex into PlugIns", () => {
    const macosConfig = JSON.parse(fs.readFileSync(tauriMacosConfigPath, "utf-8"));
    expect(macosConfig.bundle?.macOS?.files).toBeDefined();
    expect(macosConfig.bundle.macOS.files["PlugIns/InkpointQuickLook.appex"]).toBe(
      "target/quicklook/InkpointQuickLook.appex",
    );
  });
});
