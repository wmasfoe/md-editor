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
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  createBuiltInEditorFeature,
  createFeatureRegistry,
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
  type MarkdownFileTreeNode,
  type MarkdownFolder,
  type SaveMarkdownInput
} from "@md-editor/file-system";
import { extractHeadingOutline } from "@md-editor/markdown-fidelity";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-registry";
import "./styles.css";

const featureRegistry = createFeatureRegistry();
featureRegistry.register(createBuiltInEditorFeature());

const runtime = createEditorRuntime({
  document: createDocumentState({
    markdown: "# Untitled\n\nStart writing Markdown."
  }),
  mdxComponents: createBuiltInMdxRegistry(),
  features: featureRegistry
});
const fileService = createFileService(createDesktopFileAdapter());
const MENU_ACTION_EVENT = "md-editor-menu-action";

type SidebarMode = "files" | "outline";

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

interface TocTarget {
  readonly line: number;
  readonly level: number;
  readonly text: string;
  readonly nonce: number;
}

function App() {
  // 初始桌面壳先绑定 EditorRuntime，后续接入 Milkdown / CodeMirror 时
  // App 层仍然通过同一份运行时契约读写文档。
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const documentKey = `${snapshot.filePath ?? "untitled"}:${snapshot.savedMarkdown}`;
  const outline = useMemo(() => extractHeadingOutline(snapshot.markdown), [snapshot.markdown]);

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

  const openFolder = useCallback(async () => {
    await runFileAction("正在打开文件夹", async () => {
      const openedFolder = await fileService.openFolder();
      if (!openedFolder) {
        return;
      }
      setFolder(openedFolder);
      setSidebarMode("files");
    });
  }, [runFileAction]);

  const openDocumentFromTree = useCallback(
    async (filePath: string) => {
      if (!ensureDiscardAllowed()) {
        return;
      }

      await runFileAction("正在打开", async () => {
        replaceDocument(await fileService.openDocumentAtPath(filePath));
      });
    },
    [ensureDiscardAllowed, replaceDocument, runFileAction]
  );

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

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    setTocTarget({ ...target, nonce: Date.now() });
  }, []);

  const toggleSidebarPrimary = useCallback(async () => {
    setSidebarMode((current) => (current === "files" ? "outline" : "files"));
  }, []);

  const dispatchCommand = useCallback(
    async (id: string) => {
      await runtime.commands.dispatch(id, {
        document: runtime.document,
        actions: {
          newDocument: createNewDocument,
          openDocument,
          openFolder,
          saveDocument: () => saveDocument(false),
          saveDocumentAs: () => saveDocument(true),
          toggleSourceMode,
          showWysiwygMode: () => switchMode("wysiwyg"),
          toggleSidebarPrimary
        }
      });
    },
    [
      createNewDocument,
      openDocument,
      openFolder,
      saveDocument,
      switchMode,
      toggleSidebarPrimary,
      toggleSourceMode
    ]
  );

  useEffect(() => {
    // 集中维护快捷键，后续新增时保持键盘和菜单动作一致。
    const shortcuts: readonly KeyboardShortcut[] = runtime.keymaps.list().map((keymap) => ({
      matches: (event) => matchesRuntimeKeymap(event, keymap.key),
      run: () => {
        void dispatchCommand(keymap.commandId);
      }
    }));

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
  }, [dispatchCommand]);

  const runMenuAction = useCallback(
    (action: string) => {
      switch (action) {
        case "md-editor:new":
          void dispatchCommand("file.new");
          break;
        case "md-editor:open":
          void dispatchCommand("file.open");
          break;
        case "md-editor:open-folder":
          void dispatchCommand("file.openFolder");
          break;
        case "md-editor:save":
          void dispatchCommand("file.save");
          break;
        case "md-editor:save-as":
          void dispatchCommand("file.saveAs");
          break;
        case "md-editor:mode-wysiwyg":
          void dispatchCommand("view.showWysiwyg");
          break;
        case "md-editor:toggle-source":
          void dispatchCommand("view.toggleSource");
          break;
        case "md-editor:toggle-sidebar-primary":
          void dispatchCommand("view.toggleSidebarPrimary");
          break;
      }
    },
    [dispatchCommand]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    if (!isTauri()) {
      return undefined;
    }

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
    <main className="app-shell">
      <aside className="sidebar" aria-label={sidebarMode === "files" ? "文件树" : "大纲目录"}>
        <div className="sidebar-switcher" role="tablist" aria-label="侧栏视图">
          <button
            type="button"
            className={sidebarMode === "files" ? "sidebar-tab active" : "sidebar-tab"}
            onClick={() => setSidebarMode("files")}
          >
            文件
          </button>
          <button
            type="button"
            className={sidebarMode === "outline" ? "sidebar-tab active" : "sidebar-tab"}
            onClick={() => setSidebarMode("outline")}
          >
            大纲
          </button>
        </div>
        {sidebarMode === "files" ? (
          <FileTreePanel
            folder={folder}
            activeFilePath={snapshot.filePath}
            onOpenFolder={() => void dispatchCommand("file.openFolder")}
            onOpenFile={(filePath) => void openDocumentFromTree(filePath)}
          />
        ) : (
          <OutlinePanel outline={outline} onJump={jumpToTocItem} />
        )}
      </aside>
      <section className="editor-pane" aria-label="Markdown 编辑器" onPasteCapture={pasteImage}>
        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {pendingAction ? <div className="status-banner">{pendingAction}</div> : null}
        {snapshot.mode === "source" ? (
          <SourceEditor
            snapshot={snapshot}
            target={tocTarget}
            onChange={commitMarkdown}
          />
        ) : (
          <MilkdownEditor
            key={documentKey}
            snapshot={snapshot}
            target={tocTarget}
            onChange={commitMarkdown}
          />
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
  readonly target: TocTarget | null;
}

function SourceEditor({ snapshot, target, onChange }: SourceEditorProps) {
  const editorView = useRef<SourceEditorView | null>(null);
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage })],
    []
  );

  useEffect(() => {
    if (target === null || !editorView.current) {
      return;
    }

    const view = editorView.current;
    const safeLine = Math.min(Math.max(target.line, 1), view.state.doc.lines);
    const position = view.state.doc.line(safeLine).from;
    view.dispatch({ selection: { anchor: position } });
    view.focus();
    requestAnimationFrame(() => {
      view.dom.querySelector(".cm-activeLine")?.scrollIntoView({ block: "center" });
    });
  }, [snapshot.markdown, target]);

  return (
    <div className="source-editor-shell">
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
    </div>
  );
}

interface FileTreePanelProps {
  readonly folder: MarkdownFolder | null;
  readonly activeFilePath: string | null;
  readonly onOpenFolder: () => void;
  readonly onOpenFile: (filePath: string) => void;
}

function FileTreePanel({ folder, activeFilePath, onOpenFolder, onOpenFile }: FileTreePanelProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [folder?.rootPath]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (!folder) {
    return (
      <div className="sidebar-empty">
        <button type="button" className="sidebar-command" onClick={onOpenFolder}>
          打开文件夹
        </button>
      </div>
    );
  }

  return (
    <div className="file-tree-panel">
      <div className="sidebar-title" title={folder.rootPath}>
        {folder.rootName}
      </div>
      <FileTreeNodeView
        node={folder.tree}
        activeFilePath={activeFilePath}
        collapsedPaths={collapsedPaths}
        onToggleCollapsed={toggleCollapsed}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

interface FileTreeNodeViewProps {
  readonly node: MarkdownFileTreeNode;
  readonly activeFilePath: string | null;
  readonly collapsedPaths: ReadonlySet<string>;
  readonly depth?: number;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onOpenFile: (filePath: string) => void;
}

function FileTreeNodeView({
  node,
  activeFilePath,
  collapsedPaths,
  depth = 0,
  onToggleCollapsed,
  onOpenFile
}: FileTreeNodeViewProps) {
  const paddingLeft = 12 + depth * 14;

  if (node.kind === "markdown") {
    return (
      <button
        type="button"
        className={node.path === activeFilePath ? "tree-row active" : "tree-row"}
        style={{ paddingLeft }}
        title={node.path}
        onClick={() => onOpenFile(node.path)}
      >
        <span className="tree-icon">#</span>
        <span className="tree-label">{node.name}</span>
      </button>
    );
  }

  const isCollapsed = collapsedPaths.has(node.path);

  return (
    <div className="tree-group">
      <button
        type="button"
        className="tree-row directory"
        style={{ paddingLeft }}
        title={node.path}
        aria-expanded={!isCollapsed}
        onClick={() => onToggleCollapsed(node.path)}
      >
        <span className="tree-icon">{isCollapsed ? "▸" : "▾"}</span>
        <span className="tree-label">{node.name}</span>
      </button>
      {isCollapsed
        ? null
        : node.children?.map((child) => (
            <FileTreeNodeView
              key={child.path}
              node={child}
              activeFilePath={activeFilePath}
              collapsedPaths={collapsedPaths}
              depth={depth + 1}
              onToggleCollapsed={onToggleCollapsed}
              onOpenFile={onOpenFile}
            />
          ))}
    </div>
  );
}

interface OutlinePanelProps {
  readonly outline: ReturnType<typeof extractHeadingOutline>;
  readonly onJump: (target: Omit<TocTarget, "nonce">) => void;
}

function OutlinePanel({ outline, onJump }: OutlinePanelProps) {
  if (outline.length === 0) {
    return <div className="sidebar-empty">当前文档没有标题。</div>;
  }

  return (
    <nav className="outline-panel" aria-label="大纲目录">
      {outline.map((item) => (
        <button
          type="button"
          key={`${item.id}-${item.line}`}
          className="outline-row"
          style={{ paddingLeft: 12 + (item.level - 1) * 14 }}
          onClick={() => onJump({ line: item.line, level: item.level, text: item.text })}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}

interface MilkdownEditorProps extends EditorProps {
  readonly target: TocTarget | null;
}

function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownEditorInner({ snapshot, target, onChange }: MilkdownEditorProps) {
  const initialMarkdown = useMemo(() => snapshot.markdown, []);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
        .use(gfm)
        .use(history)
        .use(listener),
    [initialMarkdown, onChange]
  );

  useEffect(() => {
    if (!target || !rootRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      const headings = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(
          `.ProseMirror h${target.level}`
        ) ?? []
      );
      const heading = headings.find((candidate) => candidate.textContent?.trim() === target.text);
      heading?.scrollIntoView({ block: "center" });
      heading?.focus?.();
    });
  }, [target]);

  return (
    <div ref={rootRef} className="milkdown-host">
      <Milkdown />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function isPrimaryShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

function matchesRuntimeKeymap(event: KeyboardEvent, keymap: string): boolean {
  const parts = keymap.split("-");
  const key = parts.at(-1)?.toLowerCase();
  const wantsMod = parts.includes("Mod");
  const wantsShift = parts.includes("Shift");

  if (wantsMod && !isPrimaryShortcut(event)) {
    return false;
  }
  if (!wantsMod && (event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.shiftKey !== wantsShift) {
    return false;
  }

  if (key === "/") {
    return event.key === "/" || event.code === "Slash";
  }

  return event.key.toLowerCase() === key;
}

function createDesktopFileAdapter(): FileServiceAdapter {
  return {
    openMarkdownFile() {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("open_markdown_document");
    },
    openMarkdownFolder() {
      assertDesktopRuntime();
      return invoke<MarkdownFolder | null>("open_markdown_folder");
    },
    readMarkdownFile(path) {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile>("open_markdown_document_at_path", { path });
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
