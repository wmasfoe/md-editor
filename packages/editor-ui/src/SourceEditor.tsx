import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { DocumentSnapshot } from "@md-editor/editor-core";
import type { SourceEditorView, TocTarget } from "./types";

export interface SourceEditorProps {
  readonly snapshot: DocumentSnapshot;
  readonly target: TocTarget | null;
  readonly onChange: (markdown: string) => void;
}

export function SourceEditor({ snapshot, target, onChange }: SourceEditorProps) {
  const editorView = useRef<SourceEditorView | null>(null);
  const extensions = useMemo(() => [markdown({ base: markdownLanguage })], []);

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
    <div className="flex min-h-0 flex-1 flex-col">
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
