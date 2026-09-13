//! # Process Utilities
//!
//! 提供跨平台子进程命令封装，防止在 Windows 系统上弹出控制台黑窗口。

use std::ffi::OsStr;
use std::process::Command;

/// 创建一个在 Windows 下不会弹出控制台黑窗口（CREATE_NO_WINDOW = 0x08000000）的子进程命令。
/// 在 macOS / Linux 等 Unix 系统下保持系统默认行为，与普通的 `Command::new` 等价。
pub(crate) fn silent_command<S: AsRef<OsStr>>(program: S) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_silent_command_instantiation() {
        let cmd = silent_command("echo");
        // 验证 silent_command 在当前平台下能够正确构建 Command 实例
        let program = cmd.get_program();
        assert_eq!(program, "echo");
    }
}
