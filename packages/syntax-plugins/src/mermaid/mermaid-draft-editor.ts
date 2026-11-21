import type { EditorOp, MermaidWysiwygEditor, OpResult, Origin } from "@visimer/core";
import { sequenceBlockConditionEdit } from "./mermaid-sequence-blocks.ts";

// Preserve the existing ASCII label alphabet and accept Unicode punctuation as literal text.
// Mermaid's ASCII delimiters and control characters are still excluded.
export function isMermaidLabel(value: string): boolean {
  return /^(?:[-\p{L}\p{N}\p{M}\p{Zs}_.,!?;:()/+]|(?=\P{ASCII})[\p{P}\p{Extended_Pictographic}\p{Emoji_Modifier}])*$/u.test(
    value,
  );
}

/**
 * 宿主侧的草稿编辑器：在 Visimer 之上补上「非实体」的源码行编辑能力。
 *
 * 块关键字（alt/else/loop…）在 Visimer 里没有实体 id，也没有对应 operation，
 * 所以只能走源码补丁；但补丁必须和 dispatch 一样先落到一次性草稿上校验，
 * 否则一次非法输入就会污染画布历史。
 */
export type MermaidDraftEditor = MermaidWysiwygEditor & {
  /** 重写某个块分支关键字之后的条件文案；`lineIndex` 不是块行时不做任何事。 */
  setBlockCondition(lineIndex: number, condition: string): void;
};

interface DraftEditorOptions {
  readonly source: string;
  readonly validate: (code: string) => Promise<string | null>;
  readonly validateOperation: (editor: MermaidWysiwygEditor, operation: EditorOp) => string | null;
  readonly onBusy: (busy: boolean) => void;
  readonly onError: (message: string) => void;
  readonly isClosed: () => boolean;
}

/** Stage Visimer operations against a disposable draft before touching the canvas history. */
export function createMermaidDraftEditor(
  Editor: typeof MermaidWysiwygEditor,
  options: DraftEditorOptions,
): MermaidDraftEditor {
  let validating = false;

  return new (class extends Editor {
    #stage<T>(mutate: (draft: MermaidWysiwygEditor) => T, origin: Origin): T | null {
      if (validating || options.isClosed()) return null;
      const draft = new Editor({ code: this.code });
      draft.setSelection(this.selection, origin);
      const result = mutate(draft);
      if (draft.code === this.code) return result;
      validating = true;
      options.onBusy(true);
      void options
        .validate(draft.code)
        .then((error) => {
          if (options.isClosed()) return;
          if (error) {
            options.onError(error);
            return;
          }
          super.setCode(draft.code, origin);
          this.setSelection(draft.selection, origin);
        })
        .catch((error: unknown) => {
          if (!options.isClosed())
            options.onError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          validating = false;
          if (!options.isClosed()) options.onBusy(false);
        });
      return result;
    }

    override dispatch(operation: EditorOp, origin: Origin = "canvas"): OpResult | null {
      const error = options.validateOperation(this, operation);
      if (error) {
        options.onError(error);
        return null;
      }
      return this.#stage((draft) => draft.dispatch(operation, origin), origin);
    }

    override deleteEntities(entities: string[], origin: Origin = "canvas"): void {
      this.#stage((draft) => draft.deleteEntities(entities, origin), origin);
    }

    setBlockCondition(lineIndex: number, condition: string): void {
      this.#stage((draft) => {
        const edit = sequenceBlockConditionEdit(draft.result, lineIndex, condition);
        if (edit) draft.applyEdits([edit], "canvas");
      }, "canvas");
    }

    override undo(): boolean {
      return !validating && super.undo();
    }

    override redo(): boolean {
      return !validating && super.redo();
    }
  })({ code: options.source });
}
