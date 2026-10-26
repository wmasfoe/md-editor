use std::env;
use std::fs;
use std::path::PathBuf;

fn ensure_external_bin_placeholders() {
    let target = match env::var("TARGET") {
        Ok(target) => target,
        Err(_) => return,
    };

    let manifest_dir = env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let binaries_dir = manifest_dir.join("binaries");
    if !binaries_dir.exists() {
        let _ = fs::create_dir_all(&binaries_dir);
    }

    let is_windows = target.contains("windows");
    let binary_name = if is_windows {
        format!("llama-server-{target}.exe")
    } else {
        format!("llama-server-{target}")
    };

    let target_path = binaries_dir.join(&binary_name);
    if !target_path.exists() {
        // 创建占位文件，确保在未下载完整 release sidecar 时（如本地开发、单元测试、CI 校验）
        // tauri-build 不会因为找不到目标架构二进制文件而编译失败。
        let _ = fs::write(&target_path, b"");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = fs::metadata(&target_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&target_path, perms);
            }
        }
    }
}

fn ensure_pdf_exporter_binary() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let binaries_dir = manifest_dir.join("binaries");
    if !binaries_dir.exists() {
        let _ = fs::create_dir_all(&binaries_dir);
    }

    let target_bin = binaries_dir.join("inkpoint-pdf-exporter");
    let swift_source = manifest_dir.join("helpers/pdf_export/main.swift");

    if cfg!(target_os = "macos") && swift_source.exists() {
        if !target_bin.exists() {
            let _ = std::process::Command::new("swiftc")
                .args([
                    "-target",
                    "arm64-apple-macos12.0",
                    "-O",
                    "-o",
                    target_bin.to_str().unwrap(),
                    swift_source.to_str().unwrap(),
                    "-framework",
                    "WebKit",
                    "-framework",
                    "PDFKit",
                    "-framework",
                    "Foundation",
                ])
                .status();
        }

        // 同步拷贝至 target/debug 或 target/release 目录，与主二进制并列
        if target_bin.exists() {
            if let Ok(out_dir) = env::var("OUT_DIR").map(PathBuf::from) {
                let mut current = out_dir.as_path();
                while let Some(parent) = current.parent() {
                    if parent
                        .file_name()
                        .is_some_and(|name| name == "debug" || name == "release")
                    {
                        let dest = parent.join("inkpoint-pdf-exporter");
                        let _ = fs::copy(&target_bin, dest);
                        break;
                    }
                    current = parent;
                }
            }
        }
    }
}

fn main() {
    ensure_external_bin_placeholders();
    ensure_pdf_exporter_binary();
    tauri_build::build();
}
