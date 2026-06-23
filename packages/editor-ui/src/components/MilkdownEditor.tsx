import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { Selection, TextSelection, type SelectionBookmark } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import type { DocumentSnapshot } from "@md-editor/editor-core";
import {
  restoreMarkdownImageSources,
  restoreRawBlocksFromPreview,
  rewriteMarkdownImageSourcesForPreview,
  rewriteRawBlocksForPreview
} from "@md-editor/markdown-fidelity";
import { codeBlockToolsPlugin } from "../utils/code-block-tools";
import { codeHighlightPlugin } from "../utils/code-highlight";
import { shouldPlaceCursorAtDocumentEnd } from "../utils/editor-surface";
import { imageSelectionPlugin } from "../utils/image-selection";
import { updateWysiwygSearch, wysiwygSearchPlugin } from "../utils/wysiwyg-search";
import type { OutlineItem } from "./OutlinePanel";
import type { TocTarget } from "../types";
import "./MilkdownEditor.css";

export interface MilkdownEditorProps {
  readonly snapshot: DocumentSnapshot;
  readonly outline?: readonly OutlineItem[];
  readonly target: TocTarget | null;
  readonly insertRequest?: MarkdownInsertRequest | null;
  readonly onInsertRequestHandled?: (id: number) => void;
  readonly onChange: (markdown: string) => void;
  readonly onActiveOutlineChange?: (id: string | null) => void;
  readonly resolveImageSrc?: (src: string) => string;
}

export interface MarkdownInsertRequest {
  readonly id: number;
  readonly markdown: string;
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownEditorInner({
  snapshot,
  outline = [],
  target,
  insertRequest = null,
  onInsertRequestHandled,
  onChange,
  onActiveOutlineChange,
  resolveImageSrc = (src) => src
}: MilkdownEditorProps) {
  const previewInput = useMemo(
    () => {
      const rawPreview = rewriteRawBlocksForPreview(snapshot.markdown);
      const imagePreview = rewriteMarkdownImageSourcesForPreview(rawPreview.markdown, resolveImageSrc);
      return {
        markdown: imagePreview.markdown,
        imageSourceMap: imagePreview.sourceMap,
        rawSourceMap: rawPreview.sourceMap
      };
    },
    []
  );
  const imageSourceMapRef = useRef(previewInput.imageSourceMap);
  const rawSourceMapRef = useRef(previewInput.rawSourceMap);
  const selectionBookmarkRef = useRef<SelectionBookmark | null>(null);
  const handledInsertRequestIdRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchCaseSensitive, setIsSearchCaseSensitive] = useState(false);
  const [searchResult, setSearchResult] = useState({ matchCount: 0, activeIndex: -1 });
  const [loading, getInstance] = useInstance();

  const runSearch = useCallback(
    (query: string, requestedIndex: number, caseSensitive = isSearchCaseSensitive) => {
      const editor = getInstance();
      if (!editor || loading) {
        return;
      }
      const view = editor.ctx.get(editorViewCtx);
      setSearchResult(updateWysiwygSearch(view, query, caseSensitive, requestedIndex));
    },
    [getInstance, isSearchCaseSensitive, loading]
  );

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    const editor = getInstance();
    if (!editor || loading) {
      return;
    }
    const view = editor.ctx.get(editorViewCtx);
    updateWysiwygSearch(view, "", false, -1);
    requestAnimationFrame(() => view.focus());
  }, [getInstance, loading]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (
        document.querySelector('[role="dialog"]') ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const editor = getInstance();
      const view = !loading && editor ? editor.ctx.get(editorViewCtx) : null;
      const selection = view?.state.selection;
      const selectedText =
        selection && !selection.empty
          ? view.state.doc.textBetween(selection.from, selection.to, " ").slice(0, 120)
          : "";
      const nextQuery = selectedText || searchQuery;
      setSearchQuery(nextQuery);
      setIsSearchOpen(true);
      if (view) {
        setSearchResult(updateWysiwygSearch(view, nextQuery, isSearchCaseSensitive, 0));
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };

    window.addEventListener("keydown", openSearch, { capture: true });
    return () => window.removeEventListener("keydown", openSearch, { capture: true });
  }, [getInstance, isSearchCaseSensitive, loading, searchQuery]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let scroller: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    const placeCursorAtDocumentEnd = () => {
      if (loading) return;

      const editor = getInstance();
      if (!editor) return;
      const view = editor.ctx.get(editorViewCtx);
      if (!view) return;
      const { doc } = view.state;
      const endPos = doc.content.size;
      window.getSelection()?.removeAllRanges();
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos));
      view.dispatch(tr);

      // 先聚焦，然后确保光标可见
      requestAnimationFrame(() => {
        view.focus();
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (
        !shouldPlaceCursorAtDocumentEnd(
          event.target,
          scroller,
          root.querySelector<HTMLElement>(".ProseMirror"),
          window.getSelection()
        )
      ) {
        return;
      }
      event.preventDefault();
      placeCursorAtDocumentEnd();
    };

    const handleClick = (event: MouseEvent) => {
      if (
        !shouldPlaceCursorAtDocumentEnd(
          event.target,
          scroller,
          root.querySelector<HTMLElement>(".ProseMirror"),
          window.getSelection()
        )
      ) {
        return;
      }
      placeCursorAtDocumentEnd();
    };

    const bindScroller = () => {
      const nextScroller = root.querySelector<HTMLElement>(".milkdown");
      if (!nextScroller || nextScroller === scroller) {
        return Boolean(scroller);
      }

      scroller?.removeEventListener("click", handleClick);
      scroller?.removeEventListener("mousedown", handleMouseDown);
      scroller = nextScroller;
      scroller.addEventListener("mousedown", handleMouseDown);
      scroller.addEventListener("click", handleClick);
      return true;
    };

    if (!bindScroller()) {
      observer = new MutationObserver(() => {
        if (bindScroller()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      scroller?.removeEventListener("mousedown", handleMouseDown);
      scroller?.removeEventListener("click", handleClick);
    };
  }, [loading, getInstance]);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, previewInput.markdown);
          // The UI package edits preview-safe Markdown. Host apps inject image
          // URL resolution, then this component restores author-facing paths.
          ctx.get(listenerCtx).markdownUpdated((_, markdown, previousMarkdown) => {
            if (markdown !== previousMarkdown) {
              const restoredImages = restoreMarkdownImageSources(markdown, imageSourceMapRef.current);
              onChange(restoreRawBlocksFromPreview(restoredImages, rawSourceMapRef.current));
            }
          });
          ctx.get(listenerCtx).mounted((mountedCtx) => {
            const view = mountedCtx.get(editorViewCtx);
            selectionBookmarkRef.current = view.state.selection.getBookmark();
          });
          ctx.get(listenerCtx).selectionUpdated((_, selection) => {
            selectionBookmarkRef.current = selection.getBookmark();
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(imageSelectionPlugin)
        .use(wysiwygSearchPlugin)
        .use(codeBlockToolsPlugin)
        .use(codeHighlightPlugin)
        .use(listener),
    [onChange, previewInput.markdown]
  );

  useEffect(() => {
    if (!insertRequest || handledInsertRequestIdRef.current === insertRequest.id) {
      return;
    }

    const editor = getInstance();
    if (!editor || loading) {
      return;
    }

    handledInsertRequestIdRef.current = insertRequest.id;
    const rawPreview = rewriteRawBlocksForPreview(insertRequest.markdown);
    rawSourceMapRef.current = [...rawSourceMapRef.current, ...rawPreview.sourceMap];

    let didInsert = false;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const doc = parser(rawPreview.markdown);
      if (!doc) {
        return;
      }

      const bookmarkedSelection = selectionBookmarkRef.current?.resolve(view.state.doc);
      const selection = bookmarkedSelection ?? view.state.selection;
      const contentSlice = selection.content();
      const slice = new Slice(doc.content, contentSlice.openStart, contentSlice.openEnd);
      const transaction = view.state.tr
        .setSelection(selection)
        .replaceSelection(slice);
      const changedRange = transaction.changedRange();
      const cursorPosition = Math.min(
        changedRange?.to ?? transaction.selection.to,
        transaction.doc.content.size
      );
      const nextSelection = Selection.near(transaction.doc.resolve(cursorPosition), 1);

      view.dispatch(transaction.setSelection(nextSelection).scrollIntoView());
      selectionBookmarkRef.current = nextSelection.getBookmark();
      didInsert = true;
      requestAnimationFrame(() => view.focus());
    });
    // Once the loaded editor has attempted this request, the host should drop
    // it. Otherwise a later document remount can replay the same insertion.
    onInsertRequestHandled?.(insertRequest.id);
  }, [getInstance, insertRequest, loading, onInsertRequestHandled]);

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

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onActiveOutlineChange) {
      return;
    }

    let frame = 0;
    let observer: MutationObserver | null = null;
    let scroller: HTMLElement | null = null;
    const reportActiveHeading = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!scroller) {
          return;
        }

        const headings = Array.from(
          root.querySelectorAll<HTMLElement>(
            ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6"
          )
        );
        const scrollerTop = scroller.getBoundingClientRect().top;
        const activeIndex = headings.reduce((current, heading, index) => {
          // Milkdown's current GFM preset does not expose stable heading ids in
          // this layer. For v0.1, DOM heading order matches markdown outline
          // order, so we map the last heading above the reading line to outline.
          return heading.getBoundingClientRect().top <= scrollerTop + 96 ? index : current;
        }, -1);

        onActiveOutlineChange(activeIndex >= 0 ? outline[activeIndex]?.id ?? null : null);
      });
    };

    const bindScroller = () => {
      const nextScroller = root.querySelector<HTMLElement>(".milkdown");
      if (!nextScroller || nextScroller === scroller) {
        return Boolean(scroller);
      }

      scroller?.removeEventListener("scroll", reportActiveHeading);
      scroller = nextScroller;
      scroller.addEventListener("scroll", reportActiveHeading, { passive: true });
      reportActiveHeading();
      return true;
    };

    if (!bindScroller()) {
      // Milkdown mounts its internal DOM after the React wrapper commits. The
      // observer gives scroll sync one narrow retry path instead of assuming the
      // `.milkdown` scroller exists during the first effect pass.
      observer = new MutationObserver(() => {
        if (bindScroller()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", reportActiveHeading);
    };
  }, [onActiveOutlineChange, outline, snapshot.markdown]);

  return (
    <div ref={rootRef} className="milkdown-host">
      {isSearchOpen ? (
        <div className="wysiwyg-search-panel" role="search" aria-label="在文档中查找">
          <input
            ref={searchInputRef}
            value={searchQuery}
            aria-label="查找内容"
            placeholder="查找"
            onChange={(event) => {
              const query = event.target.value;
              setSearchQuery(query);
              runSearch(query, 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              } else if (event.key === "Enter") {
                event.preventDefault();
                runSearch(searchQuery, searchResult.activeIndex + (event.shiftKey ? -1 : 1));
              }
            }}
          />
          <span className="wysiwyg-search-panel__count" aria-live="polite">
            {searchResult.matchCount === 0
              ? "无匹配"
              : `${searchResult.activeIndex + 1} / ${searchResult.matchCount}`}
          </span>
          <button
            type="button"
            aria-label="上一个匹配"
            onClick={() => runSearch(searchQuery, searchResult.activeIndex - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="下一个匹配"
            onClick={() => runSearch(searchQuery, searchResult.activeIndex + 1)}
          >
            ↓
          </button>
          <label>
            <input
              type="checkbox"
              checked={isSearchCaseSensitive}
              onChange={(event) => {
                const checked = event.target.checked;
                setIsSearchCaseSensitive(checked);
                runSearch(searchQuery, 0, checked);
              }}
            />
            区分大小写
          </label>
          <button type="button" aria-label="关闭查找" onClick={closeSearch}>
            ×
          </button>
        </div>
      ) : null}
      <Milkdown />
    </div>
  );
}
