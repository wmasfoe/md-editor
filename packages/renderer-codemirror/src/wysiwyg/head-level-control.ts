import type { EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";

/**
 * 标题层级重写辅助函数（供块操作菜单 block-toolbar 等模块复用）：
 * 计算行首 ATX marker 的重写编辑:level 1-6 换为对应 # 前缀,
 * level null 转段落(删除 marker + 分隔空白)。保留行首缩进。
 * 返回 null 表示该行不是 ATX 标题行。
 */
export function headingMarkerEdit(
  lineText: string,
  level: number | null,
): { readonly from: number; readonly to: number; readonly insert: string } | null {
  const match = /^(\s*)(#{1,6})(\s+)/u.exec(lineText);
  if (!match) {
    return null;
  }
  const markerFrom = match[1].length;
  const markerTo = markerFrom + match[2].length + match[3].length;
  return {
    from: markerFrom,
    to: markerTo,
    insert: level === null ? "" : `${"#".repeat(level)} `,
  };
}

/**
 * 重写行首 marker:level 1-6 换为对应 # 前缀,level null 转段落(删除 marker)
 */
export function setHeadingLevel(view: EditorView, lineFrom: number, level: number | null): boolean {
  const line = view.state.doc.lineAt(lineFrom);
  const edit = headingMarkerEdit(line.text, level);
  if (!edit) {
    return false;
  }
  view.dispatch({
    changes: { from: lineFrom + edit.from, to: lineFrom + edit.to, insert: edit.insert },
    userEvent: "input.heading-level",
    // 轮1 architect WATCH（concern-2）：重写受保护的 heading marker 必须授权
    //（本 helper 现无生产调用方，注解使其被接线时不会静默拒绝 —— 而非留地雷）。
    annotations: [authorizeWysiwygProtectedChange.of(true)],
  });
  view.focus();
  return true;
}
