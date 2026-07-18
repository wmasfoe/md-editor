import type {
  MarkdownEditPolicy,
  MarkdownInteractionPolicy,
  MarkdownRenderPolicy,
  MarkdownSyntaxKind,
} from "./range-types.ts";

export type MarkdownContentStrategy =
  | "between-markers"
  | "after-first-marker"
  | "before-last-marker"
  | "link-label"
  | "url"
  | "full"
  | "none";

export interface MarkdownNodePolicy {
  readonly kind: MarkdownSyntaxKind;
  readonly renderPolicy: MarkdownRenderPolicy;
  readonly editPolicy: MarkdownEditPolicy;
  readonly interactionPolicy: MarkdownInteractionPolicy;
  readonly priority: number;
  readonly markerNodeNames: readonly string[];
  readonly contentStrategy: MarkdownContentStrategy;
}

function definePolicy(policy: MarkdownNodePolicy): MarkdownNodePolicy {
  return Object.freeze({
    ...policy,
    markerNodeNames: Object.freeze([...policy.markerNodeNames]),
  });
}

const INLINE_MARKS = Object.freeze({
  StrongEmphasis: definePolicy({
    kind: "bold",
    renderPolicy: "inline-visible-markers",
    editPolicy: "native",
    interactionPolicy: "text",
    priority: 40,
    markerNodeNames: ["EmphasisMark"],
    contentStrategy: "between-markers",
  }),
  Emphasis: definePolicy({
    kind: "italic",
    renderPolicy: "inline-visible-markers",
    editPolicy: "native",
    interactionPolicy: "text",
    priority: 41,
    markerNodeNames: ["EmphasisMark"],
    contentStrategy: "between-markers",
  }),
  Strikethrough: definePolicy({
    kind: "strikethrough",
    renderPolicy: "inline-visible-markers",
    editPolicy: "native",
    interactionPolicy: "text",
    priority: 42,
    markerNodeNames: ["StrikethroughMark"],
    contentStrategy: "between-markers",
  }),
  InlineCode: definePolicy({
    kind: "inline-code",
    renderPolicy: "inline-visible-markers",
    editPolicy: "native",
    interactionPolicy: "text",
    priority: 43,
    markerNodeNames: ["CodeMark"],
    contentStrategy: "between-markers",
  }),
});

const POLICIES: Readonly<Record<string, MarkdownNodePolicy>> = Object.freeze({
  ...INLINE_MARKS,
  Blockquote: definePolicy({
    kind: "quote",
    renderPolicy: "marker-hidden",
    editPolicy: "structured",
    interactionPolicy: "structured-block",
    priority: 30,
    markerNodeNames: ["QuoteMark"],
    contentStrategy: "after-first-marker",
  }),
  Task: definePolicy({
    kind: "task",
    renderPolicy: "marker-hidden",
    editPolicy: "structured",
    interactionPolicy: "toggle",
    priority: 70,
    markerNodeNames: ["TaskMarker"],
    contentStrategy: "none",
  }),
  Link: definePolicy({
    kind: "link",
    renderPolicy: "link-segmented",
    editPolicy: "native",
    interactionPolicy: "reveal-source",
    priority: 60,
    markerNodeNames: ["LinkMark"],
    contentStrategy: "link-label",
  }),
  Image: definePolicy({
    kind: "image",
    renderPolicy: "image-widget",
    editPolicy: "atom-delete",
    interactionPolicy: "reveal-source",
    priority: 90,
    markerNodeNames: ["LinkMark"],
    contentStrategy: "link-label",
  }),
  HorizontalRule: definePolicy({
    kind: "thematic-break",
    renderPolicy: "thematic-break-widget",
    editPolicy: "atom-delete",
    interactionPolicy: "select-atom",
    priority: 80,
    markerNodeNames: [],
    contentStrategy: "none",
  }),
  Autolink: definePolicy({
    kind: "autolink",
    renderPolicy: "source-only-atom",
    editPolicy: "source-mode-only",
    interactionPolicy: "source-mode-required",
    priority: 50,
    markerNodeNames: ["LinkMark"],
    contentStrategy: "url",
  }),
  LinkReference: definePolicy({
    kind: "reference-definition",
    renderPolicy: "source-only-atom",
    editPolicy: "source-mode-only",
    interactionPolicy: "source-mode-required",
    priority: 50,
    markerNodeNames: ["LinkMark"],
    contentStrategy: "full",
  }),
  FencedCode: definePolicy({
    kind: "deferred-code",
    renderPolicy: "deferred-raw",
    editPolicy: "native",
    interactionPolicy: "none",
    priority: 0,
    markerNodeNames: [],
    contentStrategy: "full",
  }),
  CodeBlock: definePolicy({
    kind: "deferred-code",
    renderPolicy: "deferred-raw",
    editPolicy: "native",
    interactionPolicy: "none",
    priority: 0,
    markerNodeNames: [],
    contentStrategy: "full",
  }),
  Table: definePolicy({
    kind: "deferred-table",
    renderPolicy: "deferred-raw",
    editPolicy: "native",
    interactionPolicy: "none",
    priority: 0,
    markerNodeNames: [],
    contentStrategy: "full",
  }),
  HTMLBlock: definePolicy({
    kind: "deferred-html",
    renderPolicy: "deferred-raw",
    editPolicy: "native",
    interactionPolicy: "none",
    priority: 0,
    markerNodeNames: [],
    contentStrategy: "full",
  }),
  HTMLTag: definePolicy({
    kind: "deferred-html",
    renderPolicy: "deferred-raw",
    editPolicy: "native",
    interactionPolicy: "none",
    priority: 0,
    markerNodeNames: [],
    contentStrategy: "full",
  }),
  Footnote: definePolicy({
    kind: "footnote",
    renderPolicy: "source-only-atom",
    editPolicy: "source-mode-only",
    interactionPolicy: "source-mode-required",
    priority: 50,
    markerNodeNames: ["FootnoteMark"],
    contentStrategy: "full",
  }),
  FootnoteDefinition: definePolicy({
    kind: "footnote",
    renderPolicy: "source-only-atom",
    editPolicy: "source-mode-only",
    interactionPolicy: "source-mode-required",
    priority: 50,
    markerNodeNames: ["FootnoteMark"],
    contentStrategy: "full",
  }),
});

const TRANSPARENT_OR_SEGMENT_NODES = new Set([
  "Document",
  "Paragraph",
  "BulletList",
  "OrderedList",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "LinkMark",
  "FootnoteMark",
  "LinkLabel",
  "URL",
  "LinkTitle",
  "CodeInfo",
  "CodeText",
  "TableHeader",
  "TableRow",
  "TableCell",
  "TableDelimiter",
]);

const RAW_FALLBACK_POLICY = definePolicy({
  kind: "raw-fallback",
  renderPolicy: "raw-fallback",
  editPolicy: "native",
  interactionPolicy: "none",
  priority: -1,
  markerNodeNames: [],
  contentStrategy: "full",
});

const REFERENCE_LINK_POLICY = definePolicy({
  kind: "reference-link",
  renderPolicy: "source-only-atom",
  editPolicy: "source-mode-only",
  interactionPolicy: "source-mode-required",
  priority: 50,
  markerNodeNames: ["LinkMark"],
  contentStrategy: "link-label",
});

const REFERENCE_IMAGE_POLICY = definePolicy({
  kind: "reference-image",
  renderPolicy: "source-only-atom",
  editPolicy: "source-mode-only",
  interactionPolicy: "source-mode-required",
  priority: 50,
  markerNodeNames: ["LinkMark"],
  contentStrategy: "link-label",
});

const BARE_AUTOLINK_POLICY = definePolicy({
  kind: "autolink",
  renderPolicy: "source-only-atom",
  editPolicy: "source-mode-only",
  interactionPolicy: "source-mode-required",
  priority: 50,
  markerNodeNames: [],
  contentStrategy: "full",
});

function headingPolicy(nodeName: string): MarkdownNodePolicy | null {
  if (/^ATXHeading[1-6]$/u.test(nodeName)) {
    return definePolicy({
      kind: "heading-atx",
      renderPolicy: "heading-active-marker",
      editPolicy: "native",
      interactionPolicy: "active-line",
      priority: 20,
      markerNodeNames: ["HeaderMark"],
      contentStrategy: "between-markers",
    });
  }
  if (/^SetextHeading[12]$/u.test(nodeName)) {
    return definePolicy({
      kind: "heading-setext",
      renderPolicy: "source-only-atom",
      editPolicy: "source-mode-only",
      interactionPolicy: "source-mode-required",
      priority: 50,
      markerNodeNames: ["HeaderMark"],
      contentStrategy: "before-last-marker",
    });
  }
  return null;
}

function listItemPolicy(parentName: string | null): MarkdownNodePolicy {
  return definePolicy({
    kind: parentName === "OrderedList" ? "list-item-ordered" : "list-item-unordered",
    renderPolicy: "marker-hidden",
    editPolicy: "structured",
    interactionPolicy: "structured-block",
    priority: 35,
    markerNodeNames: ["ListMark"],
    contentStrategy: "after-first-marker",
  });
}

export function getMarkdownNodePolicy(
  nodeName: string,
  parentName: string | null = null,
  childNodeNames: readonly string[] = [],
): MarkdownNodePolicy | null {
  if (
    nodeName === "URL" &&
    parentName !== "Autolink" &&
    parentName !== "Link" &&
    parentName !== "Image" &&
    parentName !== "LinkReference"
  ) {
    return BARE_AUTOLINK_POLICY;
  }
  if (TRANSPARENT_OR_SEGMENT_NODES.has(nodeName)) {
    return nodeName === "ListItem" ? listItemPolicy(parentName) : null;
  }
  if (nodeName === "ListItem") {
    return listItemPolicy(parentName);
  }
  if (nodeName === "Link" && !childNodeNames.includes("URL")) {
    return REFERENCE_LINK_POLICY;
  }
  if (nodeName === "Image" && !childNodeNames.includes("URL")) {
    return REFERENCE_IMAGE_POLICY;
  }
  return POLICIES[nodeName] ?? headingPolicy(nodeName) ?? RAW_FALLBACK_POLICY;
}

export function isExplicitDeferredNode(nodeName: string): boolean {
  return ["FencedCode", "CodeBlock", "Table", "HTMLBlock", "HTMLTag"].includes(nodeName);
}
