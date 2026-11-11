/**
 * @file frontmatter-yaml.ts
 * @description Markdown 文档头部 YAML Frontmatter 静态分析与诊断提取。
 * 基于 `@lezer/yaml` 语法分析树，提取 Frontmatter 的语法高亮标记（键名、标量、字符串、注释等）
 * 以及未闭合与语法错误诊断。
 */

import { parser as yamlParser } from "@lezer/yaml";
import type { FrontmatterSourceRange } from "@md-editor/markdown-fidelity";

/**
 * Frontmatter YAML 语法诊断信息。
 */
export interface FrontmatterYamlDiagnostic {
  /** 诊断错误码：未闭合或解析错误 */
  readonly code: "frontmatter-unterminated" | "yaml-parse-error";
  /** 绝对字符起始偏移量 */
  readonly from: number;
  /** 绝对字符结束偏移量 */
  readonly to: number;
  /** 错误级别 */
  readonly severity: "error";
}

/**
 * YAML 词法标记种类。
 */
export type FrontmatterYamlTokenKind = "alias" | "anchor" | "comment" | "key" | "scalar" | "string";

/**
 * 单个 YAML 语法标记范围。
 */
export interface FrontmatterYamlToken {
  readonly kind: FrontmatterYamlTokenKind;
  readonly from: number;
  readonly to: number;
}

/**
 * Frontmatter YAML 分析结果汇总对象。
 */
export interface FrontmatterYamlAnalysis {
  readonly diagnostics: readonly FrontmatterYamlDiagnostic[];
  readonly tokens: readonly FrontmatterYamlToken[];
}

/**
 * 快速获取指定 Frontmatter 范围的 YAML 诊断错误列表。
 */
export function getFrontmatterYamlDiagnostics(
  frontmatter: FrontmatterSourceRange,
): readonly FrontmatterYamlDiagnostic[] {
  return analyzeFrontmatterYaml(frontmatter).diagnostics;
}

/**
 * 深度解析 Frontmatter 文本，提取高亮 Tokens 与潜在错误诊断。
 *
 * @param frontmatter - Frontmatter 源码范围及内容
 * @returns 冻结的分析结果对象
 */
export function analyzeFrontmatterYaml(
  frontmatter: FrontmatterSourceRange,
): FrontmatterYamlAnalysis {
  if (frontmatter.status === "unterminated") {
    return freezeAnalysis(
      [
        {
          code: "frontmatter-unterminated",
          from: frontmatter.openingFenceRange.from,
          to: frontmatter.fullRange.to,
          severity: "error",
        },
      ],
      collectYamlTokens(frontmatter),
    );
  }

  const diagnostics: FrontmatterYamlDiagnostic[] = [];
  const tree = yamlParser.parse(frontmatter.content);
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) {
      diagnostics.push(createYamlErrorDiagnostic(frontmatter, cursor.from, cursor.to));
    }
  } while (cursor.next());
  return freezeAnalysis(dedupeDiagnostics(diagnostics), collectYamlTokens(frontmatter, tree));
}

function collectYamlTokens(
  frontmatter: FrontmatterSourceRange,
  parsedTree = yamlParser.parse(frontmatter.content),
): readonly FrontmatterYamlToken[] {
  const candidates: FrontmatterYamlToken[] = [];
  const cursor = parsedTree.cursor();
  do {
    const kind = yamlTokenKind(cursor.name);
    if (kind && cursor.from < cursor.to) {
      candidates.push({
        kind,
        from: frontmatter.contentRange.from + cursor.from,
        to: frontmatter.contentRange.from + cursor.to,
      });
    }
  } while (cursor.next());

  const priority: Readonly<Record<FrontmatterYamlTokenKind, number>> = {
    key: 6,
    comment: 5,
    string: 4,
    anchor: 3,
    alias: 3,
    scalar: 1,
  };
  const sorted = sortYamlTokens(candidates, (left, right) => {
    return (
      left.from - right.from || right.to - left.to || priority[right.kind] - priority[left.kind]
    );
  });
  const tokens: FrontmatterYamlToken[] = [];
  for (const candidate of sorted) {
    const containing = tokens.find(
      (token) =>
        token.from <= candidate.from &&
        token.to >= candidate.to &&
        priority[token.kind] >= priority[candidate.kind],
    );
    if (!containing) {
      tokens.push(Object.freeze(candidate));
    }
  }
  return Object.freeze(
    sortYamlTokens(tokens, (left, right) => left.from - right.from || left.to - right.to),
  );
}

function sortYamlTokens(
  values: readonly FrontmatterYamlToken[],
  compare: (left: FrontmatterYamlToken, right: FrontmatterYamlToken) => number,
): FrontmatterYamlToken[] {
  const sorted: FrontmatterYamlToken[] = [];
  for (const value of values) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (compare(sorted[middle], value) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    sorted.splice(low, 0, value);
  }
  return sorted;
}

function yamlTokenKind(nodeName: string): FrontmatterYamlTokenKind | null {
  switch (nodeName) {
    case "Alias":
      return "alias";
    case "Anchor":
      return "anchor";
    case "Comment":
      return "comment";
    case "Key":
      return "key";
    case "QuotedLiteral":
    case "BlockLiteralContent":
      return "string";
    case "Literal":
      return "scalar";
    default:
      return null;
  }
}

function createYamlErrorDiagnostic(
  frontmatter: FrontmatterSourceRange,
  relativeFrom: number,
  relativeTo: number,
): FrontmatterYamlDiagnostic {
  const contentLength = frontmatter.content.length;
  let from = Math.min(Math.max(relativeFrom, 0), contentLength);
  let to = Math.min(Math.max(relativeTo, relativeFrom + 1), contentLength);
  if (from === to && contentLength > 0) {
    from = Math.max(0, from - 1);
  }
  if (frontmatter.content.slice(from, to).trim().length === 0) {
    let visible = from - 1;
    while (visible >= 0 && /\s/u.test(frontmatter.content[visible] ?? "")) {
      visible -= 1;
    }
    if (visible >= 0) {
      from = visible;
      to = visible + 1;
    }
  }
  return Object.freeze({
    code: "yaml-parse-error",
    from: frontmatter.contentRange.from + from,
    to: frontmatter.contentRange.from + to,
    severity: "error",
  });
}

function dedupeDiagnostics(
  diagnostics: readonly FrontmatterYamlDiagnostic[],
): readonly FrontmatterYamlDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.from}:${diagnostic.to}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function freezeAnalysis(
  diagnostics: readonly FrontmatterYamlDiagnostic[],
  tokens: readonly FrontmatterYamlToken[],
): FrontmatterYamlAnalysis {
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))),
    tokens: Object.freeze(tokens.map((token) => Object.freeze(token))),
  });
}
