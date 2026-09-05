// apps/utools/src/components/UtoolsApp.tsx
// uTools 插件主应用容器
// 100% 收敛在 apps/utools，复用 @md-editor/editor-core 与 @md-editor/editor-ui 核心

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createDocumentState, type DocumentState } from "@md-editor/editor-core";
import { CodeMirrorEditor, EditorUiProvider } from "@md-editor/editor-ui";
import { loadScratchpadFromDb, saveScratchpadToDb } from "../utools/db-storage";
import { registerUtoolsLifecycle, type PluginEnterDetail } from "../utools/lifecycle";
import type { EditorMode } from "../utools/types";
import { CompactHeader } from "./CompactHeader";
import { ReferralBanner } from "./ReferralBanner";
import { DisclaimerModal } from "./DisclaimerModal";

function syncUtoolsTheme(): void {
  if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
    if (window.utools.isDarkColors()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}

export function UtoolsApp() {
  const [mode, setMode] = useState<EditorMode>("scratchpad");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);

  // 初始化持久化文档模型
  const initialMarkdown = useMemo(() => loadScratchpadFromDb(), []);
  const docState: DocumentState = useMemo(() => {
    return createDocumentState({
      markdown: initialMarkdown,
      filePath: null,
      mode: "wysiwyg",
    });
  }, [initialMarkdown]);

  const subscribeSnapshot = useCallback(
    (onStoreChange: () => void) => docState.subscribeSnapshot(onStoreChange),
    [docState],
  );
  const getSnapshot = useCallback(() => docState.getSnapshot(), [docState]);
  const snapshot = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const showToast = useCallback((msg: string | null) => {
    setToastMessage(msg);
    if (msg) {
      setTimeout(() => setToastMessage(null), 2400);
    }
  }, []);

  // 同步 uTools 主题设置
  useEffect(() => {
    syncUtoolsTheme();
  }, []);

  // 快捷键监听 (Cmd+S / Ctrl+S 立即主动写盘)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const current = snapshotRef.current;
        if (modeRef.current === "scratchpad") {
          saveScratchpadToDb(current.markdown);
          showToast("草稿已保存");
        } else if (modeRef.current === "file" && current.filePath && window.inkpointNodeBridge) {
          try {
            window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
            showToast("文件已保存");
          } catch (err) {
            showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showToast]);

  // 1. 自动防抖保存逻辑
  useEffect(() => {
    const currentMode = modeRef.current;
    const currentSnapshot = snapshotRef.current;

    const timer = setTimeout(() => {
      if (currentMode === "scratchpad") {
        saveScratchpadToDb(currentSnapshot.markdown);
      } else if (currentMode === "file" && currentSnapshot.filePath) {
        if (typeof window !== "undefined" && window.inkpointNodeBridge) {
          try {
            window.inkpointNodeBridge.writeFile(currentSnapshot.filePath, currentSnapshot.markdown);
          } catch (err) {
            console.error("保存文件失败:", err);
          }
        }
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [snapshot.markdown]);

  // 2. 注册 uTools 生命周期监听
  useEffect(() => {
    const handleEnter = (detail: PluginEnterDetail) => {
      syncUtoolsTheme();

      // 场景 A: 匹配文件 (打开本地 Markdown)
      if (detail.code === "open-file" || detail.type === "file") {
        const fileList = detail.payload;
        if (Array.isArray(fileList) && fileList.length > 0) {
          const targetFile = fileList[0];
          const targetPath = typeof targetFile === "string" ? targetFile : targetFile.path;
          if (targetPath && window.inkpointNodeBridge) {
            try {
              const content = window.inkpointNodeBridge.readFile(targetPath);
              docState.replaceDocument(
                {
                  markdown: content,
                  savedMarkdown: content,
                  filePath: targetPath,
                  mode: "wysiwyg",
                },
                { kind: "command", commandId: "utools.openFile" },
              );
              setMode("file");
              showToast(`已打开文件: ${targetPath.split(/[/\\]/).pop()}`);
              return;
            } catch (err) {
              console.error("打开本地文件异常:", err);
            }
          }
        }
      }

      // 场景 B: 划词进入 (超级面板匹配任意文本)
      if (detail.code === "selection-edit" || detail.type === "over") {
        const text = typeof detail.payload === "string" ? detail.payload : "";
        if (text) {
          docState.replaceDocument(
            {
              markdown: text,
              filePath: null,
              mode: "wysiwyg",
            },
            { kind: "command", commandId: "utools.selectionEdit" },
          );
          setMode("selection");
          showToast("已导入选中文字");
          return;
        }
      }

      // 场景 C: 默认便签
      const noteContent = loadScratchpadFromDb();
      docState.replaceDocument(
        {
          markdown: noteContent,
          filePath: null,
          mode: "wysiwyg",
        },
        { kind: "command", commandId: "utools.openScratchpad" },
      );
      setMode("scratchpad");
    };

    const handleOut = () => {
      // 插件退出到后台前，强制刷盘
      const current = snapshotRef.current;
      if (modeRef.current === "scratchpad") {
        saveScratchpadToDb(current.markdown);
      } else if (modeRef.current === "file" && current.filePath) {
        if (typeof window !== "undefined" && window.inkpointNodeBridge) {
          window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
        }
      }
    };

    const cleanup = registerUtoolsLifecycle({
      onEnter: handleEnter,
      onOut: handleOut,
    });

    return cleanup;
  }, [docState, showToast]);

  // 3. 用户切换至便签模式
  const handleSwitchToScratchpad = useCallback(() => {
    // 切换前若当前是文件，先写盘
    if (mode === "file" && snapshot.filePath && window.inkpointNodeBridge) {
      window.inkpointNodeBridge.writeFile(snapshot.filePath, snapshot.markdown);
    }
    const note = loadScratchpadFromDb();
    docState.replaceDocument(
      {
        markdown: note,
        filePath: null,
        mode: "wysiwyg",
      },
      { kind: "command", commandId: "utools.switchScratchpad" },
    );
    setMode("scratchpad");
    showToast("已切换到草稿文档");
  }, [docState, mode, showToast, snapshot.filePath, snapshot.markdown]);

  // 4. 用户点击打开本地文件
  const handleOpenFile = useCallback(() => {
    if (typeof window === "undefined" || typeof window.utools === "undefined") {
      showToast("当前环境不支持文件选择器");
      return;
    }
    const paths = window.utools.showOpenDialog({
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
      properties: ["openFile"],
    });
    if (!paths || paths.length === 0) {
      return;
    }
    const targetPath = paths[0];
    if (window.inkpointNodeBridge) {
      try {
        const content = window.inkpointNodeBridge.readFile(targetPath);
        docState.replaceDocument(
          {
            markdown: content,
            savedMarkdown: content,
            filePath: targetPath,
            mode: "wysiwyg",
          },
          { kind: "command", commandId: "utools.openFilePicker" },
        );
        setMode("file");
        showToast(`已加载本地文件`);
      } catch (err) {
        showToast(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [docState, showToast]);

  // 5. 贴回原应用
  const handlePasteBackToApp = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
      window.utools.hideMainWindowPasteText(snapshot.markdown);
    }
  }, [snapshot.markdown]);

  // 6. 复制全文
  const handleCopyAll = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(snapshot.markdown);
      showToast("已复制全文 Markdown 到剪贴板");
    }
  }, [showToast, snapshot.markdown]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--theme-bg)] text-[var(--theme-text)]">
      {/* 顶部导流横幅 */}
      <ReferralBanner />

      {/* 紧凑操作栏 */}
      <CompactHeader
        mode={mode}
        filePath={snapshot.filePath}
        onSwitchToScratchpad={handleSwitchToScratchpad}
        onOpenFile={handleOpenFile}
        onPasteBackToApp={handlePasteBackToApp}
        onCopyAll={handleCopyAll}
      />

      {/* 编辑器核心区域 */}
      <main className="flex-1 min-h-0 overflow-hidden relative">
        <EditorUiProvider markdown={snapshot.markdown} showToast={showToast}>
          <CodeMirrorEditor
            document={docState}
            codeBlockLineNumbers={false}
            fontSize={15}
            className="h-full w-full overflow-auto"
            ariaLabel="Inkpoint Markdown 编辑器"
          />
        </EditorUiProvider>
      </main>

      {/* 底部微型状态栏与桌面端卖点提示 */}
      <footer className="px-3 py-1 bg-[var(--theme-surface)] border-t border-[var(--theme-border)] text-xs text-[var(--theme-muted)] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span>{mode === "scratchpad" ? "草稿云同步" : "本地文件已连接"}</span>
          <span>{snapshot.markdown.length} 字符</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--theme-muted)]">
            原生桌面版专享：完全离线本地小模型、多窗口、目录树
          </span>
        </div>
      </footer>

      {/* 轻量 Toast 提示 */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-[var(--theme-title)] text-[var(--theme-surface)] text-xs shadow-md pointer-events-none transition-all"
        >
          {toastMessage}
        </div>
      )}

      {/* AI 安全与免责声明弹窗 */}
      <DisclaimerModal
        isOpen={isDisclaimerOpen}
        onAccept={() => setIsDisclaimerOpen(false)}
        onClose={() => setIsDisclaimerOpen(false)}
      />
    </div>
  );
}
