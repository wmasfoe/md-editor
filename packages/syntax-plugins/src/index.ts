export {
  containerDirectivePlugin,
  DIRECTIVE_NODES,
  directiveMarkdownExtension,
  buildDirectiveLayoutDecorations,
  type DirectiveMetadata,
  type DirectiveType,
} from "./directive/index.ts";

export {
  mathPlugin,
  MATH_NODES,
  mathMarkdownExtension,
  buildMathLayoutDecorations,
  type MathMetadata,
  type MathKind,
  loadKatex,
  getLoadedKatex,
  renderMathHtml,
} from "./math/index.ts";

export {
  mermaidPlugin,
  MERMAID_NODES,
  mermaidMarkdownExtension,
  buildMermaidLayoutDecorations,
  type MermaidMetadata,
  loadMermaid,
  getLoadedMermaid,
  renderMermaidSvg,
} from "./mermaid/index.ts";

export {
  highlightPlugin,
  HIGHLIGHT_NODES,
  highlightMarkdownExtension,
  type HighlightMetadata,
} from "./highlight/index.ts";

export {
  OFFICIAL_SYNTAX_PLUGINS_METADATA,
  getOfficialPluginMetadata,
  type OfficialSyntaxPluginDescriptor,
  type OfficialSyntaxPluginId,
} from "./metadata.ts";
