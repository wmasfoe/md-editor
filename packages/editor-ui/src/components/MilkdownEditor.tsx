import { useEffect, useMemo, useRef } from "react";
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
import { imageSelectionPlugin } from "../utils/image-selection";
import type { OutlineItem } from "./OutlinePanel";
import type { TocTarget } from "../types";

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
  const [loading, getInstance] = useInstance();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let scroller: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    const handleClick = (event: MouseEvent) => {
      if (loading) return;

      const target = event.target as HTMLElement;
      const proseMirror = root.querySelector<HTMLElement>(".ProseMirror");

      // 只有点击 .milkdown 容器或 .ProseMirror 容器本身时才触发
      // 如果点击的是文本节点、标题、段落等内部元素，不触发
      if (target !== scroller && target !== proseMirror) return;

      const editor = getInstance();
      if (!editor) return;
      const view = editor.ctx.get(editorViewCtx);
      if (!view) return;
      const { doc } = view.state;
      const endPos = doc.content.size;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos));
      view.dispatch(tr);

      // 先聚焦，然后确保光标可见
      requestAnimationFrame(() => {
        view.focus();
      });
    };

    const bindScroller = () => {
      const nextScroller = root.querySelector<HTMLElement>(".milkdown");
      if (!nextScroller || nextScroller === scroller) {
        return Boolean(scroller);
      }

      scroller?.removeEventListener("click", handleClick);
      scroller = nextScroller;
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
      <Milkdown />
    </div>
  );
}
