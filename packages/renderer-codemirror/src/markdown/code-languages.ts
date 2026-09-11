/**
 * @file code-languages.ts
 * @description Markdown 代码块语法高亮语言注册表与按需加载器。
 * 包含主流编程语言（JavaScript, TypeScript, Python, Rust, Go, CSS 等）的动态导入配置、
 * 别名匹配查询、加载状态观察者以及代码块基础高亮主题。
 */

import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";

type MarkdownConfig = NonNullable<Parameters<typeof markdown>[0]>;

/**
 * 代码块语言加载过程观察者接口，用于性能监控与加载诊断。
 */
export interface CodeBlockLanguageLoadObserver {
  /** 记录尝试加载语言包的次数 */
  recordLanguageLoadAttempt(): void;
  /** 记录成功加载语言包的次数 */
  recordLanguageLoadSuccess(): void;
  /** 记录语言包加载失败的次数 */
  recordLanguageLoadFailure(): void;
}

/**
 * 包装基于 StreamParser 的经典 Legacy 语言支持。
 */
function loadLegacyLanguage<State>(parser: StreamParser<State>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

/**
 * 默认支持的 Markdown 代码块语言定义列表（动态延迟加载）。
 */
export const CODE_BLOCK_LANGUAGES: readonly LanguageDescription[] = Object.freeze([
  LanguageDescription.of({
    name: "Bash",
    alias: ["bash", "zsh"],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => loadLegacyLanguage(shell)),
  }),
  LanguageDescription.of({
    name: "C",
    alias: ["c"],
    load: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  }),
  LanguageDescription.of({
    name: "C#",
    alias: ["csharp", "cs", "c#"],
    load: () =>
      import("@codemirror/legacy-modes/mode/clike").then(({ csharp }) =>
        loadLegacyLanguage(csharp),
      ),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c++", "cc", "cxx"],
    load: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    load: () => import("@codemirror/lang-css").then(({ css }) => css()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    load: () => import("@codemirror/lang-go").then(({ go }) => go()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm", "xhtml"],
    load: () => import("@codemirror/lang-html").then(({ html }) => html()),
  }),
  LanguageDescription.of({
    name: "Java",
    alias: ["java"],
    load: () => import("@codemirror/lang-java").then(({ java }) => java()),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js", "node"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript()),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "json5"],
    load: () => import("@codemirror/lang-json").then(({ json }) => json()),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["markdown", "md"],
    load: () =>
      import("@codemirror/lang-markdown").then(({ markdown: markdownLanguage }) =>
        markdownLanguage(),
      ),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["python", "py"],
    load: () => import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "Ruby",
    alias: ["ruby", "rb"],
    load: () =>
      import("@codemirror/legacy-modes/mode/ruby").then(({ ruby }) => loadLegacyLanguage(ruby)),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rust", "rs"],
    load: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["shell", "sh"],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => loadLegacyLanguage(shell)),
  }),
  LanguageDescription.of({
    name: "Swift",
    alias: ["swift"],
    load: () =>
      import("@codemirror/legacy-modes/mode/swift").then(({ swift }) => loadLegacyLanguage(swift)),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["typescript", "ts"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then(({ yaml }) => yaml()),
  }),
]);

/**
 * 根据语言标记（如 "ts", "python", "sh"）检索对应的 LanguageDescription。
 *
 * @param token - 代码块首行的语言名称或别名
 * @param languages - 可供查找的语言集合（默认 CODE_BLOCK_LANGUAGES）
 * @returns 匹配的语言描述符，或未找到时返回 null
 */
export function findCodeBlockLanguage(
  token: string,
  languages: readonly LanguageDescription[] = CODE_BLOCK_LANGUAGES,
): LanguageDescription | null {
  const normalizedToken = token.trim();
  if (!normalizedToken) return null;
  const normalizedAlias = normalizedToken.toLowerCase();
  return languages.find((language) => language.alias.includes(normalizedAlias)) ?? null;
}

/**
 * 包装语言描述符集合，在动态触发语言包异步加载时通知 observer 记录性能与异常。
 *
 * @param languages - 原始语言列表
 * @param observer - 观察者实例
 */
export function observeCodeBlockLanguageLoads(
  languages: readonly LanguageDescription[],
  observer: CodeBlockLanguageLoadObserver,
): readonly LanguageDescription[] {
  return Object.freeze(
    languages.map((language) =>
      LanguageDescription.of({
        name: language.name,
        alias: language.alias,
        extensions: language.extensions,
        filename: language.filename,
        async load() {
          observer.recordLanguageLoadAttempt();
          try {
            const support = await language.load();
            observer.recordLanguageLoadSuccess();
            return support;
          } catch (error) {
            observer.recordLanguageLoadFailure();
            throw error;
          }
        },
      }),
    ),
  );
}

/**
 * 代码块 Token 语法高亮扩展（结合主题 CSS 变量）。
 */
export const codeBlockTokenHighlighting: Extension = [
  syntaxHighlighting(classHighlighter),
  EditorView.baseTheme({
    ".tok-keyword, .tok-atom, .tok-bool": { color: "var(--theme-code-keyword, currentColor)" },
    ".tok-string, .tok-string2, .tok-url": { color: "var(--theme-code-string, currentColor)" },
    ".tok-comment, .tok-meta": { color: "var(--theme-code-comment, currentColor)" },
    ".tok-number, .tok-literal": { color: "var(--theme-code-number, currentColor)" },
    ".tok-tagName, .tok-typeName, .tok-className, .tok-namespace": {
      color: "var(--theme-code-tag, currentColor)",
    },
    ".tok-attributeName, .tok-propertyName": {
      color: "var(--theme-code-attribute, currentColor)",
    },
    ".tok-variableName, .tok-variableName2, .tok-labelName": {
      color: "var(--theme-code-variable, currentColor)",
    },
    ".tok-invalid": {
      color: "var(--theme-danger-text, var(--theme-code-keyword, currentColor))",
      textDecoration: "underline wavy",
    },
  }),
];

/**
 * 创建集成了代码块动态语言解析的 CodeMirror Markdown 语言支持扩展。
 *
 * @param config - 基础 Markdown 配置
 * @param languageLoadObserver - 可选的语言包加载观察器
 */
export function createMarkdownLanguageSupport(
  config: Omit<MarkdownConfig, "codeLanguages"> = {},
  languageLoadObserver?: CodeBlockLanguageLoadObserver,
) {
  const languages = languageLoadObserver
    ? observeCodeBlockLanguageLoads(CODE_BLOCK_LANGUAGES, languageLoadObserver)
    : CODE_BLOCK_LANGUAGES;
  return markdown({
    ...config,
    codeLanguages: (token) => findCodeBlockLanguage(token, languages),
  });
}
