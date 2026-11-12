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
  EditorState,
  type Extension,
  Prec,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { trailingLineBreakEnd } from "../blocks/block-replacement.ts";
import { authorizeWysiwygProtectedChange } from "../state/change-authorization.ts";
import { wysiwygProjectionField } from "../state/projection-field.ts";
import {
  clearWysiwygAtomSelectionEffect,
  setVirtualTrailingLineActiveEffect,
  virtualTrailingLineActiveField,
} from "../state/types.ts";
import { editorModeField } from "../../mode.ts";
import type { MarkdownRangeRecord } from "@md-editor/plugin-sdk/syntax";
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
  "quote",
  "list-item-ordered",
  "list-item-unordered",
]);

function coversDocumentEnd(record: MarkdownRangeRecord, state: EditorState): boolean {
  return (
    (TERMINAL_BLOCK_KINDS.has(record.kind) || record.renderPolicy === "directive-panel") &&
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
 * 当前主选区是否「站在」虚拟空行上：空光标停在 `doc.length`，且此处需要虚拟空行。
 *
 * 无尾随换行时，HTML、插件面板和引用/列表的 `doc.length` 仍属于可编辑内容，
 * 不能仅凭偏移自动激活，否则会收起源码或阻断容器内续写。
 * 点击落脚行或 ArrowDown 会显式激活；有尾随换行时该偏移已在块外。
 */
export function caretRestsOnVirtualTrailingLine(state: EditorState): boolean {
  const selection = state.selection;
  if (selection.ranges.length !== 1) {
    return false;
  }
  const main = selection.main;
  if (!main.empty || main.head !== state.doc.length) {
    return false;
  }
  if (!needsVirtualTrailingLine(state)) {
    return false;
  }
  const index = state.field(markdownRangeIndexField, false);
  const terminal = index?.records.findLast((record) => coversDocumentEnd(record, state));
  if (!terminal) {
    return true;
  }
  const caretInsideSource =
    (terminal.interactionPolicy === "reveal-source" ||
      terminal.renderPolicy === "marker-hidden" ||
      terminal.renderPolicy === "directive-panel") &&
    terminal.fullRange.to >= state.doc.length;
  return !caretInsideSource;
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

/** 虚拟空行的 class。e2e 与外部样式只依赖这两个类名，不依赖具体 DOM 结构。 */
export const VIRTUAL_TRAILING_LINE_CLASS = "cm-virtual-trailing-line";
export const VIRTUAL_TRAILING_LINE_ACTIVE_CLASS = "cm-virtual-trailing-line--active";

/**
 * 构建虚拟空行装饰。
 *
 * 首选：在 `doc.length` 放一个 `Decoration.line`，给 CM6 自己在文末合成的那一行加 class。
 * 整行块级替换（表格 / HTML / 分割线 / MDX 等）`inclusiveEnd` 为 false，不覆盖其后位置，
 * CM6 构建结束时会在块下方补一个空 `.cm-line`。这一行是文末**唯一的文本落脚点**：
 * 浏览器的光标只能落在可编辑文本节点里，CM6 写 DOM 选区（`inlineDOMNearPos`）也只找文本行。
 * 复用它，块下方只有一行，光标也天然画在这一行里。两种「自己再造一行」的做法都实测踩过：
 * - 叠一个块 widget：块下方出现两个空行；
 * - 用零长度两端 inclusive 的 replace 把合成行吃掉：文末没有文本行，`doc.length` 的光标被映射回
 *   上方最近的文本行，Cmd/Ctrl+End 后键入的字写到块的**前面**。
 *
 * 退路：块的最后一行是它自己的真实文本行时（Frontmatter 的闭合 `---`、setext 标题的下划线，
 * 且文档无尾随换行），`doc.length` 不在行首，CM6 不合成空行，行装饰会落在块自己的行上而不可见。
 * 这时补一个 `side: 1` 的块 widget 作为可见占位。它前面没有整行替换，CM6 不会再补空行，
 * 所以仍然只有一行；光标停在块的最后一行行尾，键入由物化处理器写成块下方的独立段落。
 */
function buildVirtualTrailingLineDecorations(state: EditorState): DecorationSet {
  if (!needsVirtualTrailingLine(state)) {
    return Decoration.none;
  }
  const isActive = state.field(virtualTrailingLineActiveField, false) ?? false;
  const className = isActive
    ? `${VIRTUAL_TRAILING_LINE_CLASS} ${VIRTUAL_TRAILING_LINE_ACTIVE_CLASS}`
    : VIRTUAL_TRAILING_LINE_CLASS;
  const end = state.doc.length;
  const endsOnLineStart = state.doc.lineAt(end).from === end;
  // 只有块此刻真的以整行替换呈现时，CM6 才会在其后合成空行。
  // HTML 块被光标展开成源码时不是替换，而是带行装饰的真实源码行；此时行装饰会落在源码最后一行上，
  // 没有可复用的合成行，必须走占位 widget。
  if (endsOnLineStart || documentEndIsCoveredByWholeLineReplacement(state)) {
    return Decoration.set([
      Decoration.line({ class: className, attributes: { "data-virtual-line": "true" } }).range(end),
    ]);
  }
  return Decoration.set([
    Decoration.widget({
      widget: new VirtualTrailingLinePlaceholder(isActive),
      side: 1,
      block: true,
    }).range(end),
  ]);
}

/**
 * 文末是否落在整行块级替换的覆盖范围里（替换到 `doc.length` 为止）。
 * 这类块下面 CM6 一定会合成空行，行装饰会落在合成行上，不需要占位 widget。
 */
function documentEndIsCoveredByWholeLineReplacement(state: EditorState): boolean {
  const projection = state.field(wysiwygProjectionField, false);
  let covered = false;
  // Inspect the actual layout, so nested and third-party blocks share the same
  // rule without maintaining a second list of concrete plugin node kinds.
  projection?.layoutDecorations.between(0, state.doc.length, (from, to, value) => {
    if (from < to && to === state.doc.length && value.spec.block && value.spec.widget)
      covered = true;
  });
  return covered;
}

/**
 * 文末占位行：只在块的最后一行是真实文本行（无合成行可复用）时使用。
 * 光标由 CM6 画在块的最后一行行尾；这里只提供一行可见、可点击的空白。
 */
class VirtualTrailingLinePlaceholder extends WidgetType {
  constructor(readonly isActive: boolean) {
    super();
  }

  override eq(other: VirtualTrailingLinePlaceholder): boolean {
    return this.isActive === other.isActive;
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = this.isActive
      ? `${VIRTUAL_TRAILING_LINE_CLASS} ${VIRTUAL_TRAILING_LINE_ACTIVE_CLASS}`
      : VIRTUAL_TRAILING_LINE_CLASS;
    dom.setAttribute("data-virtual-line", "true");
    dom.setAttribute("role", "presentation");
    // 与普通 .cm-line 同高：放一个 <br> 撑出一行的行高。
    dom.appendChild(document.createElement("br"));
    return dom;
  }

  override ignoreEvent(event: Event): boolean {
    // mousedown 交给 virtualTrailingLineDOMHandlers 统一处理（点亮并把光标放到文末）。
    return event.type !== "mousedown";
  }
}

/**
 * 驱动虚拟空行行装饰挂载与更新的 StateField。
 */
export const virtualTrailingLineDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildVirtualTrailingLineDecorations(state),
  update: (_decorations, tr) => buildVirtualTrailingLineDecorations(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 虚拟空行主题。它就是一行普通 `.cm-line`，高度与光标都交给 CM6，不加 margin / padding，
 * 以免破坏高度图（见「CM6 高度图与点击落点保真规范」）。
 */
export const virtualTrailingLineTheme: Extension = EditorView.baseTheme({
  [`.${VIRTUAL_TRAILING_LINE_CLASS}`]: {
    cursor: "text",
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

/** 主键点在虚拟空行这一行上（不含 Shift 扩展选区）。 */
function isClickOnVirtualTrailingLine(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey) {
    return false;
  }
  if (!needsVirtualTrailingLine(view.state)) {
    return false;
  }
  const target = event.target;
  return (
    target instanceof Element &&
    view.contentDOM.contains(target) &&
    target.closest(`.${VIRTUAL_TRAILING_LINE_CLASS}`) !== null
  );
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
    // 点在虚拟空行上，或点在它下方的编辑器留白：都是“我要在块下面写东西”。
    // 必须显式点亮：HTML 块贴文末且无尾随换行时，`doc.length` 在源码闭区间内，
    // 光标跟随的自动点亮会把它判为“在编辑源码”而跳过。
    if (!isClickOnVirtualTrailingLine(view, event) && !isClickBelowDocument(view, event)) {
      return false;
    }
    placeCaretAtDocumentEnd(view);
    event.preventDefault();
    return true;
  },
});

/**
 * 激活态跟着光标走：任何事务结束时，只要光标站在虚拟空行上（见
 * `caretRestsOnVirtualTrailingLine`），就点亮它。
 *
 * 为什么不能只在点击 / ArrowDown 时点亮：物化处理器只在激活态下接管键入。
 * 激活态没点亮时，光标停在 `doc.length` 再打字，字由浏览器写进 CM6 在文末合成的那一行，
 * 解析器把它当作块的延续，表格会多出一行。会让光标停在 `doc.length` 却不点亮的路径包括：
 * Cmd/Ctrl+End、Cmd/Ctrl+ArrowDown、程序化设置选区、撤销物化（文档变回去，光标回到文末）、
 * 按 Escape 取消激活。
 *
 * 所以这里不区分事务来源，**只看结果**：光标站在虚拟行上 ⇒ 虚拟行是激活的。
 * 熄灭不需要单独处理：光标一离开 `doc.length` 或文档末尾不再需要虚拟行，结果自然为假。
 *
 * Escape 原本用来“取消激活”。在这条规则下它不再有效（光标仍在虚拟行上），
 * 对应键位已移除：取消激活的唯一方式是把光标移开。
 */
const armVirtualTrailingLineOnCaret = EditorState.transactionExtender.of((transaction) => {
  if (!transaction.selection && !transaction.docChanged) {
    return null;
  }
  const state = transaction.state;
  const shouldBeActive = caretRestsOnVirtualTrailingLine(state);
  // 本事务里显式写的值优先作为“当前值”，避免与它重复或相反。
  let current = state.field(virtualTrailingLineActiveField, false) === true;
  for (const effect of transaction.effects) {
    if (effect.is(setVirtualTrailingLineActiveEffect)) {
      current = effect.value;
    }
  }
  if (!shouldBeActive || current) {
    return null;
  }
  return { effects: setVirtualTrailingLineActiveEffect.of(true) };
});

/**
 * 文末虚拟空行完整扩展包。
 */
export const virtualTrailingLineExtension: Extension = [
  virtualTrailingLineActiveField,
  armVirtualTrailingLineOnCaret,
  virtualTrailingLineDecorationField,
  virtualTrailingLineTheme,
  virtualTrailingLineKeymap,
  virtualTrailingLineInputHandler,
  virtualTrailingLinePasteHandler,
  virtualTrailingLineDOMHandlers,
];
