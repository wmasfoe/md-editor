#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::Duration;

/// 静默确保 macOS Quick Look 扩展在系统层面已注册并启用。
///
/// 从第一性原理：
/// 1. 扩展位于 Inkpoint.app/Contents/PlugIns/InkpointQuickLook.appex；
/// 2. 当用户升级或初次安装应用并启动后，后台异步检查扩展状态；
/// 3. 若未启用，则自动调用 pluginkit 注册并设为 use 状态，同时刷新 quicklookd 缓存，
///    彻底免除用户手动前往“系统设置 -> 登录项与扩展 -> 快速查看”勾选的繁琐心智负担。
#[cfg(target_os = "macos")]
pub fn register_quicklook_extension_if_needed() {
    std::thread::spawn(|| {
        let Some(current_exe) = std::env::current_exe().ok() else {
            return;
        };

        // current_exe: .../Contents/MacOS/md-editor
        let Some(contents_dir) = current_exe.parent().and_then(|p| p.parent()) else {
            return;
        };

        let appex_path = contents_dir.join("PlugIns").join("InkpointQuickLook.appex");
        if !appex_path.exists() {
            return;
        }

        let appex_str = match appex_path.to_str() {
            Some(s) => s,
            None => return,
        };

        let pluginkit_bin = if std::path::Path::new("/usr/bin/pluginkit").exists() {
            "/usr/bin/pluginkit"
        } else {
            "pluginkit"
        };
        let qlmanage_bin = if std::path::Path::new("/usr/bin/qlmanage").exists() {
            "/usr/bin/qlmanage"
        } else {
            "qlmanage"
        };

        // 检查当前插件是否已被系统启用（以 '+' 开头即表示已启用）
        let is_already_enabled = Command::new(pluginkit_bin)
            .args(["-m", "-v", "-i", "dev.md-editor.app.quicklook"])
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout
                    .lines()
                    .any(|line| line.trim_start().starts_with('+'))
            })
            .unwrap_or(false);

        if is_already_enabled {
            return;
        }

        // 1. 注册扩展包路径到系统
        let _ = Command::new(pluginkit_bin).args(["-a", appex_str]).status();

        // 稍作让步等待 LaunchServices 同步注册记录
        std::thread::sleep(Duration::from_millis(100));

        // 2. 将扩展标记为启用 (use)
        let _ = Command::new(pluginkit_bin)
            .args(["-e", "use", "-i", "dev.md-editor.app.quicklook"])
            .status();

        // 3. 刷新 QuickLook 生成器与缩略图缓存
        let _ = Command::new(qlmanage_bin).args(["-r", "cache"]).status();
        let _ = Command::new(qlmanage_bin).args(["-r"]).status();
    });
}
