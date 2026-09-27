/**
 * 全屏壳子（vim 形态）：alt-screen + ScrollView(编辑器) + 状态栏。
 *
 * 编辑器组件本身不知道自己在全屏壳子里 —— 这里只是给它套一层 ScrollView，
 * 并把光标滚动、保存落盘、退出收尾这些「壳子职责」接上。
 * 换成聊天框/任意 Container 时这些职责由另一个壳子承担，编辑器不用改。
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  type Terminal,
} from "@earendil-works/pi-tui";
import { MdEditor } from "../editor/md-editor.ts";
import { StatusBar } from "./statusbar.ts";
import {
  colorSchemeFromRgb,
  detectEnvironmentColorScheme,
  getThemeByColorScheme,
  type TerminalColorScheme,
  type TerminalTheme,
} from "../render/theme.ts";

export interface FullscreenShellOptions {
  filePath?: string | null;
  initialText?: string;
  /** 注入终端（测试用假终端；默认取 stdout） */
  terminal?: Terminal;
  theme?: TerminalTheme;
  /** 配色模式：'dark' | 'light' | 'auto'，未指定时默认按终端/系统环境探测 */
  colorScheme?: "dark" | "light" | "auto";
  /** 保存失败时是否抛出（默认写入状态栏提示） */
  onError?: (error: unknown) => void;
}

export interface FullscreenShell {
  tui: TuiAltScreen;
  editor: MdEditor;
  scrollView: ScrollView;
  statusBar: StatusBar;
  /** 当前生效的配色方案 */
  readonly colorScheme: TerminalColorScheme;
  /** 动态切换配色方案 */
  setColorScheme(scheme: TerminalColorScheme): void;
  /** 动态切换主题对象 */
  setTheme(theme: TerminalTheme): void;
  /** 启动终端渲染循环 */
  start(): void;
  /** 停止渲染并把最终内容交回主屏 */
  stop(): void;
  /** 让视口跟随光标（可显式传入视口高度；不传则用布局测量值） */
  followCursor(viewportHeight?: number): void;
}

/** 光标驱动滚动的纯逻辑：返回让光标保持可见的视口顶行（vim 的 scrolloff=0 行为） */
export function nextScrollTop(
  currentTop: number,
  viewportHeight: number,
  cursorLine: number,
): number {
  if (viewportHeight <= 0) return currentTop;
  if (cursorLine < currentTop) return cursorLine;
  if (cursorLine >= currentTop + viewportHeight) return cursorLine - viewportHeight + 1;
  return currentTop;
}

export function createFullscreenShell(options: FullscreenShellOptions = {}): FullscreenShell {
  const terminal = options.terminal ?? new ProcessTerminal();
  // 第二个参数 true：显示硬件光标 —— IME 候选窗要靠它定位
  const tui = new TuiAltScreen(terminal, true);
  let quitRequested = false;

  const initialScheme: TerminalColorScheme =
    options.colorScheme === "light" || options.colorScheme === "dark"
      ? options.colorScheme
      : detectEnvironmentColorScheme();

  let activeScheme: TerminalColorScheme = initialScheme;
  const initialTheme: TerminalTheme = options.theme ?? getThemeByColorScheme(initialScheme);

  const editor = new MdEditor({
    initialText: options.initialText ?? "",
    filePath: options.filePath ?? null,
    theme: initialTheme,
    onSave: (text, filePath): boolean => saveDocument(text, filePath, editor, options),
    onQuit: () => {
      quitRequested = true;
      stop();
    },
  });

  const scrollView = new ScrollView(editor, { primary: true, follow: "none", scrollbar: "auto" });
  const statusBar = new StatusBar(editor, initialTheme);
  // 布局要点（pi-tui README「Alternate-screen viewport layouts」）：
  // - ScrollView 必须给 basis: 0：否则它的初始尺寸取「内容高度」（整篇文档），
  //   总高超出屏幕后按比例 shrink，会把状态栏挤成 0 行 → 状态栏永远看不见。
  // - 状态栏用 basis: "auto" + minSize: 1，保证至少留一行。
  const layout = new VStack([
    { component: scrollView, basis: 0, grow: 1, minSize: 1 },
    { component: statusBar, basis: "auto", shrink: 1, minSize: 1 },
  ]);

  /** 让视口跟随光标；viewportHeight 可显式传入（测试/嵌入壳子已知高度时） */
  const followCursor = (viewportHeight = scrollView.viewportHeight): void => {
    const next = nextScrollTop(scrollView.scrollTop, viewportHeight, editor.doc.position.line);
    if (next !== scrollView.scrollTop) scrollView.scrollTo(next);
  };
  // 编辑器与 ScrollView 都就绪后再接上滚动跟随（编辑器的 onChange 在构造期先留空）
  editor.setChangeListener(() => followCursor());

  tui.setLayoutRoot(layout);
  tui.setFocus(editor);

  function setColorScheme(scheme: TerminalColorScheme): void {
    if (activeScheme === scheme) return;
    activeScheme = scheme;
    const nextTheme = getThemeByColorScheme(scheme);
    editor.setTheme(nextTheme);
    statusBar.setTheme(nextTheme);
    tui.requestRender();
  }

  function setTheme(theme: TerminalTheme): void {
    editor.setTheme(theme);
    statusBar.setTheme(theme);
    tui.requestRender();
  }

  function start(): void {
    tui.start();

    // 仅在未显式锁定 theme 且允许 auto 时，向终端开启通知并异步探测背景
    if (!options.theme && options.colorScheme !== "dark" && options.colorScheme !== "light") {
      tui.setTerminalColorSchemeNotifications(true);
      tui.onTerminalColorSchemeChange((scheme) => {
        setColorScheme(scheme);
      });

      void Promise.allSettled([
        tui.queryTerminalColorScheme({ timeoutMs: 250 }),
        tui.queryTerminalBackgroundColor({ timeoutMs: 250 }),
      ]).then(([schemeResult, bgResult]) => {
        if (quitRequested) return;
        if (schemeResult.status === "fulfilled" && schemeResult.value) {
          setColorScheme(schemeResult.value);
        } else if (bgResult.status === "fulfilled" && bgResult.value) {
          setColorScheme(colorSchemeFromRgb(bgResult.value));
        }
      });
    }
  }

  function stop(): void {
    try {
      tui.stop();
    } catch (error) {
      options.onError?.(error);
    }
    if (quitRequested) return;
  }

  return {
    tui,
    editor,
    scrollView,
    statusBar,
    get colorScheme() {
      return activeScheme;
    },
    setColorScheme,
    setTheme,
    start,
    stop,
    followCursor,
  };
}

function saveDocument(
  text: string,
  filePath: string | null,
  editor: MdEditor,
  options: FullscreenShellOptions,
): boolean {
  const target = filePath ?? "untitled.md";
  try {
    writeFileSync(target, text, "utf8");
    if (filePath === null) {
      editor.setFilePath(target);
      editor.setStatus(`未命名文档已保存为 ${target}（用 :e 改名待后续版本支持）`);
    }
    return true;
  } catch (error) {
    // 失败路径：错误消息进状态栏；返回 false 让编辑器保留脏标记、不报「已保存」
    editor.setStatus(`保存失败: ${String(error)}`);
    options.onError?.(error);
    return false;
  }
}

/** 读取待编辑文件（不存在则视为新建，返回空内容） */
export function loadDocumentText(filePath: string | null): string {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
