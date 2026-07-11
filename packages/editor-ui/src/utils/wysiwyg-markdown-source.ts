import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { Mark, Node as ProseMirrorNode, Schema } from "@milkdown/kit/prose/model";
import type { MarkdownNode, Root } from "@milkdown/kit/transformer";
import {
  NodeSelection,
  type EditorState,
  type Selection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Mapping } from "@milkdown/kit/prose/transform";

export const wysiwygMarkdownSourceKinds = [
  "heading",
  "strong",
  "emphasis",
  "strikethrough",
  "link",
  "image",
  "inlineCode",
] as const;

export type WysiwygMarkdownSourceKind = (typeof wysiwygMarkdownSourceKinds)[number];
export type WysiwygMarkdownSourceLayout = "inline" | "block" | "image";
export type WysiwygMarkdownSourcePhase = "revealed" | "editing" | "invalid";
export type WysiwygMarkdownImagePreviewStatus = "idle" | "loading" | "loaded" | "failed";

export interface WysiwygMarkdownSourceTarget {
  readonly kind: WysiwygMarkdownSourceKind;
  readonly layout: WysiwygMarkdownSourceLayout;
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly sourceCursorOffset: number;
}

export interface WysiwygMarkdownSourceSession {
  readonly target: WysiwygMarkdownSourceTarget;
  readonly draft: string;
  readonly sourceCursorOffset: number;
  readonly phase: WysiwygMarkdownSourcePhase;
  readonly composing: boolean;
}

export interface WysiwygMarkdownSourceDraft {
  readonly id: string;
  readonly kind: WysiwygMarkdownSourceKind;
  readonly layout: WysiwygMarkdownSourceLayout;
  readonly source: string;
  readonly from: number;
  readonly to: number;
  readonly imagePreviewStatus: WysiwygMarkdownImagePreviewStatus;
}

export interface WysiwygMarkdownSourceReplacement {
  readonly content: ProseMirrorNode["content"];
  readonly block: boolean;
}

export type MarkdownDocumentSerializer = (doc: ProseMirrorNode) => string;
export type MarkdownDocumentParser = (source: string) => ProseMirrorNode | null;

export const wysiwygMarkdownInlineSourceNodeName = "wysiwyg_source_inline";
export const wysiwygMarkdownBlockSourceNodeName = "wysiwyg_source_block";
const wysiwygMarkdownSourcePreviewTag = "md-editor-wysiwyg-source";
let sourceDraftIdSequence = 0;

const sourceNodeAttrs = {
  draftId: { default: "" },
  kind: { default: "link" },
  source: { default: "" },
  originalSource: { default: "" },
  sourceCursorOffset: { default: 0 },
  imagePreviewSource: { default: "" },
  imagePreviewSrc: { default: "" },
  imagePreviewStatus: { default: "idle" },
};

export const wysiwygMarkdownInlineSourceSchema = $nodeSchema(
  wysiwygMarkdownInlineSourceNodeName,
  () => ({
    inline: true,
    group: "inline",
    atom: true,
    isolating: true,
    selectable: true,
    attrs: sourceNodeAttrs,
    parseDOM: [
      {
        tag: `[data-type="${wysiwygMarkdownInlineSourceNodeName}"]`,
        getAttrs: readSourceNodeDomAttrs,
      },
    ],
    toDOM: renderSourceNodeDom,
    parseMarkdown: {
      match: (node) => node.type === wysiwygMarkdownInlineSourceNodeName,
      runner: (state, node, type) => {
        state.addNode(type, readSourceMarkdownNodeAttrs(node));
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === wysiwygMarkdownInlineSourceNodeName,
      runner: (state, node) => {
        state.addNode("html", undefined, createSerializedSourceDraftMarker(node, "inline"));
      },
    },
  }),
);

export const wysiwygMarkdownBlockSourceSchema = $nodeSchema(
  wysiwygMarkdownBlockSourceNodeName,
  () => ({
    group: "block",
    atom: true,
    isolating: true,
    selectable: true,
    attrs: sourceNodeAttrs,
    parseDOM: [
      {
        tag: `[data-type="${wysiwygMarkdownBlockSourceNodeName}"]`,
        getAttrs: readSourceNodeDomAttrs,
      },
    ],
    toDOM: renderSourceNodeDom,
    parseMarkdown: {
      match: (node) => node.type === wysiwygMarkdownBlockSourceNodeName,
      runner: (state, node, type) => {
        state.addNode(type, readSourceMarkdownNodeAttrs(node));
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === wysiwygMarkdownBlockSourceNodeName,
      runner: (state, node) => {
        state.addNode("html", undefined, createSerializedSourceDraftMarker(node, "block"));
      },
    },
  }),
);

export const wysiwygMarkdownSourceSchemas = [
  wysiwygMarkdownInlineSourceSchema,
  wysiwygMarkdownBlockSourceSchema,
];

export interface WysiwygMarkdownSourceRemarkOptions {
  readonly drafts: readonly WysiwygMarkdownSourceDraft[];
}

export const wysiwygMarkdownSourcePreviewRemark = $remark(
  "wysiwyg-markdown-source-preview",
  () => (options: WysiwygMarkdownSourceRemarkOptions) => (tree: Root) => {
    restoreWysiwygMarkdownSourceDraftsInTree(tree, options.drafts);
  },
  { drafts: [] as readonly WysiwygMarkdownSourceDraft[] },
);

export function prepareWysiwygMarkdownSourceDraftsForPreview(
  markdown: string,
  drafts: readonly WysiwygMarkdownSourceDraft[],
): string {
  const reconciled = [...reconcileWysiwygMarkdownSourceDrafts(markdown, drafts)];
  // This array is newly allocated above; descending replacement keeps stored offsets stable.
  // oxlint-disable-next-line unicorn/no-array-sort
  reconciled.sort((left, right) => right.from - left.from);

  return reconciled.reduce(
    (prepared, draft) =>
      prepared.slice(0, draft.from) + createSourceDraftMarker(draft) + prepared.slice(draft.to),
    markdown,
  );
}

export function reconcileWysiwygMarkdownSourceDrafts(
  markdown: string,
  drafts: readonly WysiwygMarkdownSourceDraft[],
): readonly WysiwygMarkdownSourceDraft[] {
  return drafts
    .map((draft) => reconcileSourceDraftRange(markdown, draft))
    .filter((draft): draft is WysiwygMarkdownSourceDraft => Boolean(draft));
}

const supportedMarkNames = new Map<string, WysiwygMarkdownSourceKind>([
  ["inlineCode", "inlineCode"],
  ["link", "link"],
  ["strike_through", "strikethrough"],
  ["emphasis", "emphasis"],
  ["strong", "strong"],
]);
const markPriority = ["inlineCode", "link", "strike_through", "emphasis", "strong"];

export function findWysiwygMarkdownSourceTarget(
  state: EditorState,
  serialize: MarkdownDocumentSerializer,
  getAuthorImageSrc: (previewSrc: string) => string = (src) => src,
): WysiwygMarkdownSourceTarget | null {
  const { selection, schema } = state;

  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    const sourceNode = selection.node.type.create({
      ...selection.node.attrs,
      src: getAuthorImageSrc(String(selection.node.attrs.src ?? "")),
    });
    const paragraph = schema.nodes.paragraph?.create(null, sourceNode);
    if (!paragraph) {
      return null;
    }

    const source = trimSerializedSource(serialize(schema.nodes.doc.create(null, paragraph)));
    return {
      kind: "image",
      layout: "image",
      from: selection.from,
      to: selection.to,
      source,
      sourceCursorOffset: source.length,
    };
  }

  if (!selection.empty) {
    return null;
  }

  const { $head } = selection;
  if ($head.parent.type.name === "heading") {
    const from = $head.before();
    const node = $head.parent;
    const source = trimSerializedSource(
      serialize(schema.nodes.doc.create(null, node.copy(node.content))),
    );

    return {
      kind: "heading",
      layout: "block",
      from,
      to: from + node.nodeSize,
      source,
      sourceCursorOffset: mapTextOffsetToSource(source, node.textContent, $head.parentOffset),
    };
  }

  const markRange = findSupportedMarkRange($head.parent, $head.parentOffset);
  if (!markRange) {
    return null;
  }

  const from = $head.start() + markRange.from;
  const to = $head.start() + markRange.to;
  const paragraph = schema.nodes.paragraph?.create(null, state.doc.slice(from, to).content);
  if (!paragraph) {
    return null;
  }

  const source = trimSerializedSource(serialize(schema.nodes.doc.create(null, paragraph)));
  const textContent = state.doc.textBetween(from, to, "", "");
  return {
    kind: markRange.kind,
    layout: "inline",
    from,
    to,
    source,
    sourceCursorOffset: mapTextOffsetToSource(
      source,
      textContent,
      Math.max(0, Math.min(selection.head - from, textContent.length)),
    ),
  };
}

export function createWysiwygMarkdownSourceSession(
  target: WysiwygMarkdownSourceTarget,
): WysiwygMarkdownSourceSession {
  return {
    target,
    draft: target.source,
    sourceCursorOffset: target.sourceCursorOffset,
    phase: "revealed",
    composing: false,
  };
}

export function updateWysiwygMarkdownSourceDraft(
  session: WysiwygMarkdownSourceSession,
  draft: string,
  sourceCursorOffset: number,
): WysiwygMarkdownSourceSession {
  return {
    ...session,
    draft,
    sourceCursorOffset: clampSourceOffset(sourceCursorOffset, draft),
    phase: "editing",
  };
}

export function setWysiwygMarkdownSourceComposition(
  session: WysiwygMarkdownSourceSession,
  composing: boolean,
): WysiwygMarkdownSourceSession {
  return { ...session, composing };
}

export function markWysiwygMarkdownSourceInvalid(
  session: WysiwygMarkdownSourceSession,
): WysiwygMarkdownSourceSession {
  return { ...session, phase: "invalid" };
}

export function mapWysiwygMarkdownSourceSession(
  session: WysiwygMarkdownSourceSession,
  mapping: Mapping,
): WysiwygMarkdownSourceSession | null {
  const from = mapping.mapResult(session.target.from, 1);
  const to = mapping.mapResult(session.target.to, -1);
  if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos) {
    return null;
  }

  return {
    ...session,
    target: {
      ...session.target,
      from: from.pos,
      to: to.pos,
    },
  };
}

export function shouldCommitWysiwygMarkdownSourceSession(
  session: WysiwygMarkdownSourceSession,
  selection: Selection,
  viewComposing = false,
): boolean {
  if (session.composing || viewComposing || session.phase === "revealed") {
    return false;
  }

  return !selectionTouchesRange(selection, session.target.from, session.target.to);
}

export function resolveWysiwygMarkdownSourceReplacement(
  kind: WysiwygMarkdownSourceKind,
  source: string,
  parse: MarkdownDocumentParser,
): WysiwygMarkdownSourceReplacement | null {
  const parsed = parse(source);
  if (!parsed || parsed.childCount !== 1) {
    return null;
  }

  const block = parsed.firstChild;
  if (!block || containsRawSourceNode(parsed)) {
    return null;
  }

  if (kind === "heading") {
    return block.type.name === "heading" && isHeadingLevel(block.attrs.level)
      ? { content: parsed.content, block: true }
      : null;
  }

  if (block.type.name !== "paragraph") {
    return null;
  }

  if (kind === "image") {
    const image = block.firstChild;
    return block.childCount === 1 &&
      image?.type.name === "image" &&
      String(image.attrs.src ?? "").trim().length > 0
      ? { content: block.content, block: false }
      : null;
  }

  const expectedMarkName = getMarkName(kind);
  return expectedMarkName && documentIsEntirelyMarked(block, expectedMarkName)
    ? { content: block.content, block: false }
    : null;
}

export function replaceWysiwygMarkdownSourceTargetWithDraft(
  transaction: Transaction,
  target: WysiwygMarkdownSourceTarget,
  draft: string,
  sourceCursorOffset = draft.length,
): Transaction | null {
  const sourceNode = createWysiwygMarkdownSourceNode(
    transaction.doc.type.schema,
    target,
    draft,
    sourceCursorOffset,
  );
  if (!sourceNode) {
    return null;
  }

  transaction.replaceWith(target.from, target.to, sourceNode);
  return transaction.setSelection(NodeSelection.create(transaction.doc, target.from));
}

export function updateWysiwygMarkdownSourceNodeDraft(
  transaction: Transaction,
  position: number,
  source: string,
  sourceCursorOffset = source.length,
): Transaction | null {
  const node = transaction.doc.nodeAt(position);
  if (!node || !isWysiwygMarkdownSourceNode(node)) {
    return null;
  }

  return transaction.setNodeMarkup(position, undefined, {
    ...node.attrs,
    source,
    sourceCursorOffset: clampSourceOffset(sourceCursorOffset, source),
  });
}

export function updateWysiwygMarkdownImagePreviewState(
  transaction: Transaction,
  position: number,
  source: string,
  previewSrc: string,
  status: WysiwygMarkdownImagePreviewStatus,
): Transaction | null {
  const node = transaction.doc.nodeAt(position);
  if (!node || !isWysiwygMarkdownSourceNode(node) || node.attrs.kind !== "image") {
    return null;
  }

  if (
    node.attrs.imagePreviewSource === source &&
    node.attrs.imagePreviewSrc === previewSrc &&
    node.attrs.imagePreviewStatus === status
  ) {
    return null;
  }

  return transaction
    .setNodeMarkup(position, undefined, {
      ...node.attrs,
      imagePreviewSource: source,
      imagePreviewSrc: previewSrc,
      imagePreviewStatus: status,
    })
    .setMeta("addToHistory", false)
    .setMeta("md-editor-source-image-preview", true);
}

export function isWysiwygMarkdownImagePreviewReady(node: ProseMirrorNode, source: string): boolean {
  return (
    node.attrs.kind === "image" &&
    node.attrs.imagePreviewSource === source &&
    typeof node.attrs.imagePreviewSrc === "string" &&
    node.attrs.imagePreviewSrc.length > 0 &&
    node.attrs.imagePreviewStatus === "loaded"
  );
}

export function replaceWysiwygMarkdownSourceNodeWithParsed(
  transaction: Transaction,
  position: number,
  replacement: WysiwygMarkdownSourceReplacement,
): Transaction | null {
  const node = transaction.doc.nodeAt(position);
  if (!node || !isWysiwygMarkdownSourceNode(node)) {
    return null;
  }

  transaction.replaceWith(position, position + node.nodeSize, replacement.content);
  return transaction
    .setMeta("addToHistory", false)
    .setMeta("md-editor-source-session-commit", true);
}

export function isWysiwygMarkdownSourceNode(node: ProseMirrorNode): boolean {
  return (
    node.type.name === wysiwygMarkdownInlineSourceNodeName ||
    node.type.name === wysiwygMarkdownBlockSourceNodeName
  );
}

export function canStartWysiwygMarkdownSourceEdit(
  session: WysiwygMarkdownSourceSession,
  viewComposing = false,
): boolean {
  return !session.composing && !viewComposing;
}

export function trimSerializedSource(markdown: string): string {
  return markdown.replace(/\n+$/u, "");
}

export function mapTextOffsetToSource(
  source: string,
  textContent: string,
  textOffset: number,
): number {
  if (!textContent) {
    return clampSourceOffset(textOffset, source);
  }

  const textStart = source.indexOf(textContent);
  if (textStart === -1) {
    return clampSourceOffset(textOffset, source);
  }

  return clampSourceOffset(textStart + textOffset, source);
}

function findSupportedMarkRange(
  parent: ProseMirrorNode,
  parentOffset: number,
): { readonly kind: WysiwygMarkdownSourceKind; readonly from: number; readonly to: number } | null {
  const intervals = new Map<
    string,
    {
      readonly from: number;
      readonly to: number;
      readonly kind: WysiwygMarkdownSourceKind;
      readonly mark: Mark;
    }[]
  >();

  parent.forEach((child, offset) => {
    for (const mark of child.marks) {
      const kind = supportedMarkNames.get(mark.type.name);
      if (!kind) {
        continue;
      }

      const ranges = intervals.get(mark.type.name) ?? [];
      const previous = ranges.at(-1);
      const to = offset + child.nodeSize;
      if (previous?.to === offset && previous.mark.eq(mark)) {
        ranges[ranges.length - 1] = { ...previous, to };
      } else {
        ranges.push({ from: offset, to, kind, mark });
      }
      intervals.set(mark.type.name, ranges);
    }
  });

  for (const markName of markPriority) {
    const range = intervals
      .get(markName)
      ?.find(({ from, to }) => parentOffset >= from && parentOffset < to);
    if (range) {
      return range;
    }
  }

  return null;
}

function selectionTouchesRange(selection: Selection, from: number, to: number): boolean {
  if (selection instanceof NodeSelection) {
    return selection.from === from && selection.to === to;
  }
  return selection.from <= to && selection.to >= from;
}

function getMarkName(kind: WysiwygMarkdownSourceKind): string | null {
  switch (kind) {
    case "strong":
      return "strong";
    case "emphasis":
      return "emphasis";
    case "strikethrough":
      return "strike_through";
    case "link":
      return "link";
    case "inlineCode":
      return "inlineCode";
    default:
      return null;
  }
}

function documentIsEntirelyMarked(node: ProseMirrorNode, markName: string): boolean {
  if (node.childCount === 0) {
    return false;
  }

  let entirelyMarked = true;
  node.forEach((child) => {
    if (!child.marks.some((mark) => mark.type.name === markName)) {
      entirelyMarked = false;
    }
  });
  return entirelyMarked;
}

function containsRawSourceNode(node: ProseMirrorNode): boolean {
  let found = false;
  node.descendants((child) => {
    if (child.type.name === "wysiwyg_source_inline" || child.type.name === "wysiwyg_source_block") {
      found = true;
      return false;
    }
  });
  return found;
}

function createWysiwygMarkdownSourceNode(
  schema: Schema,
  target: WysiwygMarkdownSourceTarget,
  draft: string,
  sourceCursorOffset: number,
): ProseMirrorNode | null {
  const nodeName =
    target.layout === "block"
      ? wysiwygMarkdownBlockSourceNodeName
      : wysiwygMarkdownInlineSourceNodeName;
  const type = schema.nodes[nodeName];
  if (!type) {
    return null;
  }

  return type.create({
    draftId: createSourceDraftId(),
    kind: target.kind,
    source: draft,
    originalSource: target.source,
    sourceCursorOffset: clampSourceOffset(sourceCursorOffset, draft),
  });
}

function readSourceNodeDomAttrs(dom: HTMLElement | string) {
  if (typeof dom === "string") {
    return false;
  }
  return {
    draftId: dom.dataset.sourceDraftId ?? "",
    kind: dom.dataset.sourceKind ?? "link",
    source: dom.dataset.source ?? dom.textContent ?? "",
    originalSource: dom.dataset.originalSource ?? "",
    sourceCursorOffset: Number(dom.dataset.sourceCursorOffset ?? 0),
    imagePreviewSource: dom.dataset.imagePreviewSource ?? "",
    imagePreviewSrc: dom.dataset.imagePreviewSrc ?? "",
    imagePreviewStatus: dom.dataset.imagePreviewStatus ?? "idle",
  };
}

function renderSourceNodeDom(node: ProseMirrorNode) {
  const tag = node.type.name === wysiwygMarkdownBlockSourceNodeName ? "div" : "span";
  return [
    tag,
    {
      "data-type": node.type.name,
      "data-source-draft-id": String(node.attrs.draftId ?? ""),
      "data-source-kind": String(node.attrs.kind ?? "link"),
      "data-source": String(node.attrs.source ?? ""),
      "data-original-source": String(node.attrs.originalSource ?? ""),
      "data-source-cursor-offset": String(node.attrs.sourceCursorOffset ?? 0),
      "data-image-preview-source": String(node.attrs.imagePreviewSource ?? ""),
      "data-image-preview-src": String(node.attrs.imagePreviewSrc ?? ""),
      "data-image-preview-status": String(node.attrs.imagePreviewStatus ?? "idle"),
      class: "md-wysiwyg-markdown-source",
    },
    String(node.attrs.source ?? ""),
  ] as const;
}

function createSourceDraftId(): string {
  sourceDraftIdSequence += 1;
  return `md-source-${Date.now().toString(36)}-${sourceDraftIdSequence.toString(36)}`;
}

function readSourceMarkdownNodeAttrs(node: Record<string, unknown>) {
  return {
    draftId: String(node.draftId ?? ""),
    kind: String(node.kind ?? "link"),
    source: String(node.value ?? node.source ?? ""),
    originalSource: String(node.originalSource ?? node.value ?? node.source ?? ""),
    sourceCursorOffset: Number(node.sourceCursorOffset ?? 0),
    imagePreviewSource: String(node.imagePreviewSource ?? ""),
    imagePreviewSrc: String(node.imagePreviewSrc ?? ""),
    imagePreviewStatus: String(node.imagePreviewStatus ?? "idle"),
  };
}

function createSerializedSourceDraftMarker(
  node: ProseMirrorNode,
  layout: "inline" | "block",
): string {
  return formatSourceDraftMarker({
    id: String(node.attrs.draftId ?? ""),
    layout,
    kind: String(node.attrs.kind ?? "link"),
    status: String(node.attrs.imagePreviewStatus ?? "idle"),
    source: String(node.attrs.source ?? ""),
  });
}

function createSourceDraftMarker(draft: WysiwygMarkdownSourceDraft): string {
  return formatSourceDraftMarker({
    id: draft.id,
    layout: draft.layout === "block" ? "block" : "inline",
    kind: draft.kind,
    status: draft.imagePreviewStatus,
    source: draft.source,
  });
}

function formatSourceDraftMarker(fields: {
  readonly id: string;
  readonly layout: "inline" | "block";
  readonly kind: string;
  readonly status: string;
  readonly source: string;
}): string {
  return `<${wysiwygMarkdownSourcePreviewTag} data-id="${fields.id}" data-layout="${fields.layout}" data-kind="${fields.kind}" data-status="${fields.status}" data-source="${encodeURIComponent(fields.source)}" />`;
}

export function collectWysiwygMarkdownSourceDraftIds(doc: ProseMirrorNode): ReadonlySet<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!isWysiwygMarkdownSourceNode(node)) {
      return;
    }
    const id = String(node.attrs.draftId ?? "");
    if (id) {
      ids.add(id);
    }
  });
  return ids;
}

export function extractWysiwygMarkdownSourceDrafts(
  serializedMarkdown: string,
  activeDraftIds: ReadonlySet<string>,
): { readonly markdown: string; readonly drafts: readonly WysiwygMarkdownSourceDraft[] } {
  const markerPattern = createSourceDraftMarkerPattern("gu");
  const drafts: WysiwygMarkdownSourceDraft[] = [];
  let markdown = "";
  let cursor = 0;

  for (const match of serializedMarkdown.matchAll(markerPattern)) {
    const markerOffset = match.index;
    const [marker, id, rawLayout, rawKind, rawStatus, encodedSource] = match;
    if (!activeDraftIds.has(id)) {
      continue;
    }
    const kind = wysiwygMarkdownSourceKinds.find((candidate) => candidate === rawKind);
    const imagePreviewStatus = readImagePreviewStatus(rawStatus);
    if (!kind || !imagePreviewStatus) {
      continue;
    }

    let source: string;
    try {
      source = decodeURIComponent(encodedSource);
    } catch {
      continue;
    }

    markdown += serializedMarkdown.slice(cursor, markerOffset);
    const from = markdown.length;
    markdown += source;
    drafts.push({
      id,
      kind,
      layout: rawLayout === "block" ? "block" : kind === "image" ? "image" : "inline",
      source,
      from,
      to: from + source.length,
      imagePreviewStatus,
    });
    cursor = markerOffset + marker.length;
  }

  markdown += serializedMarkdown.slice(cursor);
  return { markdown, drafts };
}

function readSerializedSourceDraftMarker(
  node: MarkdownNode,
  activeDraftIds: ReadonlySet<string>,
): WysiwygMarkdownSourceDraft | null {
  if (node.type !== "html" || typeof node.value !== "string") {
    return null;
  }
  const match = createSourceDraftMarkerPattern("u").exec(node.value);
  if (!match || match[0] !== node.value) {
    return null;
  }
  const [, id, rawLayout, rawKind, rawStatus, encodedSource] = match;
  if (!activeDraftIds.has(id)) {
    return null;
  }
  const kind = wysiwygMarkdownSourceKinds.find((candidate) => candidate === rawKind);
  const imagePreviewStatus = readImagePreviewStatus(rawStatus);
  if (!kind || !imagePreviewStatus) {
    return null;
  }
  try {
    const source = decodeURIComponent(encodedSource);
    return {
      id,
      kind,
      layout: rawLayout === "block" ? "block" : kind === "image" ? "image" : "inline",
      source,
      from: 0,
      to: source.length,
      imagePreviewStatus,
    };
  } catch {
    return null;
  }
}

function createSourceDraftMarkerPattern(flags: string): RegExp {
  return new RegExp(
    `<${wysiwygMarkdownSourcePreviewTag} data-id="([^"]+)" data-layout="(inline|block)" data-kind="([a-zA-Z]+)" data-status="([a-zA-Z]+)" data-source="([^"]*)" \\/>`,
    flags,
  );
}

export function restoreWysiwygMarkdownSourceDraftsInTree(
  tree: Root,
  drafts: readonly WysiwygMarkdownSourceDraft[],
): void {
  restoreSourceDraftsInChildren(
    tree as MarkdownNode,
    new Set(drafts.map((draft) => draft.id)),
    true,
  );
}

function restoreSourceDraftsInChildren(
  parent: MarkdownNode,
  draftIds: ReadonlySet<string>,
  isRoot = false,
): void {
  if (!parent.children) {
    return;
  }

  const restored: MarkdownNode[] = [];
  for (const child of parent.children) {
    const draft = readSerializedSourceDraftMarker(child, draftIds);
    if (draft) {
      const sourceNode = createSourceDraftMarkdownNode(draft);
      restored.push(
        isRoot && draft.layout !== "block"
          ? ({ type: "paragraph", children: [sourceNode] } as MarkdownNode)
          : sourceNode,
      );
      continue;
    }

    restoreSourceDraftsInChildren(child, draftIds);
    restored.push(child);
  }
  parent.children = restored;
}

function createSourceDraftMarkdownNode(draft: WysiwygMarkdownSourceDraft): MarkdownNode {
  return {
    type:
      draft.layout === "block"
        ? wysiwygMarkdownBlockSourceNodeName
        : wysiwygMarkdownInlineSourceNodeName,
    draftId: draft.id,
    kind: draft.kind,
    source: draft.source,
    originalSource: draft.source,
    sourceCursorOffset: draft.source.length,
    imagePreviewSource: draft.kind === "image" ? draft.source : "",
    imagePreviewSrc: "",
    imagePreviewStatus: draft.imagePreviewStatus,
  } as MarkdownNode;
}

function reconcileSourceDraftRange(
  markdown: string,
  draft: WysiwygMarkdownSourceDraft,
): WysiwygMarkdownSourceDraft | null {
  if (markdown.slice(draft.from, draft.to) === draft.source) {
    return draft;
  }
  const from = markdown.indexOf(draft.source);
  if (from === -1 || markdown.indexOf(draft.source, from + 1) !== -1) {
    return null;
  }
  return { ...draft, from, to: from + draft.source.length };
}

function readImagePreviewStatus(value: string): WysiwygMarkdownImagePreviewStatus | null {
  return value === "idle" || value === "loading" || value === "loaded" || value === "failed"
    ? value
    : null;
}

function isHeadingLevel(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

function clampSourceOffset(offset: number, source: string): number {
  return Math.max(0, Math.min(offset, source.length));
}
