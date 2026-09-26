/**
 * DocumentHistory：operation 级 undo/redo
 *
 * 记录 TextDocument 的每次编辑（insert/delete），按「输入组」提交：
 * 调用方在语义边界（模式切换、光标移动、保存、换行）调用 flush()，
 * 组内的连续击键一起撤销。撤销时把逆操作回放到文档上，回放期间不记录，
 * 因此 undo/redo 自身不会污染历史。
 */
import type { TextDocument } from "./text-document.ts";
import type { EditOp, EditRecorder } from "./operations.ts";

/** 把一组操作翻成逆操作（顺序反转：后面的操作先撤销） */
export function invertOps(ops: readonly EditOp[]): EditOp[] {
  const inverted: EditOp[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    inverted.push({
      kind: op.kind === "insert" ? "delete" : "insert",
      offset: op.offset,
      text: op.text,
    });
  }
  return inverted;
}

export class DocumentHistory implements EditRecorder {
  private readonly undoStack: EditOp[][] = [];
  private readonly redoStack: EditOp[][] = [];
  private pending: EditOp[] = [];

  constructor(private readonly doc: TextDocument) {}

  record(op: EditOp): void {
    this.pending.push(op);
  }

  /** 收尾当前输入组：有未提交编辑时压栈，并清空 redo */
  flush(): void {
    if (this.pending.length === 0) return;
    this.undoStack.push(this.pending);
    this.pending = [];
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.pending.length > 0 || this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    this.flush();
    const group = this.undoStack.pop();
    if (!group) return false;
    this.doc.applyOps(invertOps(group));
    this.redoStack.push(group);
    return true;
  }

  redo(): boolean {
    this.flush();
    const group = this.redoStack.pop();
    if (!group) return false;
    this.doc.applyOps(group);
    this.undoStack.push(group);
    return true;
  }
}
