/**
 * Inkpoint TUI 编辑器入口（脚手架阶段：仅解析参数，后续任务接入全屏编辑器）
 */
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
    ].join("\n"),
  );
  process.exit(0);
}
