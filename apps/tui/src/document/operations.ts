/**
 * 文档编辑操作（undo/redo 的最小记录单元）
 *
 * 每个操作都携带「撤销所需的信息」：insert 的逆是删除同一段文本，
 * delete 的逆是把被删除的文本插回原处。offset 为编辑发生前的文档偏移。
 */
export type EditOp =
  | { kind: "insert"; offset: number; text: string }
  | { kind: "delete"; offset: number; text: string };

/** 编辑记录器接口（undo 栈实现之，文档在每次编辑后回调） */
export interface EditRecorder {
  record(op: EditOp): void;
}
