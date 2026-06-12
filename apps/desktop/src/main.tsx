import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  createDocumentState,
  createEditorRuntime,
  switchEditorModeSafely,
  type DocumentSnapshot,
  type EditorMode
} from "@md-editor/editor-core";
import {
  appendImageMarkdown,
  createFileService,
  type FileServiceAdapter,
  type MarkdownDocumentFile,
  type SaveMarkdownInput
} from "@md-editor/file-system";
import { extractHeadingOutline, type HeadingOutlineItem } from "@md-editor/markdown-fidelity";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-registry";
import "./styles.css";

const runtime = createEditorRuntime({
  document: createDocumentState({
    markdown: "# Untitled\n\nStart writing Markdown."
  }),
  mdxComponents: createBuiltInMdxRegistry()
});
const fileService = createFileService(createDesktopFileAdapter());

// 顶部 chrome 统一用 Tailwind utility，主题色仍来自 CSS variables。
const toolbarButtonClass =
  "min-h-7 rounded-md border border-transparent px-2.5 text-[13px] text-[var(--theme-text)] hover:border-[var(--theme-border)] hover:bg-[var(--theme-bg-muted)] disabled:cursor-default disabled:text-[#9a9a9a]";
const toolbarButtonActiveClass =
  "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)]";
const modeButtonClass =
  "min-h-6 rounded border-0 px-2 text-[13px] text-[var(--theme-muted)] hover:bg-[var(--theme-primary-soft)]";
const modeButtonActiveClass = "bg-[var(--theme-surface)] text-[var(--theme-title)]";

interface PastedImageInput {
  readonly file: File;
  readonly mimeType: string;
}

interface PastedImageFile {
  readonly markdownPath: string;
}

interface SourceEditorView {
  readonly state: {
    readonly doc: {
      readonly lines: number;
      line(lineNumber: number): { readonly from: number };
    };
  };
  readonly dom: HTMLElement;
  dispatch(transaction: { readonly selection?: { readonly anchor: number } }): void;
  focus(): void;
}

function App() {
  // 初始桌面壳先绑定 EditorRuntime，后续接入 Milkdown / CodeMirror 时
  // App 层仍然通过同一份运行时契约读写文档。
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTargetLine, setTocTargetLine] = useState<number | null>(null);
  const tocItems = useMemo(() => extractHeadingOutline(snapshot.markdown), [snapshot.markdown]);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${snapshot.savedMarkdown}`;

  const commitMarkdown = useCallback((markdown: string) => {
    setErrorMessage(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
  }, []);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const result = await switchEditorModeSafely(runtime.document, mode);
    setSnapshot(result.snapshot);
    setErrorMessage(result.ok ? null : result.message);
  }, []);

  const replaceDocument = useCallback((document: MarkdownDocumentFile | null) => {
    if (!document) {
      return;
    }

    runtime.document.updateMarkdown(document.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: document.markdown,
        filePath: document.filePath
      })
    );
    setErrorMessage(null);
  }, []);

  const ensureDiscardAllowed = useCallback(() => {
    return (
      !runtime.document.getSnapshot().isDirty ||
      window.confirm("Current document has unsaved changes. Continue?")
    );
  }, []);

  const runFileAction = useCallback(async (label: string, action: () => Promise<void> | void) => {
    setPendingAction(label);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "File operation failed.");
    } finally {
      setPendingAction(null);
    }
  }, []);

  const createNewDocument = useCallback(() => {
    if (!ensureDiscardAllowed()) {
      return;
    }

    const nextDocument = fileService.newDocument();
    runtime.document.updateMarkdown(nextDocument.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: nextDocument.markdown,
        filePath: nextDocument.filePath
      })
    );
    setErrorMessage(null);
  }, [ensureDiscardAllowed]);

  const openDocument = useCallback(async () => {
    if (!ensureDiscardAllowed()) {
      return;
    }

    await runFileAction("正在打开", async () => {
      replaceDocument(await fileService.openDocument());
    });
  }, [ensureDiscardAllowed, replaceDocument, runFileAction]);

  const saveDocument = useCallback(
    async (forceDialog = false) => {
      await runFileAction(forceDialog ? "正在另存为" : "正在保存", async () => {
        const current = runtime.document.getSnapshot();
        const saved = forceDialog
          ? await fileService.saveDocumentAs({
              filePath: current.filePath,
              markdown: current.markdown
            })
          : await fileService.saveDocument({
              filePath: current.filePath,
              markdown: current.markdown
            });

        if (saved) {
          // 只有原生端确认写盘成功后才清 dirty；取消或失败都必须保留未保存状态。
          replaceDocument(saved);
        }
      });
    },
    [replaceDocument, runFileAction]
  );

  const pasteImage = useCallback(
    async (event: React.ClipboardEvent) => {
      const image = getPastedImage(event.clipboardData);
      if (!image) {
        return;
      }

      event.preventDefault();
      await runFileAction("正在粘贴图片", async () => {
        let current = runtime.document.getSnapshot();

        if (!current.filePath) {
          const saved = await fileService.saveDocumentAs({
            filePath: null,
            markdown: current.markdown
          });
          if (!saved) {
            return;
          }
          replaceDocument(saved);
          current = runtime.document.getSnapshot();
        }

        if (!current.filePath) {
          throw new Error("Save the document before pasting images.");
        }

        const pasted = await savePastedImage(current.filePath, image);
        const nextMarkdown = appendImageMarkdown(current.markdown, pasted.markdownPath);

        // 图片文件已写入 assets，但 Markdown 插入仍是文档编辑，保持 dirty 等待用户保存。
        setSnapshot(runtime.document.updateMarkdown(nextMarkdown));
      });
    },
    [replaceDocument, runFileAction]
  );

  const jumpToTocLine = useCallback(
    async (line: number) => {
      // 目录跳转仍复用 Markdown 标题解析；v0.1 先切到源码模式定位行号。
      setTocTargetLine(line);
      await switchMode("source");
    },
    [switchMode]
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [saveDocument]);

  return (
    <main className="flex h-full min-w-0 flex-col bg-[var(--theme-bg)] md:min-w-[640px]">
      <header className="grid min-h-12 grid-cols-1 items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 md:grid-cols-[minmax(160px,1fr)_auto_minmax(180px,1fr)] md:gap-4 md:px-[18px] md:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-bold text-[var(--theme-title)]">Markdown</span>
          <span
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[var(--theme-muted)]"
            title={snapshot.filePath ?? "Untitled.md"}
          >
            {getDisplayFileName(snapshot.filePath)}
          </span>
        </div>
        <nav
          className="flex min-w-0 justify-start gap-0.5 overflow-x-auto md:justify-center"
          aria-label="文档操作"
        >
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={createNewDocument}
            disabled={Boolean(pendingAction)}
          >
            新建
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={openDocument}
            disabled={Boolean(pendingAction)}
          >
            打开
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => void saveDocument(false)}
            disabled={Boolean(pendingAction) || !snapshot.isDirty}
          >
            保存
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => void saveDocument(true)}
            disabled={Boolean(pendingAction)}
          >
            另存为
          </button>
          <TocMenu items={tocItems} onJump={jumpToTocLine} />
        </nav>
        <div className="flex min-w-0 items-center justify-between gap-3 md:justify-end">
          <ModeToggle mode={snapshot.mode} onChange={switchMode} />
          <span
            className={
              snapshot.isDirty
                ? "min-w-[52px] whitespace-nowrap text-right text-[13px] text-[var(--theme-primary)]"
                : "min-w-[52px] whitespace-nowrap text-right text-[13px] text-[var(--theme-muted)]"
            }
          >
            {pendingAction ?? (snapshot.isDirty ? "未保存" : "已保存")}
          </span>
        </div>
      </header>
      <section className="editor-pane" aria-label="Markdown 编辑器" onPasteCapture={pasteImage}>
        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {snapshot.mode === "source" ? (
          <SourceEditor
            snapshot={snapshot}
            targetLine={tocTargetLine}
            onChange={commitMarkdown}
          />
        ) : (
          <MilkdownEditor key={documentKey} snapshot={snapshot} onChange={commitMarkdown} />
        )}
      </section>
    </main>
  );
}

interface TocMenuProps {
  readonly items: readonly HeadingOutlineItem[];
  readonly onJump: (line: number) => void;
}

function TocMenu({ items, onJump }: TocMenuProps) {
  return (
    <Popover className="relative">
      {({ open, close }) => (
        <>
          <PopoverButton
            type="button"
            className={`${toolbarButtonClass} ${open ? toolbarButtonActiveClass : ""}`}
          >
            目录
          </PopoverButton>
          <PopoverPanel className="absolute top-[calc(100%+8px)] left-0 z-20 max-h-[min(460px,calc(100vh-88px))] w-[min(320px,calc(100vw-32px))] overflow-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2 shadow-[var(--theme-shadow)] md:left-1/2 md:-translate-x-1/2">
            {items.length > 0 ? (
              <ol className="grid list-none gap-0.5 p-0">
                {items.map((item) => (
                  <li
                    key={`${item.id}:${item.line}`}
                    className="min-w-0"
                    style={{ paddingLeft: (item.level - 1) * 14 }}
                  >
                    <button
                      type="button"
                      className="min-h-7 w-full rounded border-0 px-2.5 text-left text-[13px] text-[var(--theme-muted)] hover:bg-[var(--theme-primary-soft)] hover:text-[var(--theme-primary)]"
                      onClick={() => {
                        close();
                        onJump(item.line);
                      }}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-2 text-[13px] text-[var(--theme-muted)]">暂无标题</p>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}

interface EditorProps {
  readonly snapshot: DocumentSnapshot;
  readonly onChange: (markdown: string) => void;
}

interface SourceEditorProps extends EditorProps {
  readonly targetLine: number | null;
}

function SourceEditor({ snapshot, targetLine, onChange }: SourceEditorProps) {
  const editorView = useRef<SourceEditorView | null>(null);
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage })],
    []
  );

  useEffect(() => {
    if (targetLine === null || !editorView.current) {
      return;
    }

    const view = editorView.current;
    const safeLine = Math.min(Math.max(targetLine, 1), view.state.doc.lines);
    const position = view.state.doc.line(safeLine).from;
    view.dispatch({ selection: { anchor: position } });
    view.focus();
    requestAnimationFrame(() => {
      view.dom.querySelector(".cm-activeLine")?.scrollIntoView({ block: "center" });
    });
  }, [snapshot.markdown, targetLine]);

  return (
    <CodeMirror
      value={snapshot.markdown}
      height="100%"
      basicSetup={{ lineNumbers: true, foldGutter: true }}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        editorView.current = view;
      }}
      className="source-editor"
    />
  );
}

function MilkdownEditor(props: EditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownEditorInner({ snapshot, onChange }: EditorProps) {
  const initialMarkdown = useMemo(() => snapshot.markdown, []);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
          // Milkdown 是 v0.1 的 WYSIWYG 事实入口；每次序列化后的 Markdown
          // 都同步回 DocumentState，保证源码模式切换时不读取过期内容。
          ctx.get(listenerCtx).markdownUpdated((_, markdown, previousMarkdown) => {
            if (markdown !== previousMarkdown) {
              onChange(markdown);
            }
          });
        })
        .use(commonmark)
        .use(history)
        .use(listener),
    [initialMarkdown, onChange]
  );

  return <Milkdown />;
}

interface ModeToggleProps {
  readonly mode: EditorMode;
  readonly onChange: (mode: EditorMode) => void;
}

function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      className="inline-grid w-28 grid-cols-2 gap-0.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-muted)] p-0.5"
      aria-label="编辑模式"
    >
      <button
        type="button"
        className={`${modeButtonClass} ${mode === "wysiwyg" ? modeButtonActiveClass : ""}`}
        aria-pressed={mode === "wysiwyg"}
        onClick={() => onChange("wysiwyg")}
      >
        编辑
      </button>
      <button
        type="button"
        className={`${modeButtonClass} ${mode === "source" ? modeButtonActiveClass : ""}`}
        aria-pressed={mode === "source"}
        onClick={() => onChange("source")}
      >
        源码
      </button>
    </div>
  );
}

function getDisplayFileName(filePath: string | null): string {
  if (!filePath) {
    return "Untitled.md";
  }

  return filePath.split(/[\\/]/).pop() || filePath;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function createDesktopFileAdapter(): FileServiceAdapter {
  return {
    openMarkdownFile() {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("open_markdown_document");
    },
    saveMarkdownFile(input: SaveMarkdownInput) {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("save_markdown_document", {
        filePath: input.filePath,
        markdown: input.markdown,
        forceDialog: input.forceDialog ?? false
      });
    }
  };
}

function assertDesktopRuntime() {
  if (!isTauri()) {
    throw new Error("File operations are available in the Tauri desktop app.");
  }
}

function getPastedImage(data: DataTransfer): PastedImageInput | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        return {
          file,
          mimeType: item.type || file.type
        };
      }
    }
  }

  return null;
}

async function savePastedImage(
  documentPath: string,
  image: PastedImageInput
): Promise<PastedImageFile> {
  assertDesktopRuntime();
  return invoke<PastedImageFile>("save_pasted_image", {
    documentPath,
    mimeType: image.mimeType,
    bytes: Array.from(new Uint8Array(await image.file.arrayBuffer()))
  });
}
