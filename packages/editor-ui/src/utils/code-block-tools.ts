import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, ViewMutationRecord } from "@milkdown/kit/prose/view";
import { EditorView as CodeMirrorView, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { StreamLanguage } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";

const tabText = "  ";
const svgNamespace = "http://www.w3.org/2000/svg";

// 语言扩展映射
function getLanguageExtension(language: string) {
  const lang = language.toLowerCase();
  if (lang === "javascript" || lang === "js" || lang === "jsx") return javascript({ jsx: true });
  if (lang === "typescript" || lang === "ts" || lang === "tsx") return javascript({ typescript: true, jsx: true });
  if (lang === "css") return css();
  if (lang === "html") return html();
  if (lang === "json") return json();
  if (lang === "markdown" || lang === "md") return markdown();
  if (lang === "java") return java();
  if (lang === "c" || lang === "cpp" || lang === "c++" || lang === "csharp" || lang === "c#") return cpp();
  if (lang === "python" || lang === "py") return python();
  if (lang === "rust" || lang === "rs") return rust();
  if (lang === "go") return go();
  if (lang === "ruby" || lang === "rb") return StreamLanguage.define(ruby);
  if (lang === "swift") return StreamLanguage.define(swift);
  return null;
}

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
  { label: "Python", value: "python" },
  { label: "Ruby", value: "ruby" },
  { label: "Rust", value: "rust" },
  { label: "Shell", value: "shell" },
  { label: "Swift", value: "swift" },
  { label: "TSX", value: "tsx" },
  { label: "TypeScript", value: "typescript" },
  { label: "YAML", value: "yaml" }
] as const;

const languageSuggestionValues = codeLanguageOptions.map((option) => option.value).filter(Boolean);
const codeBlockToolsPluginKey = new PluginKey("md-editor-code-block-tools");

export interface IndentPlan {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export const codeBlockToolsPlugin = $prose(
  () =>
    new Plugin({
      key: codeBlockToolsPluginKey,
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
            return false;
          }

          const plan = planCodeBlockTabIndent(
            view.state.selection.$from.parent.type.name,
            view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"),
            view.state.selection.from,
            view.state.selection.to,
            event.shiftKey
          );
          if (!plan) {
            return false;
          }

          event.preventDefault();
          const transaction = view.state.tr.insertText(plan.text, plan.from, plan.to);
          const nextPosition = plan.from + plan.text.length;
          view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, nextPosition)));
          return true;
        },
        nodeViews: {
          code_block: (node, view, getPos) => new MarkdownCodeBlockNodeView(node, view, getPos)
        }
      }
    })
);

export function planCodeBlockTabIndent(
  parentTypeName: string,
  selectedText: string,
  from: number,
  to: number,
  outdent = false
): IndentPlan | null {
  if (parentTypeName !== "code_block") {
    return null;
  }

  if (from === to) {
    return {
      from,
      to,
      text: outdent ? "" : tabText
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

export function getLanguageSuggestions(input: string): readonly string[] {
  const query = input.trim().toLowerCase();
  if (!query) {
    return languageSuggestionValues.slice(0, 6);
  }

  return languageSuggestionValues
    .map((language) => ({
      language,
      score: fuzzyScore(language, query)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.language.localeCompare(right.language))
    .slice(0, 6)
    .map((item) => item.language);
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
  private codeMirrorView: CodeMirrorView | null = null;
  private languageCompartment = new Compartment();

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined
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
    this.dom.append(this.rawHeader, this.lineNumbers, this.pre, this.copyButton, this.languageControl);

    this.copyButton.addEventListener("click", this.handleCopyClick);
    this.languageSelect.addEventListener("change", this.handleLanguageChange);

    this.syncLanguage();
    this.syncRawBlockChrome();
    this.syncLineNumbers();
    this.initCodeMirror();
  }

  private initCodeMirror() {
    const language = normalizeCodeLanguage(this.node.attrs.language);
    const languageExt = getLanguageExtension(language);
    const extensions = [
      this.languageCompartment.of(languageExt ? [languageExt] : [])
    ];

    this.codeMirrorView = new CodeMirrorView({
      state: EditorState.create({
        doc: "",
        extensions
      }),
      parent: this.code
    });

    // 隐藏 CodeMirror 编辑器，只用于语法高亮
    if (this.codeMirrorView.dom) {
      this.codeMirrorView.dom.style.display = "none";
    }
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

    // 更新 CodeMirror 语言
    if (this.codeMirrorView) {
      const language = normalizeCodeLanguage(this.node.attrs.language);
      const languageExt = getLanguageExtension(language);
      this.codeMirrorView.dispatch({
        effects: this.languageCompartment.reconfigure(languageExt ? [languageExt] : [])
      });
    }

    return true;
  }

  stopEvent(event: Event) {
    return targetIsInside(event.target, this.copyButton) || targetIsInside(event.target, this.languageControl);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.target === this.dom ||
      mutation.target === this.pre ||
      mutation.target === this.lineNumbers ||
      targetIsInside(mutation.target, this.copyButton) ||
      targetIsInside(mutation.target, this.lineNumbers) ||
      targetIsInside(mutation.target, this.languageControl) ||
      targetIsInside(mutation.target, this.rawHeader);
  }

  destroy() {
    this.copyButton.removeEventListener("click", this.handleCopyClick);
    this.languageSelect.removeEventListener("change", this.handleLanguageChange);
    if (this.copyResetTimer) {
      this.dom.ownerDocument.defaultView?.clearTimeout(this.copyResetTimer);
    }
    if (this.codeMirrorView) {
      this.codeMirrorView.destroy();
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
      return;
    }

    this.dom.dataset.rawBlock = rawBlock.kind;
    this.rawTitle.textContent = rawBlock.title;
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
      await this.dom.ownerDocument.defaultView?.navigator.clipboard?.writeText(this.node.textContent);
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
    this.copyResetTimer = this.dom.ownerDocument.defaultView?.setTimeout(() => {
      this.copyButton.dataset.copied = "false";
      this.copyButton.title = "Copy code block";
      this.copyButton.setAttribute("aria-label", "Copy code block");
      this.copyResetTimer = 0;
    }, 1400) ?? 0;
  }
}

function normalizeCodeLanguage(language: unknown) {
  return typeof language === "string" ? language.trim().replace(/[\s`]+/gu, "-") : "";
}

function parseManagedRawBlockLanguage(language: unknown): { readonly kind: string; readonly title: string } | null {
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
