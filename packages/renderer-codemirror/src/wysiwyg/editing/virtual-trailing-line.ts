/**
 * @file virtual-trailing-line.ts
 * @description 文档末尾虚拟空行（Virtual Trailing Line）管理。
 *
 * ## 为什么需要文末虚拟空行
 *
 * 1. 在 WYSIWYG 模式下，若文档以整行块级替换组件（HTML 块、表格、分割线、MDX 组件等）
 *    结尾，且源码中该组件下方没有留真实空行，整行块级替换装饰器覆盖到文档末尾（`doc.length`），
 *    组件下方没有文档自己的行。CM6 会合成一个空 `.cm-line` 顶上，但它不是安全的落脚点：
 *    光标停在上面键入，字符会被块的解析吞进去（接在表格最后一格后，或成为表格新的一行）；
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
 *    只在整行块级替换盖住文档末尾、下面没有文档自己的行时挂载，并且取代 CM6 合成的那一行，
 *    块下方始终只有一个落脚行。
 *    普通末行仍用原生行尾光标，点击文末空白是续写当前段，不是新起一行。
 *    内容盒的下内边距（编辑器底部留白，不是左右侧栏）也算文末：光标落到最后一行；
 *    虚拟空行出现时，这一下命中的就是虚拟空行。
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
import type { MarkdownRangeRecord } from "../../markdown/range-types.ts";
import { convertHtmlToMarkdown, shouldConvertClipboardHtml } from "../input/smart-paste.ts";
import { isAtomSelection } from "./code-block-selection.ts";

/** 整行替换会吞掉自己下方那一行的块。只有这些块贴在 EOF 时才需要虚拟空行。 */
const TERMINAL_BLOCK_KINDS: ReadonlySet<MarkdownRangeRecord["kind"]> = new Set([
  "html",
  "table",
  "thematic-break",
  "mdx-jsx",
  "frontmatter",
  "heading-setext",
]);

function coversDocumentEnd(record: MarkdownRangeRecord, state: EditorState): boolean {
  return (
    TERMINAL_BLOCK_KINDS.has(record.kind) &&
    trailingLineBreakEnd(record, state) === state.doc.length
  );
}

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

  const index = state.field(markdownRangeIndexField, false);
  if (!index) {
    return false;
  }
  return index.records.some((record) => coversDocumentEnd(record, state));
}

/**
 * 计算将虚拟空行物化为真实文档行时需要补充的前导换行符。
 */
export function calculateMaterializationPrefix(state: EditorState): string {
  const doc = state.doc;
  const index = state.field(markdownRangeIndexField, false);
  const isAfterBlock = index?.records.some((record) => coversDocumentEnd(record, state));

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
      placeCaretAtDocumentEnd(view);
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
 * 构建虚拟空行装饰：零长度、两端 inclusive 的块级 replace，位置在 `doc.length`。
 *
 * 为什么不是 `Decoration.widget({ block: true })`：
 * CM6 视图构建器在两处会给「没有被块 widget 覆盖的位置」补一个空的 `.cm-line`：
 *   ① 放置 `startSide > 0` 的块 widget 之前（`side: 1` 的普通 widget 属此类）；
 *   ② 构建结束时，若末尾位置未被覆盖（`blockPosCovered()` 为假）。
 * 整行块级替换（表格 / HTML / 分割线 / MDX 等）`inclusiveEnd` 为 false，不覆盖其后的位置，
 * 所以普通 widget 无论放在 `side: 1`（空行在它前面）还是 `side: -1`（空行在它后面），
 * 都会与那一行并存，用户看到两个空行。两种放法都实测过。
 *
 * 零长度 replace 的四种 inclusive 组合实测（表格结尾的文档，块下方的行序）：
 *   start=true  end=true  → 虚拟行                  ← 唯一只剩一个落脚行的组合
 *   start=true  end=false → 虚拟行 → 空 .cm-line    （没有 IncEnd，② 仍补一行）
 *   start=false end=true  → 空 .cm-line → 虚拟行    （startSide > 0，① 仍补一行）
 *   start=false end=false → CM6 抛 "Invalid range for replacement decoration"
 * 所以两端都必须是 true：`startSide < 0` 不触发 ①，`IncEnd` 让 `blockPosCovered()` 为真不触发 ②。
 */
function buildVirtualTrailingLineDecorations(state: EditorState): DecorationSet {
  if (!needsVirtualTrailingLine(state)) {
    return Decoration.none;
  }
  const isActive = state.field(virtualTrailingLineActiveField, false) ?? false;
  return Decoration.set([
    Decoration.replace({
      widget: new VirtualTrailingLineWidget(isActive),
      block: true,
      inclusiveStart: true,
      inclusiveEnd: true,
    }).range(state.doc.length),
  ]);
}

/**
 * 驱动虚拟空行 Block Widget 挂载与更新的 StateField。
 */
export const virtualTrailingLineDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildVirtualTrailingLineDecorations(state),
  update: (_decorations, tr) => buildVirtualTrailingLineDecorations(tr.state),
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
    if (record && coversDocumentEnd(record, state)) {
      // 光标放到 doc.length，而不是块的 to。to 仍落在 HTML 闭区间内，会把预览拆开。
      view.dispatch({
        selection: EditorSelection.cursor(state.doc.length),
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
function virtualTrailingLineIsActive(view: EditorView): boolean {
  return view.state.field(virtualTrailingLineActiveField, false) === true;
}

export const virtualTrailingLineKeymap: Extension = Prec.highest(
  keymap.of([
    {
      key: "Enter",
      run: (view) => {
        if (exitAtomAtEndOfDocument(view)) return true;
        // 虚拟行本身就是空行。单独按 Enter 不写入换行，避免干净文件被空行污染。
        return virtualTrailingLineIsActive(view);
      },
    },
    {
      key: "Backspace",
      run: (view) => virtualTrailingLineIsActive(view),
    },
    {
      key: "Delete",
      run: (view) => virtualTrailingLineIsActive(view),
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
      key: "ArrowLeft",
      run: (view) =>
        virtualTrailingLineIsActive(view) ? moveUpFromVirtualTrailingLine(view) : false,
    },
    {
      key: "Escape",
      run: (view) => {
        if (!virtualTrailingLineIsActive(view)) {
          return false;
        }
        view.dispatch({
          effects: setVirtualTrailingLineActiveEffect.of(false),
          userEvent: "select",
        });
        return true;
      },
    },
  ]),
);

/**
 * 把虚拟空行物化成真实文本。prefix 与正文在同一事务里，undo 一次就能一起撤回。
 */
export function materializeVirtualTrailingLine(
  view: EditorView,
  inserted: string,
  userEvent: string,
): boolean {
  if (!virtualTrailingLineIsActive(view)) {
    return false;
  }
  const prefix = calculateMaterializationPrefix(view.state);
  const text = prefix + inserted;
  const insertPos = view.state.doc.length;
  view.dispatch({
    changes: text.length > 0 ? { from: insertPos, insert: text } : undefined,
    selection: EditorSelection.cursor(insertPos + text.length),
    effects: [setVirtualTrailingLineActiveEffect.of(false)],
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent,
  });
  return true;
}

/**
 * 打字即时物化拦截器：当虚拟空行激活时，按键输入即时补齐换行并插入文本。
 */
export const virtualTrailingLineInputHandler = EditorView.inputHandler.of(
  (view, _from, _to, insert) => {
    if (view.composing || insert === "") {
      return false;
    }
    return materializeVirtualTrailingLine(view, insert, "input.type");
  },
);

/** 组字开始时写入的前导换行。取消组字且没有上屏文字时把它撤掉。 */
const pendingImePrefix = new WeakMap<EditorView, { from: number; to: number }>();

function isShiftPaste(event: Event): boolean {
  // ClipboardEvent 的类型定义没有 shiftKey，部分浏览器仍会带上这次按键状态。
  const shiftKey = (event as { shiftKey?: boolean }).shiftKey;
  return shiftKey === true;
}

function pastedTextForVirtualLine(clipboard: DataTransfer, shiftKey: boolean): string {
  const plain = clipboard.getData("text/plain");
  if (shiftKey) {
    return plain;
  }
  const html = clipboard.getData("text/html");
  if (html.trim() && shouldConvertClipboardHtml(clipboard)) {
    const converted = convertHtmlToMarkdown(html);
    if (converted) {
      return converted;
    }
  }
  return plain;
}

/**
 * 粘贴与 IME 组字物化支持，及滚动容器底部空白区单击激活。
 */
export const virtualTrailingLinePasteHandler = Prec.highest(
  EditorView.domEventHandlers({
    paste(event, view) {
      if (!virtualTrailingLineIsActive(view)) {
        return false;
      }
      const clipboard = event.clipboardData;
      if (!clipboard) {
        return false;
      }
      const text = pastedTextForVirtualLine(clipboard, isShiftPaste(event));
      if (!text) {
        return false;
      }
      event.preventDefault();
      return materializeVirtualTrailingLine(view, text, "input.paste");
    },
  }),
);

/**
 * 把光标放到文档末尾。虚拟空行开启时同时点亮它，文档本身不改。
 * 选区移动不进撤销栈，避免点一下留白就占掉一次撤销。
 */
function placeCaretAtDocumentEnd(view: EditorView): void {
  view.dispatch({
    selection: EditorSelection.cursor(view.state.doc.length),
    effects: setVirtualTrailingLineActiveEffect.of(needsVirtualTrailingLine(view.state)),
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select",
  });
  view.focus();
}

/**
 * 点击是否落在最后一行之下的编辑器留白。
 * `.cm-content` 有 `min-height: 100%` 和下内边距，盒子底边包含留白，
 * 不能拿它和点击坐标比。最后一行（含虚拟空行）的底边才是正文终点。
 */
function isClickBelowDocument(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey) {
    return false;
  }
  const content = view.contentDOM;
  const contentBox = content.getBoundingClientRect();
  if (event.clientX < contentBox.left || event.clientX > contentBox.right) {
    return false;
  }
  const lastBottom = lastDocumentChildBottom(content);
  if (lastBottom === null || event.clientY <= lastBottom) {
    return false;
  }
  const scrollerBox = view.scrollDOM.getBoundingClientRect();
  return event.clientY <= Math.max(contentBox.bottom, scrollerBox.bottom);
}

function lastDocumentChildBottom(content: HTMLElement): number | null {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of content.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const childBottom = child.getBoundingClientRect().bottom;
    if (childBottom > bottom) {
      bottom = childBottom;
    }
  }
  return Number.isFinite(bottom) ? bottom : null;
}

export const virtualTrailingLineDOMHandlers = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    if (!virtualTrailingLineIsActive(view)) return false;

    // 组字需要真实 DOM 选区。前导换行用 compose.start，后续 compose 会并进同一次 undo。
    const from = view.state.doc.length;
    const prefix = calculateMaterializationPrefix(view.state);
    if (prefix.length === 0) {
      return false;
    }
    materializeVirtualTrailingLine(view, "", "input.type.compose.start");
    pendingImePrefix.set(view, { from, to: view.state.doc.length });
    return false;
  },
  compositionend(event, view) {
    const pending = pendingImePrefix.get(view);
    pendingImePrefix.delete(view);
    if (!pending || event.data) {
      return false;
    }
    if (view.state.doc.length !== pending.to || pending.to <= pending.from) {
      return false;
    }
    view.dispatch({
      changes: { from: pending.from, to: pending.to, insert: "" },
      selection: EditorSelection.cursor(pending.from),
      effects: [setVirtualTrailingLineActiveEffect.of(true)],
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.type.compose",
    });
    return false;
  },
  mousedown(event, view) {
    if (!isClickBelowDocument(view, event)) {
      return false;
    }
    // 文末留白：光标落到最后一行。虚拟空行存在时，这一行就是虚拟空行。
    placeCaretAtDocumentEnd(view);
    event.preventDefault();
    return true;
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
  virtualTrailingLinePasteHandler,
  virtualTrailingLineDOMHandlers,
];
