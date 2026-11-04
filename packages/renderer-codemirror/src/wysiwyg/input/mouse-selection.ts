/**
 * @file mouse-selection.ts
 * @description 解决行内标记（如 **加粗**）在首次点击展开时引发的意外文本选中问题。
 *
 * 第一性原理分析：
 * 1. 当文档首次打开或未聚焦时，行内源码标记（**、*、~~、`）默认处于折叠隐藏状态（`Decoration.replace`）。
 * 2. 用户在文本上单击时，`mousedown` 阶段计算得到初始光标位置 `start.pos`。
 * 3. 光标落入标记区间触发 `visibleMarkdownMarksPlugin`，导致 `**` 展开并插入 DOM。
 * 4. DOM 节点的突然展开导致光标右侧的文本向右偏移。
 * 5. 用户释放鼠标触发 `mouseup` 时，CodeMirror 默认的 `basicMouseSelection` 会在相同的屏幕物理坐标上
 *    再次调用 `posAndSideAtCoords` 得到 `cur.pos`。由于文本在 DOM 中发生了偏移，此时 `cur.pos` 与 `start.pos`
 *    产生偏移（差 1~2 字符）。
 * 6. `basicMouseSelection` 判断 `start.pos != cur.pos`，错误地将这一由于 DOM 展开引起的坐标变化识别为“用户拖拽”，
 *    从而生成了意外的范围选中（如选中了 `.1`）。
 *
 * 解决方案：
 * 通过 `EditorView.mouseSelectionStyle` 注册自定义鼠标选区决策：
 * 记录鼠标按下的屏幕坐标 `(startX, startY)`。只有当鼠标实际移动距离超过拖拽阈值（例如 3px）时，才视为拖拽选择；
 * 如果鼠标物理位移未达到阈值（即用户的真实意图为单击点击），则始终以 `start.pos` 作为选区位置，
 * 彻底消除由于 DOM 装饰展开排版位移带来的意外选区。
 */

import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

/** 判定鼠标位移为真实拖拽手势的像素阈值 */
export const DRAG_THRESHOLD_PX = 3;

/** 鼠标选区所需的视图最小上下文接口，便于无 DOM 环境单元测试 */
export interface MouseSelectionViewContext {
  state: EditorState;
  posAndSideAtCoords(
    coords: { x: number; y: number },
    precise?: boolean,
  ): { pos: number; assoc: number } | null;
}

/**
 * 针对鼠标按下事件构造选区决策处理器。
 */
export function createRobustMouseSelectionStyle(
  view: MouseSelectionViewContext,
  event: MouseEvent,
) {
  // 仅接管鼠标左键普通点击与选择
  if (event.button !== 0) {
    return null;
  }

  const startX = event.clientX;
  const startY = event.clientY;
  const start = view.posAndSideAtCoords({ x: startX, y: startY }, false);
  if (!start) {
    return null;
  }

  const type = event.detail; // 1: 单击, 2: 双击, 3: 三击
  let startSel = view.state.selection;

  return {
    update(update: ViewUpdate) {
      if (update.docChanged) {
        start.pos = update.changes.mapPos(start.pos);
        startSel = startSel.map(update.changes);
      }
    },
    get(curEvent: MouseEvent, extend: boolean, multiple: boolean) {
      const movedDistance = Math.hypot(curEvent.clientX - startX, curEvent.clientY - startY);
      const isActualDrag = movedDistance >= DRAG_THRESHOLD_PX;

      // 若鼠标未产生实质物理位移（纯单击或手震微抖），选区严格锚定在 start.pos，防止 DOM 展开位移被误判为拖拽
      const cur = isActualDrag
        ? (view.posAndSideAtCoords({ x: curEvent.clientX, y: curEvent.clientY }, false) ?? start)
        : start;

      let range: ReturnType<typeof EditorSelection.cursor>;
      if (type === 1) {
        // 单击光标
        range = EditorSelection.cursor(cur.pos, cur.assoc);
      } else if (type === 2) {
        // 双击选词
        const word = view.state.wordAt(cur.pos);
        range = word ? EditorSelection.range(word.from, word.to) : EditorSelection.cursor(cur.pos);
      } else {
        // 三击整行
        const line = view.state.doc.lineAt(cur.pos);
        let to = line.to;
        if (to < view.state.doc.length) {
          to++;
        }
        range = EditorSelection.range(line.from, to);
      }

      if (isActualDrag && start.pos !== cur.pos && !extend) {
        const from = Math.min(start.pos, cur.pos);
        const to = Math.max(start.pos, cur.pos);
        range = EditorSelection.range(from, to, cur.assoc);
      }

      if (extend) {
        return startSel.replaceRange(startSel.main.extend(range.from, range.to, range.assoc));
      }
      if (multiple) {
        return startSel.addRange(range);
      }
      return EditorSelection.create([range]);
    },
  };
}

/**
 * 创建防止行内标记展开抖动选中的鼠标选区扩展。
 */
export function createRobustMouseSelectionExtension(): Extension {
  return EditorView.mouseSelectionStyle.of(createRobustMouseSelectionStyle);
}
