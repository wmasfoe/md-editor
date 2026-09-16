import React, { useState, useEffect } from "react";
import { ReaderCanvas } from "./components/ReaderCanvas.tsx";
import { EditorCanvas } from "./components/EditorCanvas.tsx";
import {
  bridge,
  type LoadDocumentPayload,
  type SetModePayload,
  type SetThemePayload,
} from "./bridge/index.ts";

const INITIAL_DEMO_MARKDOWN = `# 欢迎使用 Inkpoint 移动端 📱

> 极简、本地优先、所见即所得。秉承**「即览 (Jilan) + 即改」**设计哲学。

Inkpoint 提供了极致细腻的排版：支持**粗体文本**、*优雅斜体*、~~删除划线~~、==文本高亮强调== 以及 \`inline_code()\` 行内代码。

---

### 💡 核心特性与效率技巧

> [!NOTE]
> 默认以**沉浸阅读模式**秒级打开文档，零光标遮挡；双击任意段落或点击右下角浮动按钮即可就地激活 CodeMirror 6 极速编辑。

::: tip 极客效率指南
- **双击正文**：直接在双击位置激活就地光标与全键盘编辑
- **键盘附着工具栏**：支持一键加粗、插入代码块、生成列表与撤销重做
- **大纲悬浮导航**：点击右上角目录即可快速跳转长篇章节
:::

::: warning 本地优先隐私承诺
移动端贯彻 **Local-First** 纯离线原则，所有修改直接就地持久化在设备文件系统中，不依赖外部服务器，完全保障数据私密性。
:::

---

### 📐 LaTeX 科学数学公式

行内公式如质能方程 $E = mc^2$，欧拉恒等式 $e^{i\\pi} + 1 = 0$。

块级数学公式支持复杂微积分与求和：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}, \\quad \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

---

### 💻 多语言代码高亮

\`\`\`typescript
// Type-Safe JSBridge 离线通信架构
export interface InkpointBridge {
  execCommand(command: "bold" | "italic" | "h1" | "code"): void;
  notifyOutline(items: OutlineItem[]): void;
}
\`\`\`

\`\`\`swift
// iOS 原生键盘附着工具栏交互
@Observable
final class DocumentModel {
    var markdown: String = ""
    var isDirty: Bool = false
    
    func save() {
        // 就地持久化到沙盒文件
    }
}
\`\`\`

\`\`\`rust
// Tauri 原生极速离线内核
fn render_markdown_securely(raw: &str) -> Result<String, String> {
    println!("Inkpoint local-first engine active.");
    Ok(raw.to_string())
}
\`\`\`

---

### 📊 Mermaid 交互式流程图

\`\`\`mermaid
graph TD
  A[📄 本地 Markdown] --> B(⚡️ 沉浸即览)
  B -->|双击就地激发| C{📝 CM6 编辑}
  C -->|键盘工具栏操作| D[✨ 实时所见即所得]
  D -->|自动无感保存| E[💾 本地文件存储]
\`\`\`

---

### 📋 结构化数据与任务清单

| 平台模块 | 技术栈 | 启动耗时 | 渲染引擎 |
| :--- | :--- | :--- | :--- |
| **iOS App** | SwiftUI 6 + WKWebView | < 80ms | CodeMirror 6 |
| **Android App** | Jetpack Compose + WebView | < 90ms | CodeMirror 6 |
| **Desktop 端** | Tauri 2.0 + Rust + React | < 120ms | CodeMirror 6 |

- [x] CodeMirror 6 移动端极速自绘选区
- [x] 官方插件全面接入（高亮、容器指令、KaTeX、Mermaid）
- [x] 原生键盘附着工具栏与弹簧手感触控反馈
- [ ] 跨端本地局域网点对点实时协作
`;

export const App: React.FC = () => {
  const [content, setContent] = useState<string>(INITIAL_DEMO_MARKDOWN);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [isDark, setIsDark] = useState<boolean>(false);
  const [filePath, setFilePath] = useState<string | undefined>();

  // 1. 初始化并注册原生 Action 监听
  useEffect(() => {
    // 监听原生载入文档指令
    const cleanupLoad = bridge.onAction<LoadDocumentPayload>("loadDocument", (payload) => {
      const newContent = payload.content ?? payload.markdown;
      if (typeof newContent === "string") {
        setContent(newContent);
      }
      setFilePath(payload.path);
      const targetMode = payload.initialMode ?? payload.mode;
      if (targetMode) {
        setMode(targetMode);
      }
    });

    // 监听原生模式切换指令
    const cleanupSetMode = bridge.onAction<SetModePayload>("setMode", (payload) => {
      setMode(payload.mode);
    });

    // 监听原生主题切换指令
    const cleanupSetTheme = bridge.onAction<SetThemePayload>("setTheme", (payload) => {
      setIsDark(payload.isDark);
      if (payload.isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    });

    // 监听原生大纲跳转指令
    const cleanupScrollToHeading = bridge.onAction<{ headingId: string }>(
      "scrollToHeading",
      ({ headingId }) => {
        if (!headingId) return;
        const target =
          document.getElementById(headingId) ||
          Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).find(
            (el) =>
              el.id === headingId ||
              el.getAttribute("data-heading-text")?.toLowerCase() === headingId.toLowerCase() ||
              el.textContent?.trim().toLowerCase() === headingId.toLowerCase(),
          );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
    );

    // 通知原生端：前端已完全就绪
    bridge.notifyReady();

    return () => {
      cleanupLoad();
      cleanupSetMode();
      cleanupSetTheme();
      cleanupScrollToHeading();
    };
  }, []);

  return (
    <div className={`app-root min-h-screen w-full transition-colors ${isDark ? "dark" : ""}`}>
      {/* 顶部轻量浮动条：仅在编辑模式下显示“完成”返回阅读态 */}
      {mode === "edit" && (
        <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-neutral-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-950/90">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {filePath ? filePath.split("/").pop() : "编辑中"}
          </span>
          <button
            onClick={() => {
              bridge.triggerHaptic("selection");
              setMode("read");
            }}
            className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition-all"
          >
            完成
          </button>
        </header>
      )}

      {/* 主画布区域：双态就地无缝流转 */}
      <main className="w-full">
        {mode === "read" ? (
          <ReaderCanvas content={content} onEnterEdit={() => setMode("edit")} isDark={isDark} />
        ) : (
          <EditorCanvas initialContent={content} onContentChange={setContent} />
        )}
      </main>

      {/* 悬浮在右下角的一键进入编辑态浮动按钮 (FAB) */}
      {mode === "read" && (
        <button
          onClick={() => {
            bridge.triggerHaptic("impactLight");
            setMode("edit");
          }}
          aria-label="编辑文档"
          className="fixed right-5 bottom-6 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-90 transition-transform cursor-pointer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
