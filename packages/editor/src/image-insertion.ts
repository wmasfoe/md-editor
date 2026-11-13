import type { DocumentState } from "@md-editor/core";
import type { CodeMirrorEditorExternalEditResult } from "./bridge.ts";
import type { ExternalEditRequest } from "./renderer/types.ts";

export interface ImageInsertionInput {
  readonly src: string;
  readonly alt: string;
}

export interface ImageInsertionOptions {
  readonly layout?: "inline" | "block";
}

/** Prepared before asynchronous storage; an outdated insertion never overwrites later edits. */
export type PreparedImageInsertion = (
  image: ImageInsertionInput,
) => CodeMirrorEditorExternalEditResult;

let nextImageOperation = 1;

export function prepareImageInsertion(
  document: DocumentState,
  renderer: {
    flushPendingEdits(): boolean;
    getSelectionSnapshot(): { readonly from: number; readonly to: number };
  },
  apply: (request: ExternalEditRequest) => CodeMirrorEditorExternalEditResult,
  options: ImageInsertionOptions = {},
): PreparedImageInsertion {
  renderer.flushPendingEdits();
  const snapshot = document.getSnapshot();
  const { from, to } = renderer.getSelectionSnapshot();
  const layout = options.layout ?? "inline";
  const operationId = `image:${nextImageOperation++}`;
  let consumed = false;
  return (image) => {
    if (consumed) return { status: "cancelled", reason: "superseded" };
    consumed = true;
    const current = document.getSnapshot();
    if (
      current.documentGeneration !== snapshot.documentGeneration ||
      current.contentRevision !== snapshot.contentRevision ||
      current.filePath !== snapshot.filePath
    ) {
      return {
        status: "stale",
        actualGeneration: current.documentGeneration,
        actualContentRevision: current.contentRevision,
      };
    }
    const before = snapshot.markdown.slice(0, from);
    const after = snapshot.markdown.slice(to);
    const alt = image.alt.replace(/[\r\n]+/gu, " ").replace(/[\\[\]]/gu, "\\$&");
    const src = image.src.replace(/[\s()<>\\]/gu, (char) =>
      encodeURIComponent(char).replace(
        /[()]/gu,
        (bracket) => `%${bracket.charCodeAt(0).toString(16)}`,
      ),
    );
    const prefix =
      layout === "block" && before && !before.endsWith("\n\n")
        ? before.endsWith("\n")
          ? "\n"
          : "\n\n"
        : "";
    const suffix =
      layout === "block" && after && !after.startsWith("\n\n")
        ? after.startsWith("\n")
          ? "\n"
          : "\n\n"
        : "";
    const insert = `${prefix}![${alt}](${src})${suffix}`;
    return apply({
      operationId,
      markdown: `${before}${insert}${after}`,
      expectedGeneration: snapshot.documentGeneration,
      expectedContentRevision: snapshot.contentRevision,
      selection: { anchor: before.length + insert.length },
    });
  };
}
