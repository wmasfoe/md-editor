use serde::Serialize;
use tauri::command;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemSpecs {
    pub(crate) total_memory_bytes: u64,
    pub(crate) cpu_arch: String,
    pub(crate) os: String,
    pub(crate) cpu_cores: usize,
}

#[command]
pub(crate) fn get_system_specs() -> Result<SystemSpecs, String> {
    let total_memory_bytes = read_total_memory_bytes();
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    Ok(SystemSpecs {
        total_memory_bytes,
        cpu_arch: std::env::consts::ARCH.to_string(),
        os: std::env::consts::OS.to_string(),
        cpu_cores,
    })
}

fn read_total_memory_bytes() -> u64 {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(8 * 1024 * 1024 * 1024)
    }

    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|content| {
                content.lines().find_map(|line| {
                    if line.starts_with("MemTotal:") {
                        line.split_whitespace()
                            .nth(1)
                            .and_then(|kb| kb.parse::<u64>().ok())
                            .map(|kb| kb * 1024)
                    } else {
                        None
                    }
                })
            })
            .unwrap_or(8 * 1024 * 1024 * 1024)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        8 * 1024 * 1024 * 1024
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gets_reasonable_system_specs() {
        let specs = get_system_specs().unwrap();
        assert!(specs.total_memory_bytes > 0);
        assert!(specs.cpu_cores > 0);
        assert!(!specs.cpu_arch.is_empty());
        assert!(!specs.os.is_empty());
    }
}
