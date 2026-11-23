import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("macOS Quick Look App Extension", () => {
  const extensionDir = path.resolve(__dirname, "../src-tauri/extensions/quicklook");
  const resourcesDir = path.join(extensionDir, "Resources");
  const buildScriptPath = path.resolve(__dirname, "../scripts/build-quicklook.sh");
  const tauriConfigPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
  const tauriMacosConfigPath = path.resolve(__dirname, "../src-tauri/tauri.macos.conf.json");

  it("PreviewProvider.swift 通过 C ABI 调用 Rust 渲染核心，不再依赖 JavaScriptCore", () => {
    const swiftFile = path.join(extensionDir, "PreviewProvider.swift");
    expect(fs.existsSync(swiftFile)).toBe(true);

    const content = fs.readFileSync(swiftFile, "utf-8");
    expect(content).toContain("class PreviewProvider: QLPreviewProvider");
    expect(content).toContain("QLPreviewReply(fileURL:");
    expect(content).toContain("maxPreviewBytes");

    // 渲染委托给 crates/render-ffi 导出的 C 符号
    expect(content).toContain('@_silgen_name("md_render_document")');
    expect(content).toContain('@_silgen_name("md_render_free_string")');
    expect(content).toContain("RustRenderer");

    // 旧的内嵌 JS 引擎必须彻底移除（否则就是双实现残留）。
    // 注释里允许提及历史（解释为什么不能用 JSC），因此只断言**代码**层面：
    // import 语句、JSContext 类型使用、引擎对象引用。
    expect(content).not.toMatch(/^import JavaScriptCore$/m);
    expect(content).not.toMatch(/\bJSContext\b(?!.*\/\/)/);
    expect(content).not.toContain("InkpointStaticRenderer");
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

  it("不再随包内嵌 JS 渲染引擎（渲染已迁到 Rust）", () => {
    // 扩展的 Resources 目录里不应再有 quicklook-engine.js。
    // 渲染核心现在是链接进二进制的 Rust 静态库。
    const engineJs = path.join(resourcesDir, "quicklook-engine.js");
    expect(fs.existsSync(engineJs)).toBe(false);

    // 构建脚本也必须停止生成它，且改为链接 Rust 静态库。
    const buildScript = fs.readFileSync(buildScriptPath, "utf-8");
    expect(buildScript).not.toContain("build-quicklook-engine.mjs");
    expect(buildScript).toContain("crates/render-ffi");
    expect(buildScript).toContain("libmd_render_ffi.a");
    expect(buildScript).toContain("-lmd_render_ffi");
    // 不允许链接 JavaScriptCore（本扩展没有 allow-jit，且渲染已原生化）
    expect(buildScript).not.toContain("-framework JavaScriptCore");
  });

  it("Rust 静态库的 deployment target 与 Swift 扩展一致", () => {
    const buildScript = fs.readFileSync(buildScriptPath, "utf-8");
    // 两者不一致会导致「built for newer macOS than being linked」并可能用到旧系统没有的符号
    expect(buildScript).toContain("MACOSX_DEPLOYMENT_TARGET=12.0");
    expect(buildScript).toContain("arm64-apple-macos12.0");
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
    expect(mdAssoc.contentTypes).toContain("net.daringfireball.markdown");
    expect(mdAssoc.contentTypes).toContain("public.markdown");
  });

  it("should configure macOS.files in tauri.macos.conf.json to bundle the appex into PlugIns", () => {
    const macosConfig = JSON.parse(fs.readFileSync(tauriMacosConfigPath, "utf-8"));
    expect(macosConfig.bundle?.macOS?.files).toBeDefined();
    expect(macosConfig.bundle.macOS.files["PlugIns/InkpointQuickLook.appex"]).toBe(
      "target/quicklook/InkpointQuickLook.appex",
    );
  });
});
