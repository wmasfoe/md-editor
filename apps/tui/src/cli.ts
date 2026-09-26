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

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "inkpoint-tui - vim 式终端 Markdown 编辑器",
      "",
      "用法:",
      "  inkpoint-tui <file.md>   打开或新建文档",
      "  inkpoint-tui --help      显示帮助",
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
  process.stderr.write("inkpoint-tui 需要在交互式终端中运行（stdout/stdin 必须为 TTY）\n");
  process.exit(1);
}

const filePath = args[0] ?? null;
const shell = createFullscreenShell({
  filePath,
  initialText: loadDocumentText(filePath),
  onError: (error) => {
    process.stderr.write(`inkpoint-tui: ${String(error)}\n`);
  },
});

const cleanup = () => {
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

shell.start();
