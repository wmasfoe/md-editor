export type RawFragmentKind =
  | "frontmatter"
  | "htmlBlock"
  | "unknownMdxFlow"
  | "unknownMdxText"
  | "mdxEsm"
  | "mdxExpression"
  | "codeFence"
  | "registeredMdxComponent";

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface RawFragment {
  readonly id: string;
  readonly kind: RawFragmentKind;
  readonly rawSource: string;
  readonly sourceRange?: SourceRange;
  readonly dirty: boolean;
  readonly serializedMarkdown?: string;
}

export interface CalloutNode {
  readonly type: "callout";
  readonly name: "Callout";
  readonly props: Readonly<Record<string, string>>;
  readonly childrenMarkdown: string;
  readonly rawFragmentId?: string;
  readonly dirty: boolean;
}

export type EditorNode = CalloutNode | RawFragment;

export interface EditorContent {
  readonly rawMarkdown: string;
  readonly savedRawMarkdown: string;
  readonly rawFragments: readonly RawFragment[];
  readonly nodes: readonly EditorNode[];
  readonly dirty: boolean;
}

export interface EditorSerializeResult {
  readonly rawMarkdown: string;
  readonly rawFragments: readonly RawFragment[];
  readonly dirty: boolean;
  readonly saveAuthority: "rawMarkdown";
}

export interface CreateEditorContentInput {
  readonly rawMarkdown: string;
  readonly savedRawMarkdown?: string;
  readonly rawFragments?: readonly RawFragment[];
  readonly nodes?: readonly EditorNode[];
}

export function computeDirtyState(
  content: Pick<EditorContent, "rawMarkdown" | "savedRawMarkdown">,
): boolean {
  return content.rawMarkdown !== content.savedRawMarkdown;
}

export function createEditorContent(input: CreateEditorContentInput): EditorContent {
  const savedRawMarkdown = input.savedRawMarkdown ?? input.rawMarkdown;

  return {
    rawMarkdown: input.rawMarkdown,
    savedRawMarkdown,
    rawFragments: input.rawFragments ?? [],
    nodes: input.nodes ?? [],
    dirty: computeDirtyState({ rawMarkdown: input.rawMarkdown, savedRawMarkdown }),
  };
}

export function updateRawMarkdown(content: EditorContent, rawMarkdown: string): EditorContent {
  return createEditorContent({
    rawMarkdown,
    savedRawMarkdown: content.savedRawMarkdown,
    rawFragments: content.rawFragments,
    nodes: content.nodes,
  });
}

export function markSaved(content: EditorContent): EditorContent {
  return createEditorContent({
    rawMarkdown: content.rawMarkdown,
    savedRawMarkdown: content.rawMarkdown,
    rawFragments: content.rawFragments,
    nodes: content.nodes,
  });
}

export function serializeEditorContent(content: EditorContent): EditorSerializeResult {
  return {
    rawMarkdown: content.rawMarkdown,
    rawFragments: content.rawFragments,
    dirty: computeDirtyState(content),
    saveAuthority: "rawMarkdown",
  };
}

export function getRawFragmentSaveSource(fragment: RawFragment): string {
  // Untouched raw fragments must round-trip from original bytes; dirty fragments
  // are the only ones allowed to accept serializer-generated Markdown.
  if (!fragment.dirty) {
    return fragment.rawSource;
  }

  return fragment.serializedMarkdown ?? fragment.rawSource;
}
