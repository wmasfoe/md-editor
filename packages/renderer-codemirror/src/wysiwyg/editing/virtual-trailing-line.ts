/**
 * @file virtual-trailing-line.ts
 * @description 文档末尾虚拟空行（Virtual Trailing Line）管理。
 *
 * ## 为什么需要文末虚拟空行
 *
 * 1. 在 WYSIWYG 模式下，若文档以整行块级替换组件（HTML 块、表格、分割线、MDX 组件等）
 *    结尾，且源码中该组件下方没有留真实空行，由于整行块级替换装饰器覆盖到文档末尾（`doc.length`），
 *    组件下方没有任何 `.cm-line` 文本节点；
 * 2. 当用户选中该原子组件时，为了防止视觉错觉，系统已抑制组件边缘下方的游离光标；
 * 3. 此时若没有虚拟空行，用户将无法在组件下方点击或换行续写正文，只能切换到源码模式手动补换行，
 *    严重影响编辑流畅度。
 *
 * ## 核心不可变量契约
 *
 * 1. **零磁盘/存储污染（Zero Disk Pollution）**：
 *    虚拟空行纯属展示层与交互引导，未实际输入前 `state.doc` **保持 0 字节增加**。
 *    任何保存（Save / Export / Snapshot）均以用户原始内容为准，绝不擅自追加无用换行。
 * 2. **精准触发（Deterministic Gating）**：
 *    若文档末尾**已有可见真实空行**：**绝不渲染**虚拟空行；
 *    若文档末尾**无空行**：精准挂载 `VirtualTrailingLineWidget`。
 * 3. **即时物化（JIT Materialization）**：
 *    用户在虚拟空行上键入文字或粘贴时，由 `inputHandler` 即时派发单次事务，补全必要前导换行
 *    并插入内容，无缝转变为真实文档行。
 * 4. **高度图与盒模型契约**：
 *    虚拟行只允许使用 `padding` 与 `min-height` 保证高度测量，**严禁使用 margin**，
 *    杜绝破坏 CodeMirror 6 高度图导致光标落点偏差。
 */

import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { trailingLineBreakEnd } from "../blocks/block-replacement.ts";
import { authorizeWysiwygProtectedChange } from "../state/change-authorization.ts";
import {
  clearWysiwygAtomSelectionEffect,
  setVirtualTrailingLineActiveEffect,
  virtualTrailingLineActiveField,
} from "../state/types.ts";
import { editorModeField } from "../../mode.ts";
import { isAtomSelection } from "./code-block-selection.ts";

/**
 * 判断当前文档是否需要渲染文末虚拟空行。
 */
export function needsVirtualTrailingLine(state: EditorState): boolean {
  // 源码模式下由 CodeMirror 原生纯文本行体系管理，不挂载 WYSIWYG 虚拟空行
  if (state.field(editorModeField, false) === "source") {
    return false;
  }
  // 空文档边界：CM6 默认提供首行真实空行供编辑
  if (state.doc.length === 0) {
    return false;
  }

  // 1. 检查末尾整行块级替换组件（HTML 块、表格、分割线、MDX 组件、Frontmatter 等）
  // 整行块级替换装饰会吞并相邻紧随的一个换行，若 replacementTo 等于 doc.length，
  // 说明下方没有任何可见文本行，必须渲染虚拟空行
  const index = state.field(markdownRangeIndexField, false);
  if (index) {
    for (const record of index.records) {
      if (
        record.kind === "html" ||
        record.kind === "table" ||
        record.kind === "thematic-break" ||
        record.kind === "mdx-jsx" ||
        record.kind === "frontmatter" ||
        record.kind === "heading-setext"
      ) {
        const replacementTo = trailingLineBreakEnd(record, state);
        if (replacementTo === state.doc.length) {
          return true;
        }
      }
    }
  }

  // 2. 检查普通文本末行是否为非空行：若末尾已有空行（length === 0）则无需渲染，反之需要渲染
  const lastLine = state.doc.line(state.doc.lines);
  return lastLine.length > 0;
}

/**
 * 计算将虚拟空行物化为真实文档行时需要补充的前导换行符。
 */
export function calculateMaterializationPrefix(state: EditorState): string {
  const doc = state.doc;
  const index = state.field(markdownRangeIndexField, false);
  const isAfterBlock = index?.records.some(
    (r) =>
      (r.kind === "html" ||
        r.kind === "table" ||
        r.kind === "thematic-break" ||
        r.kind === "mdx-jsx" ||
        r.kind === "frontmatter" ||
        r.kind === "heading-setext") &&
      trailingLineBreakEnd(r, state) === doc.length,
  );

  // 块级组件后需保持 Markdown 空行隔离，避免紧随文本被解析器吸收进块内
  if (isAfterBlock) {
    if (doc.sliceString(Math.max(0, doc.length - 2)) === "\n\n") {
      return "";
    }
    if (doc.sliceString(Math.max(0, doc.length - 1)) === "\n") {
      return "\n";
    }
    return "\n\n";
  }

  // 普通文本行末尾只需补一个单换行
  if (doc.sliceString(Math.max(0, doc.length - 1)) === "\n") {
    return "";
  }
  return "\n";
}

/**
 * 文末虚拟空行展示 Widget。
 */
export class VirtualTrailingLineWidget extends WidgetType {
  constructor(readonly isActive: boolean) {
    super();
  }

  eq(other: VirtualTrailingLineWidget): boolean {
    return this.isActive === other.isActive;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-virtual-trailing-line";
    dom.setAttribute("role", "presentation");
    dom.setAttribute("data-virtual-line", "true");

    const content = document.createElement("div");
    content.className = "cm-virtual-trailing-line__content";

    if (this.isActive) {
      dom.classList.add("cm-virtual-trailing-line--active");
      const cursor = document.createElement("span");
      cursor.className = "cm-cursor cm-cursor-primary cm-virtual-cursor";
      cursor.setAttribute("role", "presentation");
      content.appendChild(cursor);
    }

    // 挂载 br 撑开与标准 .cm-line 完全一致的基线高度
    const br = document.createElement("br");
    content.appendChild(br);
    dom.appendChild(content);

    dom.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      view.dispatch({
        selection: EditorSelection.cursor(view.state.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
        userEvent: "select",
      });
      view.focus();
    });

    return dom;
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    dom.classList.toggle("cm-virtual-trailing-line--active", this.isActive);
    const content = dom.querySelector(".cm-virtual-trailing-line__content");
    const cursor = dom.querySelector(".cm-virtual-cursor");
    if (this.isActive && !cursor && content) {
      const newCursor = document.createElement("span");
      newCursor.className = "cm-cursor cm-cursor-primary cm-virtual-cursor";
      newCursor.setAttribute("role", "presentation");
      content.prepend(newCursor);
    } else if (!this.isActive && cursor) {
      cursor.remove();
    }
    return true;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown";
  }
}

/**
 * 驱动虚拟空行 Block Widget 挂载与更新的 StateField。
 */
export const virtualTrailingLineDecorationField = StateField.define<DecorationSet>({
  create(state) {
    if (!needsVirtualTrailingLine(state)) {
      return Decoration.none;
    }
    const isActive = state.field(virtualTrailingLineActiveField, false) ?? false;
    return Decoration.set([
      Decoration.widget({
        widget: new VirtualTrailingLineWidget(isActive),
        side: 1,
        block: true,
      }).range(state.doc.length),
    ]);
  },
  update(decorations, tr) {
    if (!needsVirtualTrailingLine(tr.state)) {
      return Decoration.none;
    }
    const isActive = tr.state.field(virtualTrailingLineActiveField, false) ?? false;
    return Decoration.set([
      Decoration.widget({
        widget: new VirtualTrailingLineWidget(isActive),
        side: 1,
        block: true,
      }).range(tr.state.doc.length),
    ]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 虚拟空行盒模型与光标主题：严格遵循高度图契约，只用 padding，严禁 margin。
 */
export const virtualTrailingLineTheme: Extension = EditorView.baseTheme({
  ".cm-virtual-trailing-line": {
    boxSizing: "border-box",
    minHeight: "1.5em",
    padding: "0 4px",
    cursor: "text",
    userSelect: "none",
  },
  ".cm-virtual-trailing-line__content": {
    display: "flex",
    alignItems: "center",
    minHeight: "1.5em",
    lineHeight: "inherit",
  },
  ".cm-virtual-trailing-line .cm-virtual-cursor": {
    position: "relative",
    display: "inline-block",
    height: "1.2em",
    borderLeft: "1.2px solid currentColor",
    marginLeft: "-0.6px",
    pointerEvents: "none",
    animation: "cm-blink 1.2s steps(1) infinite",
  },
});

/**
 * 当文末原子组件处于选中态时，按 Enter 退出原子并在下方创建空行继续书写。
 */
export function exitAtomAtEndOfDocument(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty || !isAtomSelection(state, sel)) {
    return false;
  }
  const index = state.field(markdownRangeIndexField, false);
  if (!index) return false;

  const record = index.records.find(
    (r) => r.fullRange.from === sel.from && r.fullRange.to === sel.to,
  );
  if (!record) return false;

  // 仅在原子位于文档末尾时接管
  const endPos = trailingLineBreakEnd(record, state);
  if (endPos !== state.doc.length) {
    return false;
  }

  const prefix = calculateMaterializationPrefix(state);
  const insertPos = state.doc.length;
  view.dispatch({
    changes: { from: insertPos, insert: prefix },
    selection: EditorSelection.cursor(insertPos + prefix.length),
    effects: [
      clearWysiwygAtomSelectionEffect.of(null),
      setVirtualTrailingLineActiveEffect.of(false),
    ],
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });
  return true;
}

/**
 * 方向键下移进入虚拟空行。
 */
export function moveDownToVirtualTrailingLine(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!needsVirtualTrailingLine(state)) return false;

  // 场景 1：文末整块原子选中态按 ArrowDown，焦点下移至虚拟空行
  if (!sel.empty && isAtomSelection(state, sel)) {
    const index = state.field(markdownRangeIndexField, false);
    const record = index?.records.find(
      (r) => r.fullRange.from === sel.from && r.fullRange.to === sel.to,
    );
    if (record && trailingLineBreakEnd(record, state) === state.doc.length) {
      view.dispatch({
        selection: EditorSelection.cursor(record.fullRange.to),
        effects: [
          clearWysiwygAtomSelectionEffect.of(null),
          setVirtualTrailingLineActiveEffect.of(true),
        ],
        userEvent: "select",
      });
      return true;
    }
  }

  // 场景 2：光标位于文末最后一行行尾，按 ArrowDown 激活虚拟空行
  if (sel.empty && sel.head === state.doc.length) {
    const isActive = state.field(virtualTrailingLineActiveField, false);
    if (!isActive) {
      view.dispatch({
        effects: setVirtualTrailingLineActiveEffect.of(true),
        userEvent: "select",
      });
      return true;
    }
  }

  return false;
}

/**
 * 虚拟空行处于激活态时，按 ArrowUp 退回上一行或前置原子组件。
 */
export function moveUpFromVirtualTrailingLine(view: EditorView): boolean {
  const { state } = view;
  const isActive = state.field(virtualTrailingLineActiveField, false);
  if (!isActive) return false;

  const index = state.field(markdownRangeIndexField, false);
  if (index) {
    const prevRecord = index.records.find(
      (r) => trailingLineBreakEnd(r, state) === state.doc.length,
    );
    if (prevRecord) {
      view.dispatch({
        selection: EditorSelection.range(prevRecord.fullRange.from, prevRecord.fullRange.to),
        effects: [setVirtualTrailingLineActiveEffect.of(false)],
        userEvent: "select",
      });
      return true;
    }
  }

  const lastLine = state.doc.line(state.doc.lines);
  view.dispatch({
    selection: EditorSelection.cursor(lastLine.from),
    effects: [setVirtualTrailingLineActiveEffect.of(false)],
    userEvent: "select",
  });
  return true;
}

/**
 * 快捷键绑定集合。
 */
export const virtualTrailingLineKeymap: Extension = Prec.highest(
  keymap.of([
    {
      key: "Enter",
      run: (view) => {
        if (exitAtomAtEndOfDocument(view)) return true;
        if (view.state.field(virtualTrailingLineActiveField, false)) {
          const prefix = calculateMaterializationPrefix(view.state);
          const insertPos = view.state.doc.length;
          view.dispatch({
            changes: { from: insertPos, insert: prefix },
            selection: EditorSelection.cursor(insertPos + prefix.length),
            effects: [setVirtualTrailingLineActiveEffect.of(false)],
            annotations: [
              Transaction.addToHistory.of(true),
              authorizeWysiwygProtectedChange.of(true),
            ],
            userEvent: "input.type",
          });
          return true;
        }
        return false;
      },
    },
    {
      key: "ArrowDown",
      run: (view) => moveDownToVirtualTrailingLine(view),
    },
    {
      key: "ArrowUp",
      run: (view) => moveUpFromVirtualTrailingLine(view),
    },
    {
      key: "Escape",
      run: (view) => {
        if (view.state.field(virtualTrailingLineActiveField, false)) {
          view.dispatch({
            effects: setVirtualTrailingLineActiveEffect.of(false),
            userEvent: "select",
          });
          return true;
        }
        return false;
      },
    },
  ]),
);

/**
 * 打字即时物化拦截器：当虚拟空行激活时，按键输入即时补齐换行并插入文本。
 */
export const virtualTrailingLineInputHandler = EditorView.inputHandler.of(
  (view, _from, _to, insert) => {
    if (view.composing || insert === "") {
      return false;
    }
    const isActive = view.state.field(virtualTrailingLineActiveField, false);
    if (!isActive) {
      return false;
    }

    const prefix = calculateMaterializationPrefix(view.state);
    const textToInsert = prefix + insert;
    const insertPos = view.state.doc.length;
    view.dispatch({
      changes: { from: insertPos, insert: textToInsert },
      selection: EditorSelection.cursor(insertPos + textToInsert.length),
      effects: [setVirtualTrailingLineActiveEffect.of(false)],
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.type",
    });
    return true;
  },
);

/**
 * 粘贴与 IME 组字物化支持，及滚动容器底部空白区单击激活。
 */
export const virtualTrailingLineDOMHandlers = EditorView.domEventHandlers({
  paste(event, view) {
    const isActive = view.state.field(virtualTrailingLineActiveField, false);
    if (!isActive) return false;

    const text = event.clipboardData?.getData("text/plain");
    if (!text) return false;

    const prefix = calculateMaterializationPrefix(view.state);
    const textToInsert = prefix + text;
    const insertPos = view.state.doc.length;
    view.dispatch({
      changes: { from: insertPos, insert: textToInsert },
      selection: EditorSelection.cursor(insertPos + textToInsert.length),
      effects: [setVirtualTrailingLineActiveEffect.of(false)],
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.paste",
    });
    event.preventDefault();
    return true;
  },
  compositionstart(_event, view) {
    const isActive = view.state.field(virtualTrailingLineActiveField, false);
    if (!isActive) return false;

    // CJK 输入法组字开始时物化前导换行，确保浏览器有真实 DOM 选区锚点
    const prefix = calculateMaterializationPrefix(view.state);
    if (prefix.length > 0) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: prefix },
        selection: EditorSelection.cursor(view.state.doc.length + prefix.length),
        effects: [setVirtualTrailingLineActiveEffect.of(false)],
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      });
    }
    return false;
  },
  mousedown(event, view) {
    if (event.button !== 0) return false;
    if (needsVirtualTrailingLine(view.state)) {
      const target = event.target as HTMLElement | null;
      if (
        target?.classList.contains("cm-scroller") ||
        target?.classList.contains("cm-editor") ||
        target?.classList.contains("cm-content")
      ) {
        const content = view.contentDOM;
        const contentBox = content.getBoundingClientRect();
        // 用户点击了文档最下方空白区（低于最后一行元素）
        if (event.clientY > contentBox.bottom - 4) {
          view.dispatch({
            selection: EditorSelection.cursor(view.state.doc.length),
            effects: setVirtualTrailingLineActiveEffect.of(true),
            userEvent: "select",
          });
          view.focus();
          event.preventDefault();
          return true;
        }
      }
    }
    return false;
  },
});

/**
 * 文末虚拟空行完整扩展包。
 */
export const virtualTrailingLineExtension: Extension = [
  virtualTrailingLineActiveField,
  virtualTrailingLineDecorationField,
  virtualTrailingLineTheme,
  virtualTrailingLineKeymap,
  virtualTrailingLineInputHandler,
  virtualTrailingLineDOMHandlers,
];
