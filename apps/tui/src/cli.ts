#!/usr/bin/env node
/**
 * inkpoint-tui：vim 式终端 Markdown 编辑器
 *
 * 用法:
 *   inkpoint-tui <file.md>   打开或新建文档
 *   inkpoint-tui --help      显示帮助
 *
 * 非交互环境（非 TTY）直接拒绝：终端编辑需要 raw mode。
 */
import { createFullscreenShell, loadDocumentText } from "./shell/fullscreen.ts";

export interface ParsedCliArgs {
  filePath: string | null;
  colorScheme: "dark" | "light" | "auto";
  showHelp: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let filePath: string | null = null;
  let colorScheme: "dark" | "light" | "auto" = "auto";
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--light") {
      colorScheme = "light";
    } else if (arg === "--dark") {
      colorScheme = "dark";
    } else if (arg === "--theme") {
      const val = argv[++i]?.toLowerCase();
      if (val === "light" || val === "dark" || val === "auto") {
        colorScheme = val;
      }
    } else if (!arg.startsWith("-") && filePath === null) {
      filePath = arg;
    }
  }

  return { filePath, colorScheme, showHelp };
}

export function main(): void {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);

  if (parsed.showHelp) {
    process.stdout.write(
      [
        "ink - vim 式终端 Markdown 编辑器 (别名: inkpoint-tui)",
        "",
        "用法:",
        "  ink <file.md>            打开或新建文档",
        "  ink --light <file.md>    强制使用浅色主题（高对比度焦橙/深琥珀标题）",
        "  ink --dark <file.md>     强制使用深色主题（暖金橙色标题）",
        "  ink --theme auto <file>  自动检测终端明暗配色（默认）",
        "  ink --help               显示帮助",
        "",
        "按键:",
        "  i/a/o/O/I/A   进入插入模式     Esc   回到 normal",
        "  hjkl/方向键   移动             0/$   行首/行尾   gg/G  文档首/尾",
        "  x             删除字符         dd    删除行      yy/p  复制/粘贴",
        "  u / Ctrl+r    撤销/重做        :w    保存        :q!   强制退出",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("ink: 需要在交互式终端中运行（stdout/stdin 必须为 TTY）\n");
    process.exit(1);
  }

  const shell = createFullscreenShell({
    filePath: parsed.filePath,
    initialText: loadDocumentText(parsed.filePath),
    colorScheme: parsed.colorScheme,
    onError: (error) => {
      // TUI 运行中：错误已经通过状态栏呈现，再写 stderr 会把 alt-screen 画面写花。
      // 只有启动阶段（画面还没接管）才直接打 stderr。
      if (!tuiRunning) process.stderr.write(`ink: ${String(error)}\n`);
    },
  });

  let tuiRunning = false;

  const cleanup = () => {
    tuiRunning = false;
    try {
      shell.stop();
    } catch {
      // 退出路径上忽略清理异常
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  tuiRunning = true;
  shell.start();
}

if (!process.env.VITEST) {
  main();
}
