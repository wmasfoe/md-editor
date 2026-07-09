import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useEditorUiActions } from "@md-editor/editor-ui";

export interface DesktopDocumentMutationBridge {
  setEditorRevision: Dispatch<SetStateAction<number>>;
}

export function useDesktopDocumentMutationBridge(): DesktopDocumentMutationBridge {
  const { setDocumentRevision } = useEditorUiActions();

  // editor revision 属于 editor-ui provider；desktop 只拿到一个稳定 setter 供文档动作调用。
  const setEditorRevision = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => setDocumentRevision(value),
    [setDocumentRevision]
  );

  return { setEditorRevision };
}
