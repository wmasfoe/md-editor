import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx
} from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, useEditor, useInstance } from "@milkdown/react";
import { Selection, TextSelection, type SelectionBookmark } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import {
  restoreMarkdownImageSources,
  restoreRawBlocksFromPreview,
  rewriteMarkdownImageSourcesForPreview,
  rewriteRawBlocksForPreview
} from "@md-editor/markdown-fidelity";
import { codeBlockToolsPlugin } from "../../utils/code-block-tools";
import { codeHighlightPlugin } from "../../utils/code-highlight";
import {
  aiSuggestionPlugin,
  clearAiSuggestion,
  getAiCompletionContext,
  showAiSuggestion
} from "../../utils/ai-suggestion";
import { shouldPlaceCursorAtDocumentEnd } from "../../utils/editor-surface";
import { imeCompositionGuardPlugin } from "../../utils/ime-composition-guard";
import { imageSelectionPlugin } from "../../utils/image-selection";
import { updateWysiwygSearch, wysiwygSearchPlugin } from "../../utils/wysiwyg-search";
import type {
  MilkdownEditorPrimitiveProps
} from "./types";
import { WysiwygSearchPanel } from "./WysiwygSearchPanel";
import { AiThinkingIndicator } from "./AiThinkingIndicator";
import { findModifiedPrimaryClickLinkHref } from "./utils";
import "./MilkdownEditor.css";

const IME_MARKDOWN_PUBLISH_DELAY_MS = 260;
const WYSIWYG_FONT_SIZE_MIN = 13;
const WYSIWYG_FONT_SIZE_MAX = 22;

export function MilkdownEditorPrimitive({
  snapshot,
  outline = [],
  target,
  scrollTarget = null,
  insertRequest = null,
  aiSuggestionRequest = null,
  isAiSuggestionPending = false,
  aiAutoSuggestionsEnabled = false,
  showCodeBlockLineNumbers = false,
  wysiwygFontSize,
  onInsertRequestHandled,
  onAiSuggestionRequest,
  onAiSuggestionRequestHandled,
  onAiSuggestionError,
  onChange,
  onOpenLink,
  onScrollRatioChange,
  onScrollTargetApplied,
  onActiveOutlineChange,
  resolveImageSrc = (src) => src
}: MilkdownEditorPrimitiveProps) {
  // Milkdown owns document state after mount. Hosts must remount this primitive
  // for document replacement so preview image/raw-block maps stay aligned.
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
  const handledAiSuggestionRequestIdRef = useRef<number | null>(null);
  const compositionMarkdownDirtyRef = useRef(false);
  const lastPublishedPreviewMarkdownRef = useRef(previewInput.markdown);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchCaseSensitive, setIsSearchCaseSensitive] = useState(false);
  const [isLinkModifierActive, setIsLinkModifierActive] = useState(false);
  const [searchResult, setSearchResult] = useState({ matchCount: 0, activeIndex: -1 });
  const [isLocalAiSuggestionPending, setIsLocalAiSuggestionPending] = useState(false);
  const [isImeComposing, setIsImeComposing] = useState(false);
  const [userEditRevision, setUserEditRevision] = useState(0);
  const isImeComposingRef = useRef(false);
  const [loading, getInstance] = useInstance();
  const isAiThinking = isAiSuggestionPending || isLocalAiSuggestionPending;
  // 将字号变量限制在所见即所得容器上，避免影响源码模式的字体样式。
  const editorStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (typeof wysiwygFontSize !== "number" || !Number.isFinite(wysiwygFontSize)) {
      return undefined;
    }

    const safeFontSize = Math.min(
      Math.max(Math.round(wysiwygFontSize), WYSIWYG_FONT_SIZE_MIN),
      WYSIWYG_FONT_SIZE_MAX
    );

    return {
      "--theme-editor-font-size": `${safeFontSize}px`
    } as React.CSSProperties;
  }, [wysiwygFontSize]);
  const hostClassName = [
    "milkdown-host",
    isLinkModifierActive ? "milkdown-host--link-modifier-active" : "",
    isImeComposing ? "milkdown-host--ime-composing" : "",
    showCodeBlockLineNumbers ? "milkdown-host--code-line-numbers" : "",
    !isImeComposing && !snapshot.markdown.trim() ? "milkdown-host--empty" : ""
  ].filter(Boolean).join(" ");

  const publishPreviewMarkdownUpdate = useCallback((markdown: string) => {
    if (markdown === lastPublishedPreviewMarkdownRef.current) {
      return;
    }

    lastPublishedPreviewMarkdownRef.current = markdown;
    setUserEditRevision((current) => current + 1);
    const restoredImages = restoreMarkdownImageSources(markdown, imageSourceMapRef.current);
    onChange(restoreRawBlocksFromPreview(restoredImages, rawSourceMapRef.current));
  }, [onChange]);

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
    const activateLinkCursor = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        setIsLinkModifierActive(true);
      }
    };
    const resetLinkCursor = (event?: KeyboardEvent) => {
      if (!event || event.key === "Meta" || event.key === "Control" || !(event.metaKey || event.ctrlKey)) {
        setIsLinkModifierActive(false);
      }
    };
    const resetOnVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        setIsLinkModifierActive(false);
      }
    };
    const resetOnWindowBlur = () => resetLinkCursor();

    window.addEventListener("keydown", activateLinkCursor, { capture: true });
    window.addEventListener("keyup", resetLinkCursor, { capture: true });
    window.addEventListener("blur", resetOnWindowBlur);
    document.addEventListener("visibilitychange", resetOnVisibilityChange);
    return () => {
      window.removeEventListener("keydown", activateLinkCursor, { capture: true });
      window.removeEventListener("keyup", resetLinkCursor, { capture: true });
      window.removeEventListener("blur", resetOnWindowBlur);
      document.removeEventListener("visibilitychange", resetOnVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const editor = getInstance();
    if (loading || !editor) {
      return;
    }

    const view = editor.ctx.get(editorViewCtx);
    let compositionEndTimer: number | null = null;

    const setCompositionState = (nextState: boolean) => {
      isImeComposingRef.current = nextState;
      setIsImeComposing(nextState);
    };

    const handleCompositionStart = () => {
      if (compositionEndTimer !== null) {
        window.clearTimeout(compositionEndTimer);
        compositionEndTimer = null;
      }

      setCompositionState(true);
      compositionMarkdownDirtyRef.current = false;
      setIsLocalAiSuggestionPending(false);
      clearAiSuggestion(view);
    };

    const handleCompositionEnd = () => {
      if (compositionEndTimer !== null) {
        window.clearTimeout(compositionEndTimer);
      }

      // ProseMirror finishes composition cleanup on a short timer. Keep AI
      // gating active until that DOM cleanup has settled. Milkdown's listener
      // debounces markdownUpdated by 200ms, so the publish fallback waits long
      // enough to serialize only the final committed IME text.
      compositionEndTimer = window.setTimeout(() => {
        compositionEndTimer = null;
        setCompositionState(false);
        if (!compositionMarkdownDirtyRef.current) {
          return;
        }

        compositionMarkdownDirtyRef.current = false;
        const serializer = editor.ctx.get(serializerCtx);
        publishPreviewMarkdownUpdate(serializer(view.state.doc));
      }, IME_MARKDOWN_PUBLISH_DELAY_MS);
    };

    view.dom.addEventListener("compositionstart", handleCompositionStart);
    view.dom.addEventListener("compositionend", handleCompositionEnd);

    return () => {
      if (compositionEndTimer !== null) {
        window.clearTimeout(compositionEndTimer);
      }
      view.dom.removeEventListener("compositionstart", handleCompositionStart);
      view.dom.removeEventListener("compositionend", handleCompositionEnd);
      isImeComposingRef.current = false;
    };
  }, [getInstance, loading, publishPreviewMarkdownUpdate]);

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
      if (findModifiedPrimaryClickLinkHref(event, root)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

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
      const href = findModifiedPrimaryClickLinkHref(event, root);
      if (href) {
        event.preventDefault();
        event.stopPropagation();
        onOpenLink?.(href);
        return;
      }

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
  }, [loading, getInstance, onOpenLink]);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, previewInput.markdown);
          // The UI package edits preview-safe Markdown. Host apps inject image
          // URL resolution, then this component restores author-facing paths.
          ctx.get(listenerCtx).markdownUpdated((listenerCtx, markdown, previousMarkdown) => {
            if (markdown !== previousMarkdown) {
              const view = listenerCtx.get(editorViewCtx);
              if (isImeComposingRef.current || view.composing) {
                compositionMarkdownDirtyRef.current = true;
                return;
              }

              compositionMarkdownDirtyRef.current = false;
              publishPreviewMarkdownUpdate(markdown);
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
        .use(imeCompositionGuardPlugin)
        .use(imageSelectionPlugin)
        .use(aiSuggestionPlugin)
        .use(wysiwygSearchPlugin)
        .use(codeBlockToolsPlugin)
        .use(codeHighlightPlugin)
        .use(listener),
    [previewInput.markdown, publishPreviewMarkdownUpdate]
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
      requestAnimationFrame(() => view.focus());
    });
    // Once the loaded editor has attempted this request, the host should drop
    // it. Otherwise a later document remount can replay the same insertion.
    onInsertRequestHandled?.(insertRequest.id);
  }, [getInstance, insertRequest, loading, onInsertRequestHandled]);

  useEffect(() => {
    if (
      !aiSuggestionRequest ||
      handledAiSuggestionRequestIdRef.current === aiSuggestionRequest.id
    ) {
      return;
    }

    const editor = getInstance();
    if (!editor || loading) {
      return;
    }

    const view = editor.ctx.get(editorViewCtx);
    if (isImeComposingRef.current || view.composing) {
      handledAiSuggestionRequestIdRef.current = aiSuggestionRequest.id;
      onAiSuggestionRequestHandled?.(aiSuggestionRequest.id);
      setIsLocalAiSuggestionPending(false);
      return;
    }

    handledAiSuggestionRequestIdRef.current = aiSuggestionRequest.id;
    const requestedDoc = view.state.doc;
    const requestedSelection = view.state.selection;
    const context = getAiCompletionContext(view, snapshot.mode);
    let cancelled = false;
    const abortController = new AbortController();
    if (!onAiSuggestionRequest) {
      onAiSuggestionRequestHandled?.(aiSuggestionRequest.id);
      return;
    }

    void onAiSuggestionRequest(context, {
      ...aiSuggestionRequest,
      signal: abortController.signal
    })
      .then((suggestion) => {
        if (
          cancelled ||
          isImeComposingRef.current ||
          view.composing ||
          view.state.doc !== requestedDoc ||
          view.state.selection.from !== requestedSelection.from ||
          view.state.selection.to !== requestedSelection.to
        ) {
          return;
        }
        showAiSuggestion(view, aiSuggestionRequest.id, suggestion);
        requestAnimationFrame(() => view.focus());
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onAiSuggestionError?.(error instanceof Error ? error.message : "AI 续写失败。");
        }
      })
      .finally(() => {
        onAiSuggestionRequestHandled?.(aiSuggestionRequest.id);
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    aiSuggestionRequest,
    getInstance,
    isImeComposing,
    loading,
    onAiSuggestionError,
    onAiSuggestionRequest,
    onAiSuggestionRequestHandled,
    snapshot.markdown,
    snapshot.mode
  ]);

  useEffect(() => {
    if (
      !aiAutoSuggestionsEnabled ||
      !onAiSuggestionRequest ||
      isImeComposing ||
      loading ||
      snapshot.mode !== "wysiwyg" ||
      userEditRevision === 0 ||
      !snapshot.markdown.trim()
    ) {
      setIsLocalAiSuggestionPending(false);
      return;
    }

    const editor = getInstance();
    if (!editor) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      const view = editor.ctx.get(editorViewCtx);
      if (isImeComposingRef.current || view.composing) {
        return;
      }

      const requestedDoc = view.state.doc;
      const requestedSelection = view.state.selection;
      const context = getAiCompletionContext(view, snapshot.mode);
      const request = { id: Date.now(), signal: abortController.signal };
      setIsLocalAiSuggestionPending(true);

      void onAiSuggestionRequest(context, request)
        .then((suggestion) => {
          if (
            cancelled ||
            isImeComposingRef.current ||
            view.composing ||
            view.state.doc !== requestedDoc ||
            view.state.selection.from !== requestedSelection.from ||
            view.state.selection.to !== requestedSelection.to
          ) {
            return;
          }
          showAiSuggestion(view, request.id, suggestion);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            onAiSuggestionError?.(error instanceof Error ? error.message : "AI 写作建议生成失败。");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLocalAiSuggestionPending(false);
          }
        });
    }, 1_200);

    return () => {
      cancelled = true;
      abortController.abort();
      window.clearTimeout(timer);
      setIsLocalAiSuggestionPending(false);
    };
  }, [
    aiAutoSuggestionsEnabled,
    getInstance,
    isImeComposing,
    loading,
    onAiSuggestionError,
    onAiSuggestionRequest,
    snapshot.markdown,
    snapshot.mode,
    userEditRevision
  ]);

  useEffect(() => {
    if (scrollTarget || !target || !rootRef.current) {
      return;
    }

    // Mode restoration is intentionally allowed to override a stale TOC jump.
    // The same Markdown can have different rendered heights in WYSIWYG, so the
    // ratio target is the best cross-mode anchor for the user's current place.
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
  }, [scrollTarget, target]);

  useEffect(() => {
    if (!scrollTarget || !rootRef.current) {
      return;
    }

    const root = rootRef.current;
    let frame = 0;
    let observer: MutationObserver | null = null;

    const applyScrollTarget = () => {
      const scroller = root.querySelector<HTMLElement>(".milkdown");
      if (!scroller) {
        return false;
      }

      frame = window.requestAnimationFrame(() => {
        const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
        scroller.scrollTop = maxScrollTop * Math.min(Math.max(scrollTarget.ratio, 0), 1);
        onScrollTargetApplied?.(scrollTarget.nonce);
      });
      return true;
    };

    if (!applyScrollTarget()) {
      observer = new MutationObserver(() => {
        if (applyScrollTarget()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [onScrollTargetApplied, scrollTarget]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || (!onActiveOutlineChange && !onScrollRatioChange)) {
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

        const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
        onScrollRatioChange?.(maxScrollTop === 0 ? 0 : scroller.scrollTop / maxScrollTop);

        if (!onActiveOutlineChange) {
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
  }, [onActiveOutlineChange, onScrollRatioChange, outline, snapshot.markdown]);

  return (
    <div
      ref={rootRef}
      className={hostClassName}
      style={editorStyle}
    >
      {isSearchOpen ? (
        <WysiwygSearchPanel
          inputRef={searchInputRef}
          query={searchQuery}
          result={searchResult}
          caseSensitive={isSearchCaseSensitive}
          onQueryChange={setSearchQuery}
          onCaseSensitiveChange={setIsSearchCaseSensitive}
          onSearch={runSearch}
          onClose={closeSearch}
        />
      ) : null}
      <AiThinkingIndicator visible={isAiThinking} />
      <Milkdown />
    </div>
  );
}
