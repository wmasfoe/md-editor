import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { DocumentSnapshot } from "@md-editor/editor-core";
import type { SourceEditorView, TocTarget } from "../types";
import "./SourceEditor.css";

export interface SourceEditorProps {
  readonly snapshot: DocumentSnapshot;
  readonly target: TocTarget | null;
  readonly onChange: (markdown: string) => void;
  readonly onVisibleLineChange?: (line: number) => void;
}

export function SourceEditor({
  snapshot,
  target,
  onChange,
  onVisibleLineChange
}: SourceEditorProps) {
  const editorView = useRef<SourceEditorView | null>(null);
  const [editorReadyVersion, setEditorReadyVersion] = useState(0);
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      EditorState.phrases.of({
        Find: "查找",
        Replace: "替换",
        next: "下一个",
        previous: "上一个",
        all: "全选",
        "match case": "区分大小写",
        regexp: "正则表达式",
        "by word": "全词匹配",
        replace: "替换",
        "replace all": "全部替换",
        close: "关闭"
      })
    ],
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

  useEffect(() => {
    const view = editorView.current;
    const scroller = view?.dom.querySelector<HTMLElement>(".cm-scroller");
    if (!view || !scroller || !onVisibleLineChange) {
      return;
    }

    let frame = 0;
    const reportVisibleLine = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = scroller.getBoundingClientRect();
        // The outline should follow what the reader sees, not only cursor
        // movement. CodeMirror's coordinate lookup gives a stable top line even
        // when the selection stays elsewhere.
        const position = view.posAtCoords({ x: rect.left + Math.min(96, rect.width / 2), y: rect.top + 8 });
        if (position !== null) {
          onVisibleLineChange(view.state.doc.lineAt(position).number);
        }
      });
    };

    reportVisibleLine();
    scroller.addEventListener("scroll", reportVisibleLine, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", reportVisibleLine);
    };
  }, [editorReadyVersion, onVisibleLineChange, snapshot.markdown]);

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
          // CodeMirror creates the view after React renders this wrapper. Bump
          // a ready token so scroll sync binds to the real scroller instead of
          // exiting forever during the first effect pass.
          setEditorReadyVersion((current) => current + 1);
        }}
        className="source-editor"
      />
    </div>
  );
}
