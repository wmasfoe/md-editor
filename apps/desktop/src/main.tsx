import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import { extractHeadingOutline } from "@md-editor/markdown-fidelity";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-registry";
import "./styles.css";

const runtime = createEditorRuntime({
  document: createDocumentState({
    markdown: "# Untitled\n\nStart writing Markdown."
  }),
  mdxComponents: createBuiltInMdxRegistry()
});
const fileService = createFileService(createDesktopFileAdapter());
const MENU_ACTION_EVENT = "md-editor-menu-action";

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

interface KeyboardShortcut {
  readonly matches: (event: KeyboardEvent) => boolean;
  readonly run: (event: KeyboardEvent) => void;
}

function App() {
  // 初始桌面壳先绑定 EditorRuntime，后续接入 Milkdown / CodeMirror 时
  // App 层仍然通过同一份运行时契约读写文档。
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTargetLine, setTocTargetLine] = useState<number | null>(null);
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

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

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

  const jumpToFirstHeading = useCallback(async () => {
    const [firstHeading] = extractHeadingOutline(runtime.document.getSnapshot().markdown);
    if (!firstHeading) {
      setErrorMessage("当前文档没有标题。");
      return;
    }
    await jumpToTocLine(firstHeading.line);
  }, [jumpToTocLine]);

  useEffect(() => {
    // 集中维护快捷键，后续新增时保持键盘和菜单动作一致。
    const shortcuts: readonly KeyboardShortcut[] = [
      {
        matches: (event) =>
          isPrimaryShortcut(event) && event.key.toLowerCase() === "s",
        run: (event) => {
          void saveDocument(event.shiftKey);
        }
      },
      {
        matches: (event) =>
          isPrimaryShortcut(event) && !event.shiftKey && event.key.toLowerCase() === "o",
        run: () => {
          void openDocument();
        }
      },
      {
        matches: (event) =>
          isPrimaryShortcut(event) &&
          !event.shiftKey &&
          (event.key === "/" || event.code === "Slash"),
        run: () => {
          void toggleSourceMode();
        }
      }
    ];

    const listener = (event: KeyboardEvent) => {
      const shortcut = shortcuts.find((candidate) => candidate.matches(event));
      if (!shortcut) {
        return;
      }

      event.preventDefault();
      shortcut.run(event);
    };

    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, [openDocument, saveDocument, toggleSourceMode]);

  const runMenuAction = useCallback(
    (action: string) => {
      switch (action) {
        case "md-editor:new":
          createNewDocument();
          break;
        case "md-editor:open":
          void openDocument();
          break;
        case "md-editor:save":
          void saveDocument(false);
          break;
        case "md-editor:save-as":
          void saveDocument(true);
          break;
        case "md-editor:mode-wysiwyg":
          void switchMode("wysiwyg");
          break;
        case "md-editor:toggle-source":
          void toggleSourceMode();
          break;
        case "md-editor:outline":
          void jumpToFirstHeading();
          break;
      }
    },
    [createNewDocument, jumpToFirstHeading, openDocument, saveDocument, switchMode, toggleSourceMode]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>(MENU_ACTION_EVENT, (event) => {
      runMenuAction(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [runMenuAction]);

  return (
    <main className="flex h-full min-w-0 flex-col bg-[var(--theme-bg)] md:min-w-[640px]">
      <section className="editor-pane" aria-label="Markdown 编辑器" onPasteCapture={pasteImage}>
        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {pendingAction ? <div className="status-banner">{pendingAction}</div> : null}
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function isPrimaryShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

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
