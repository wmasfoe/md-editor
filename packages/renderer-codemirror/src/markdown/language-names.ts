/**
 * 代码语言元数据与常用别名表（纯数据层，无 CodeMirror/DOM 依赖，供交互与静态渲染复用）
 */
export interface LanguageMeta {
  name: string;
  alias: readonly string[];
}

export const SUPPORTED_LANGUAGE_METAS: readonly LanguageMeta[] = Object.freeze([
  { name: "Bash", alias: ["bash", "sh", "zsh"] },
  { name: "C", alias: ["c"] },
  { name: "C#", alias: ["csharp", "cs", "c#"] },
  { name: "C++", alias: ["cpp", "c++", "cc", "cxx"] },
  { name: "CSS", alias: ["css"] },
  { name: "Go", alias: ["go", "golang"] },
  { name: "HTML", alias: ["html", "htm", "xhtml"] },
  { name: "Java", alias: ["java"] },
  { name: "JavaScript", alias: ["javascript", "js", "node"] },
  { name: "JSON", alias: ["json", "json5"] },
  { name: "JSX", alias: ["jsx"] },
  { name: "Markdown", alias: ["markdown", "md"] },
  { name: "Python", alias: ["python", "py"] },
  { name: "Ruby", alias: ["ruby", "rb"] },
  { name: "Rust", alias: ["rust", "rs"] },
  { name: "SQL", alias: ["sql"] },
  { name: "Swift", alias: ["swift"] },
  { name: "TypeScript", alias: ["typescript", "ts"] },
  { name: "TSX", alias: ["tsx"] },
  { name: "YAML", alias: ["yaml", "yml"] },
  { name: "PHP", alias: ["php"] },
]);

export function resolveLanguageAlias(token: string): string | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  const found = SUPPORTED_LANGUAGE_METAS.find(
    (item) => item.alias.includes(normalized) || item.name.toLowerCase() === normalized,
  );
  return found ? (found.alias[0] ?? found.name.toLowerCase()) : null;
}
