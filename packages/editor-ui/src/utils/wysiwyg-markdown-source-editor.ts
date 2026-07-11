import type {
  WysiwygMarkdownSourceKind,
  WysiwygMarkdownSourceTarget,
} from "./wysiwyg-markdown-source";
import { isEscapedCharacter } from "./wysiwyg-markdown-link-draft";

type SourceEditorLayout = WysiwygMarkdownSourceTarget["layout"];
type WysiwygMarkdownSourceSegmentRole = "marker" | "content" | "destination" | "source";

export interface WysiwygMarkdownSourceSegment {
  readonly role: WysiwygMarkdownSourceSegmentRole;
  readonly text: string;
}

export function createSourceEditorDom(
  ownerDocument: Document,
  layout: SourceEditorLayout,
): HTMLElement {
  const dom = ownerDocument.createElement(layout === "block" ? "div" : "span");
  dom.className = `md-wysiwyg-markdown-source md-wysiwyg-markdown-source--${layout}`;
  dom.contentEditable = "true";
  dom.spellcheck = false;
  dom.setAttribute("role", "textbox");
  dom.setAttribute("aria-label", "Markdown source");
  return dom;
}

export function createSourceEditorShell(
  ownerDocument: Document,
  layout: SourceEditorLayout,
): HTMLElement {
  const shell = ownerDocument.createElement(layout === "block" ? "div" : "span");
  shell.className = `md-wysiwyg-source-editor-shell md-wysiwyg-source-editor-shell--${layout}`;

  // Atomic ProseMirror NodeViews must own a non-editable root. The nested editor
  // then becomes the browser's editing host instead of leaking keys to NodeSelection.
  shell.contentEditable = "false";
  return shell;
}

/** Keeps the serialized text intact while assigning visual roles to its parts. */
export function segmentWysiwygMarkdownSource(
  kind: WysiwygMarkdownSourceKind,
  source: string,
): readonly WysiwygMarkdownSourceSegment[] {
  if (kind === "heading") {
    const match = /^(#{1,6}\s+)([\s\S]*)$/u.exec(source);
    if (match) {
      return [
        { role: "marker", text: match[1] },
        { role: "content", text: match[2] },
      ];
    }
  }

  if (kind === "inlineCode") {
    const opening = /^(`+)/u.exec(source)?.[1];
    if (opening && source.endsWith(opening) && source.length >= opening.length * 2) {
      return [
        { role: "marker", text: opening },
        { role: "content", text: source.slice(opening.length, -opening.length) },
        { role: "marker", text: opening },
      ];
    }
  }

  if (kind === "link" || kind === "image") {
    const prefix = kind === "image" ? "![" : "[";
    const labelEnd = findUnescapedSequence(source, "](", prefix.length);
    if (source.startsWith(prefix) && labelEnd >= 0 && source.endsWith(")")) {
      return [
        { role: "marker", text: prefix },
        { role: "content", text: source.slice(prefix.length, labelEnd) },
        { role: "marker", text: "](" },
        { role: "destination", text: source.slice(labelEnd + 2, -1) },
        { role: "marker", text: ")" },
      ];
    }
  }

  const delimiter = getPairedDelimiter(kind, source);
  if (delimiter) {
    return [
      { role: "marker", text: delimiter },
      { role: "content", text: source.slice(delimiter.length, -delimiter.length) },
      { role: "marker", text: delimiter },
    ];
  }

  return [{ role: "source", text: source }];
}

export function renderSegmentedSourceEditorText(
  dom: HTMLElement,
  kind: WysiwygMarkdownSourceKind,
  source: string,
): void {
  setSourceEditorKind(dom, kind, source);

  const fragment = dom.ownerDocument.createDocumentFragment();
  for (const segment of segmentWysiwygMarkdownSource(kind, source)) {
    const span = dom.ownerDocument.createElement("span");
    span.className = `md-wysiwyg-markdown-source__${segment.role}`;
    span.textContent = segment.text;
    fragment.append(span);
  }
  dom.replaceChildren(fragment);
}

export function renderPlainSourceEditorText(
  dom: HTMLElement,
  kind: WysiwygMarkdownSourceKind,
  source: string,
): void {
  setSourceEditorKind(dom, kind, source);
  dom.textContent = source;
}

export function flattenSourceEditorText(dom: HTMLElement): void {
  if (dom.childNodes.length === 1 && dom.firstChild?.nodeType === 3) {
    return;
  }

  const source = readSourceEditorText(dom);
  const selectionOffset = getSourceEditorSelectionOffset(dom);
  dom.textContent = source;
  dom.classList.add("md-wysiwyg-markdown-source--editing");
  setSourceEditorSelectionOffset(dom, selectionOffset);
}

export function readSourceEditorText(dom: HTMLElement): string {
  return (dom.textContent ?? "").replace(/\u00a0/gu, " ");
}

export function getSourceEditorSelectionOffset(dom: HTMLElement): number {
  const selection = dom.ownerDocument.getSelection();
  if (!selection?.anchorNode || !dom.contains(selection.anchorNode)) {
    return readSourceEditorText(dom).length;
  }

  const range = dom.ownerDocument.createRange();
  range.selectNodeContents(dom);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

export function setSourceEditorSelectionOffset(dom: HTMLElement, requestedOffset: number): void {
  const selection = dom.ownerDocument.getSelection();
  if (!selection) {
    return;
  }

  const offset = Math.max(0, Math.min(requestedOffset, readSourceEditorText(dom).length));
  const range = dom.ownerDocument.createRange();
  let remaining = offset;
  let targetNode: Node = dom;
  let targetOffset = 0;
  for (const textNode of collectTextNodes(dom)) {
    const length = textNode.data.length;
    if (remaining <= length) {
      targetNode = textNode;
      targetOffset = remaining;
      break;
    }
    remaining -= length;
    targetNode = textNode;
    targetOffset = length;
  }

  range.setStart(targetNode, targetOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setSourceEditorKind(
  dom: HTMLElement,
  kind: WysiwygMarkdownSourceKind,
  source: string,
): void {
  dom.dataset.sourceKind = kind;
  if (kind === "heading") {
    dom.dataset.headingLevel = String(/^#{1,6}/u.exec(source)?.[0].length ?? 1);
  } else {
    delete dom.dataset.headingLevel;
  }
}

function findUnescapedSequence(source: string, sequence: string, from: number): number {
  for (
    let index = source.indexOf(sequence, from);
    index >= 0;
    index = source.indexOf(sequence, index + 1)
  ) {
    if (!isEscapedCharacter(source, index)) {
      return index;
    }
  }
  return -1;
}

function getPairedDelimiter(kind: WysiwygMarkdownSourceKind, source: string): string | null {
  const candidates =
    kind === "strong"
      ? ["**", "__"]
      : kind === "emphasis"
        ? ["*", "_"]
        : kind === "strikethrough"
          ? ["~~"]
          : [];
  return (
    candidates.find((candidate) => source.startsWith(candidate) && source.endsWith(candidate)) ??
    null
  );
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      nodes.push(child as Text);
    } else {
      nodes.push(...collectTextNodes(child));
    }
  }
  return nodes;
}
