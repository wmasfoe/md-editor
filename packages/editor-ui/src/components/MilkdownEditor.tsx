import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { TextSelection } from "@milkdown/kit/prose/state";
import { editorViewCtx } from "@milkdown/kit/core";
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
  readonly onChange: (markdown: string) => void;
  readonly onActiveOutlineChange?: (id: string | null) => void;
  readonly resolveImageSrc?: (src: string) => string;
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
