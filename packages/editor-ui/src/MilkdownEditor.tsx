import { useEffect, useMemo, useRef } from "react";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { DocumentSnapshot } from "@md-editor/editor-core";
import {
  restoreMarkdownImageSources,
  rewriteMarkdownImageSourcesForPreview
} from "@md-editor/markdown-fidelity";
import type { TocTarget } from "./types";

export interface MilkdownEditorProps {
  readonly snapshot: DocumentSnapshot;
  readonly target: TocTarget | null;
  readonly onChange: (markdown: string) => void;
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
  target,
  onChange,
  resolveImageSrc = (src) => src
}: MilkdownEditorProps) {
  const previewInput = useMemo(
    () => rewriteMarkdownImageSourcesForPreview(snapshot.markdown, resolveImageSrc),
    []
  );
  const sourceMapRef = useRef(previewInput.sourceMap);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
              onChange(restoreMarkdownImageSources(markdown, sourceMapRef.current));
            }
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
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

  return (
    <div ref={rootRef} className="milkdown-host">
      <Milkdown />
    </div>
  );
}
