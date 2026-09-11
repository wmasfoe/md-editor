/**
 * @fileoverview 桌面端应用设置与偏好配置入口 (App Settings Facade)
 *
 * 本文件作为向下兼容的门面层（Facade），重新导出拆分后的各个高内聚子域：
 * - `shortcuts/`: 键盘快捷键定义、跨平台修饰键规范化与事件捕获
 * - `theme/`: 明暗主题偏好、自定义 CSS 与多窗口实时预览协调器
 * - `updates/`: GitHub Release 在线更新检测、版本比较与安装脚本生成
 * - `editor/`: 编辑器排版字号、正文/等宽代码字体族栈与语法插件开关
 * - `persistence/`: 全局配置存储持久化 (Tauri IPC / LocalStorage) 与跨窗口通知
 */

export type { LanguageSetting } from "@md-editor/i18n";
export {
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
  normalizeAiSettings,
} from "@md-editor/ai";

export * from "./shortcuts/index.ts";
export * from "./theme/index.ts";
export * from "./updates/index.ts";
export * from "./editor/index.ts";
export * from "./persistence/index.ts";
