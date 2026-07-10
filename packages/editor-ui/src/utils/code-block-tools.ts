import { $prose } from "@milkdown/kit/utils";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from "@milkdown/kit/prose/view";

const tabText = "  ";
const svgNamespace = "http://www.w3.org/2000/svg";

export const codeLanguageOptions = [
  { label: "Plain Text", value: "" },
  { label: "Bash", value: "bash" },
  { label: "C", value: "c" },
  { label: "C#", value: "csharp" },
  { label: "C++", value: "cpp" },
  { label: "CSS", value: "css" },
  { label: "Go", value: "go" },
  { label: "HTML", value: "html" },
  { label: "Java", value: "java" },
  { label: "JavaScript", value: "javascript" },
  { label: "JSON", value: "json" },
  { label: "JSX", value: "jsx" },
  { label: "Markdown", value: "markdown" },
  { label: "MDX", value: "mdx" },
  { label: "Text", value: "text" },
  { label: "Python", value: "python" },
  { label: "Ruby", value: "ruby" },
  { label: "Rust", value: "rust" },
  { label: "Shell", value: "shell" },
  { label: "Swift", value: "swift" },
  { label: "TSX", value: "tsx" },
  { label: "TypeScript", value: "typescript" },
  { label: "YAML", value: "yaml" },
] as const;

const languageSuggestionValues = codeLanguageOptions.map((option) => option.value).filter(Boolean);
const codeBlockToolsPluginKey = new PluginKey("md-editor-code-block-tools");
const calloutToneLabels = {
  info: "Info",
  warning: "Warning",
  success: "Success",
  danger: "Danger",
} as const;
type CalloutTone = keyof typeof calloutToneLabels;

export interface IndentPlan {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function createCodeBlockToolsProsePlugin(): Plugin {
  return new Plugin({
    key: codeBlockToolsPluginKey,
    state: {
      init: (_, state) => buildActiveCodeBlockDecoration(state),
      apply(transaction, _decoration, _previousState, nextState) {
        // 蓝色焦点描边必须跟随 ProseMirror 选区，而不是 DOM focus；
        // 代码块控件获得焦点时，不代表代码源码本身处于编辑态。
        return buildActiveCodeBlockDecoration(nextState);
      },
    },
    props: {
      decorations(state) {
        return codeBlockToolsPluginKey.getState(state) as DecorationSet | undefined;
      },
      handleKeyDown(view, event) {
        if (handleCalloutPreviewDeleteKey(view, event)) {
          return true;
        }

        if (handleCodeBlockSelectAll(view, event)) {
          return true;
        }

        if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }

        const plan = planCodeBlockTabIndent(
          view.state.selection.$from.parent.type.name,
          view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"),
          view.state.selection.from,
          view.state.selection.to,
          event.shiftKey,
        );
        if (!plan) {
          return false;
        }

        event.preventDefault();
        const transaction = view.state.tr.insertText(plan.text, plan.from, plan.to);
        const nextPosition = plan.from + plan.text.length;
        view.dispatch(
          transaction.setSelection(TextSelection.create(transaction.doc, nextPosition)),
        );
        return true;
      },
      nodeViews: {
        code_block: (node, view, getPos) => new MarkdownCodeBlockNodeView(node, view, getPos),
      },
    },
  });
}

export const codeBlockToolsPlugin = $prose(createCodeBlockToolsProsePlugin);

export function planCodeBlockTabIndent(
  parentTypeName: string,
  selectedText: string,
  from: number,
  to: number,
  outdent = false,
): IndentPlan | null {
  if (parentTypeName !== "code_block") {
    return null;
  }

  if (from === to) {
    return {
      from,
      to,
      text: outdent ? "" : tabText,
    };
  }

  const lines = selectedText.split("\n");
  const text = lines
    .map((line) => {
      if (!outdent) {
        return `${tabText}${line}`;
      }
      if (line.startsWith(tabText)) {
        return line.slice(tabText.length);
      }
      return line.startsWith("\t") ? line.slice(1) : line;
    })
    .join("\n");

  return { from, to, text };
}

export function findCurrentCodeBlockTextRange(
  state: EditorState,
): { from: number; to: number } | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection)) {
    return null;
  }

  const { $from, $to } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "code_block") {
      continue;
    }

    if (parseCalloutPreviewSource(node.textContent)) {
      return null;
    }

    if ($to.depth < depth || !$to.node(depth).eq(node)) {
      return null;
    }

    const from = $from.before(depth) + 1;
    return {
      from,
      to: from + node.content.size,
    };
  }

  return null;
}

export function getLanguageSuggestions(input: string): readonly string[] {
  const query = input.trim().toLowerCase();
  if (!query) {
    return languageSuggestionValues.slice(0, 6);
  }

  return sortCopy(
    languageSuggestionValues
      .map((language) => ({
        language,
        score: fuzzyScore(language, query),
      }))
      .filter((item) => item.score > 0),
    (left, right) => right.score - left.score || left.language.localeCompare(right.language),
  )
    .slice(0, 6)
    .map((item) => item.language);
}

function sortCopy<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  return Array.prototype.sort.call([...values], compare) as T[];
}

export function findAdjacentCalloutPreviewNodePosition(
  state: EditorState,
  direction: "forward" | "backward",
): number | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const $from = selection.$from;
  if ($from.depth === 0) {
    const node = direction === "forward" ? $from.nodeAfter : $from.nodeBefore;
    if (!isCalloutPreviewCodeBlockNode(node)) {
      return null;
    }
    return direction === "forward" ? selection.from : selection.from - node.nodeSize;
  }

  if (direction === "forward") {
    if ($from.parentOffset !== $from.parent.content.size) {
      return null;
    }
    const afterParentPosition = $from.after($from.depth);
    return isCalloutPreviewCodeBlockNode(state.doc.nodeAt(afterParentPosition))
      ? afterParentPosition
      : null;
  }

  if ($from.parentOffset !== 0) {
    return null;
  }
  const beforeParentPosition = $from.before($from.depth);
  const nodeBefore = state.doc.resolve(beforeParentPosition).nodeBefore;
  if (!isCalloutPreviewCodeBlockNode(nodeBefore)) {
    return null;
  }

  return beforeParentPosition - nodeBefore.nodeSize;
}

export function findCurrentCalloutPreviewNodePosition(state: EditorState): number | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (isCalloutPreviewCodeBlockNode(node)) {
      return $from.before(depth);
    }
  }

  return null;
}

export function isCalloutPreviewCodeBlockNode(
  node: ProseMirrorNode | null | undefined,
): node is ProseMirrorNode {
  return Boolean(
    node && node.type.name === "code_block" && parseCalloutPreviewSource(node.textContent),
  );
}

function handleCalloutPreviewDeleteKey(view: EditorView, event: KeyboardEvent): boolean {
  if (
    !(event.key === "Backspace" || event.key === "Delete") ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return false;
  }

  const selection = view.state.selection;
  if (selection instanceof NodeSelection && isCalloutPreviewCodeBlockNode(selection.node)) {
    event.preventDefault();
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  }

  const position =
    findCurrentCalloutPreviewNodePosition(view.state) ??
    findAdjacentCalloutPreviewNodePosition(
      view.state,
      event.key === "Delete" ? "forward" : "backward",
    );
  if (position === null) {
    return false;
  }

  event.preventDefault();
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)).scrollIntoView(),
  );
  view.focus();
  return true;
}

function handleCodeBlockSelectAll(view: EditorView, event: KeyboardEvent): boolean {
  // 只恢复普通代码块内的编辑器式全选：Mod-a 只选当前代码块文本。
  // 段落、图片、Callout preview 和跨块选区仍交给 ProseMirror 默认全文全选路径。
  if (
    event.key.toLowerCase() !== "a" ||
    !(event.metaKey || event.ctrlKey) ||
    event.altKey ||
    event.shiftKey
  ) {
    return false;
  }

  const range = findCurrentCodeBlockTextRange(view.state);
  if (!range) {
    return false;
  }

  event.preventDefault();
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, range.from, range.to))
      .scrollIntoView(),
  );
  return true;
}

function buildActiveCodeBlockDecoration(state: EditorState): DecorationSet {
  const range = findCurrentCodeBlockTextRange(state);
  if (!range) {
    return DecorationSet.empty;
  }

  const nodePosition = range.from - 1;
  return DecorationSet.create(state.doc, [
    Decoration.node(nodePosition, range.to + 1, {
      class: "md-code-block--active",
    }),
  ]);
}

function fuzzyScore(value: string, query: string): number {
  if (value === query) {
    return 100;
  }
  if (value.startsWith(query)) {
    return 80 - (value.length - query.length);
  }
  if (value.includes(query)) {
    return 60 - value.indexOf(query);
  }

  let lastIndex = -1;
  let score = 0;
  for (const char of query) {
    const index = value.indexOf(char, lastIndex + 1);
    if (index === -1) {
      return 0;
    }
    score += Math.max(1, 12 - (index - lastIndex));
    lastIndex = index;
  }

  return score;
}

class MarkdownCodeBlockNodeView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private copyResetTimer = 0;
  private readonly copyButton: HTMLButtonElement;
  private readonly lineNumbers: HTMLElement;
  private readonly languageControl: HTMLElement;
  private readonly languageSelect: HTMLSelectElement;
  private readonly pre: HTMLPreElement;
  private readonly code: HTMLElement;
  private readonly rawHeader: HTMLElement;
  private readonly rawTitle: HTMLElement;
  private readonly rawHint: HTMLElement;
  private readonly calloutPreview: HTMLElement;
  private readonly calloutEyebrow: HTMLElement;
  private readonly calloutTitle: HTMLElement;
  private readonly calloutBody: HTMLElement;
  private readonly codeBodyWrap: HTMLElement;
  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node;
    const ownerDocument = view.dom.ownerDocument;

    this.dom = ownerDocument.createElement("div");
    this.copyButton = ownerDocument.createElement("button");
    this.lineNumbers = ownerDocument.createElement("div");
    this.languageControl = ownerDocument.createElement("div");
    this.languageSelect = ownerDocument.createElement("select");
    this.rawHeader = ownerDocument.createElement("div");
    this.rawTitle = ownerDocument.createElement("div");
    this.rawHint = ownerDocument.createElement("div");
    this.calloutPreview = ownerDocument.createElement("div");
    this.calloutEyebrow = ownerDocument.createElement("span");
    this.calloutTitle = ownerDocument.createElement("strong");
    this.calloutBody = ownerDocument.createElement("div");
    this.codeBodyWrap = ownerDocument.createElement("div");
    this.pre = ownerDocument.createElement("pre");
    this.code = ownerDocument.createElement("code");
    this.contentDOM = this.code;

    this.dom.className = "md-code-block";
    this.lineNumbers.className = "md-code-block-line-numbers";
    this.lineNumbers.contentEditable = "false";
    this.lineNumbers.setAttribute("aria-hidden", "true");

    this.rawHeader.className = "md-raw-block-header";
    this.rawHeader.contentEditable = "false";
    this.rawTitle.className = "md-raw-block-title";
    this.rawHint.className = "md-raw-block-hint";
    this.rawHint.textContent = "Raw source is preserved unless edited here.";
    this.rawHeader.append(this.rawTitle, this.rawHint);

    this.calloutPreview.className = "md-callout-preview";
    this.calloutPreview.contentEditable = "false";
    this.calloutEyebrow.className = "md-callout-preview-eyebrow";
    this.calloutTitle.className = "md-callout-preview-title";
    this.calloutBody.className = "md-callout-preview-body";
    this.calloutPreview.append(this.calloutEyebrow, this.calloutTitle, this.calloutBody);

    this.codeBodyWrap.className = "md-code-block-body";
    this.codeBodyWrap.append(this.rawHeader);

    this.code.className = "md-code-block-content";
    this.code.spellcheck = false;
    this.code.setAttribute("spellcheck", "false");
    this.code.setAttribute("autocorrect", "off");
    this.code.setAttribute("autocapitalize", "off");

    this.copyButton.className = "md-code-block-copy";
    this.copyButton.type = "button";
    this.copyButton.contentEditable = "false";
    this.copyButton.dataset.copied = "false";
    this.copyButton.title = "Copy code block";
    this.copyButton.setAttribute("aria-label", "Copy code block");
    this.copyButton.append(createCopyIcon(ownerDocument), createCheckIcon(ownerDocument));

    this.languageControl.className = "md-code-block-language-control";
    this.languageControl.contentEditable = "false";
    this.languageSelect.className = "md-code-block-language-select";
    this.languageSelect.setAttribute("aria-label", "Code block language");
    this.populateLanguageOptions();
    this.languageControl.append(this.languageSelect);

    this.pre.append(this.code);
    this.codeBodyWrap.append(this.pre);
    this.dom.append(
      this.calloutPreview,
      this.lineNumbers,
      this.codeBodyWrap,
      this.copyButton,
      this.languageControl,
    );

    this.copyButton.addEventListener("click", this.handleCopyClick);
    this.languageSelect.addEventListener("change", this.handleLanguageChange);

    this.syncLanguage();
    this.syncRawBlockChrome();
    this.syncLineNumbers();
  }

  private syncLineNumbers() {
    const lineCount = Math.max(1, this.node.textContent.split("\n").length);
    const lines = Array.from({ length: lineCount }, (_, index) => {
      const line = this.dom.ownerDocument.createElement("span");
      line.className = "md-code-block-line-number";
      line.textContent = String(index + 1);
      return line;
    });

    this.lineNumbers.replaceChildren(...lines);
  }

  update(nextNode: ProseMirrorNode) {
    if (nextNode.type !== this.node.type) {
      return false;
    }

    this.node = nextNode;
    this.syncLanguage();
    this.syncRawBlockChrome();
    this.syncLineNumbers();

    return true;
  }

  stopEvent(event: Event) {
    return (
      targetIsInside(event.target, this.copyButton) ||
      targetIsInside(event.target, this.languageControl) ||
      targetIsInside(event.target, this.calloutPreview)
    );
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return (
      mutation.target === this.dom ||
      mutation.target === this.pre ||
      mutation.target === this.lineNumbers ||
      targetIsInside(mutation.target, this.copyButton) ||
      targetIsInside(mutation.target, this.lineNumbers) ||
      targetIsInside(mutation.target, this.languageControl) ||
      targetIsInside(mutation.target, this.rawHeader) ||
      targetIsInside(mutation.target, this.calloutPreview)
    );
  }

  destroy() {
    this.copyButton.removeEventListener("click", this.handleCopyClick);
    this.languageSelect.removeEventListener("change", this.handleLanguageChange);
    if (this.copyResetTimer) {
      this.dom.ownerDocument.defaultView?.clearTimeout(this.copyResetTimer);
    }
  }

  private populateLanguageOptions() {
    for (const language of codeLanguageOptions) {
      const option = this.dom.ownerDocument.createElement("option");
      option.value = language.value;
      option.textContent = language.label;
      this.languageSelect.append(option);
    }
  }

  private syncLanguage() {
    const language = normalizeCodeLanguage(this.node.attrs.language);
    this.syncCustomLanguageOption(language);
    this.languageSelect.value = language;

    if (language) {
      this.dom.dataset.language = language;
    } else {
      delete this.dom.dataset.language;
    }
  }

  private syncRawBlockChrome() {
    const rawBlock = parseManagedRawBlockLanguage(this.node.attrs.language);
    if (!rawBlock) {
      delete this.dom.dataset.rawBlock;
      this.rawTitle.textContent = "";
      this.syncCalloutPreview();
      return;
    }

    this.dom.dataset.rawBlock = rawBlock.kind;
    this.rawTitle.textContent = rawBlock.title;
    this.syncCalloutPreview();
  }

  private syncCalloutPreview() {
    const callout = parseCalloutPreviewSource(this.node.textContent);
    if (!callout) {
      delete this.dom.dataset.calloutPreview;
      this.calloutEyebrow.textContent = "";
      this.calloutTitle.textContent = "";
      this.calloutBody.textContent = "";
      return;
    }

    this.dom.dataset.calloutPreview = callout.type;
    this.calloutEyebrow.textContent = callout.type.toUpperCase();
    this.calloutTitle.textContent = callout.title || calloutToneLabels[callout.type];
    this.calloutBody.textContent = callout.children || "内容";
  }

  private syncCustomLanguageOption(language: string) {
    this.languageSelect.querySelector("[data-md-code-custom-language='true']")?.remove();
    if (!language || codeLanguageOptions.some((option) => option.value === language)) {
      return;
    }

    const option = this.dom.ownerDocument.createElement("option");
    option.value = language;
    option.textContent = language;
    option.dataset.mdCodeCustomLanguage = "true";
    this.languageSelect.append(option);
  }

  private readonly handleLanguageChange = () => {
    const position = this.getPos();
    if (typeof position !== "number") {
      return;
    }

    const language = normalizeCodeLanguage(this.languageSelect.value);
    if (language === normalizeCodeLanguage(this.node.attrs.language)) {
      return;
    }

    this.view.dispatch(this.view.state.tr.setNodeAttribute(position, "language", language));
  };

  private readonly handleCopyClick = (event: MouseEvent) => {
    event.preventDefault();
    void this.copyCode();
  };

  private async copyCode() {
    try {
      await this.dom.ownerDocument.defaultView?.navigator.clipboard?.writeText(
        this.node.textContent,
      );
      this.showCopiedState();
    } catch {
      // Clipboard access can be unavailable in restricted previews.
    }
  }

  private showCopiedState() {
    if (this.copyResetTimer) {
      this.dom.ownerDocument.defaultView?.clearTimeout(this.copyResetTimer);
    }

    this.copyButton.dataset.copied = "true";
    this.copyButton.title = "Code copied";
    this.copyButton.setAttribute("aria-label", "Code copied");
    this.copyResetTimer =
      this.dom.ownerDocument.defaultView?.setTimeout(() => {
        this.copyButton.dataset.copied = "false";
        this.copyButton.title = "Copy code block";
        this.copyButton.setAttribute("aria-label", "Copy code block");
        this.copyResetTimer = 0;
      }, 1400) ?? 0;
  }
}

export function normalizeCodeLanguage(language: unknown) {
  return typeof language === "string"
    ? language
        .trim()
        .replace(/[\s`]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
    : "";
}

function parseManagedRawBlockLanguage(
  language: unknown,
): { readonly kind: string; readonly title: string } | null {
  if (typeof language !== "string") {
    return null;
  }

  const normalized = language.trim().toLowerCase();
  if (normalized.includes("md-editor-frontmatter")) {
    return { kind: "frontmatter", title: "Frontmatter" };
  }
  if (normalized.includes("md-editor-callout")) {
    return { kind: "callout", title: "Callout" };
  }
  if (normalized.includes("md-editor-mdx")) {
    return { kind: "mdx", title: "MDX Component" };
  }

  return null;
}

export function parseCalloutPreviewSource(source: string): {
  readonly type: CalloutTone;
  readonly title: string;
  readonly children: string;
} | null {
  const normalized = source.trim();
  const match =
    /^<Callout(?<props>[^>]*)>(?<children>[\s\S]*)<\/Callout>$/u.exec(normalized) ??
    /^<Callout(?<props>[^>]*)\/>$/u.exec(normalized);
  const propsSource = match?.groups?.props;
  if (propsSource === undefined) {
    return null;
  }

  const props = parseSimpleJsxStringProps(propsSource);
  const type = isCalloutTone(props.type) ? props.type : "info";
  return {
    type,
    title: props.title ?? "",
    children: (match?.groups?.children ?? "").trim(),
  };
}

function parseSimpleJsxStringProps(propsSource: string): Record<string, string> {
  const props: Record<string, string> = {};
  const propPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/gu;

  for (const match of propsSource.matchAll(propPattern)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      props[name] = value;
    }
  }

  return props;
}

function isCalloutTone(value: string | undefined): value is CalloutTone {
  return value === "info" || value === "warning" || value === "success" || value === "danger";
}

function targetIsInside(target: EventTarget | Node | null, container: HTMLElement) {
  return target instanceof Node && container.contains(target);
}

function createCopyIcon(ownerDocument: Document): SVGSVGElement {
  const svg = createSvgIcon(ownerDocument, "md-code-block-copy-icon");
  const back = ownerDocument.createElementNS(svgNamespace, "rect");
  back.setAttribute("x", "8");
  back.setAttribute("y", "8");
  back.setAttribute("width", "14");
  back.setAttribute("height", "14");
  back.setAttribute("rx", "2");
  const front = ownerDocument.createElementNS(svgNamespace, "path");
  front.setAttribute("d", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2");
  svg.append(back, front);
  return svg;
}

function createCheckIcon(ownerDocument: Document): SVGSVGElement {
  const svg = createSvgIcon(ownerDocument, "md-code-block-copy-check-icon");
  const path = ownerDocument.createElementNS(svgNamespace, "path");
  path.setAttribute("d", "M20 6 9 17l-5-5");
  svg.append(path);
  return svg;
}

function createSvgIcon(ownerDocument: Document, className: string): SVGSVGElement {
  const svg = ownerDocument.createElementNS(svgNamespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add(className);
  return svg;
}
