/**
 * @file rules-en.ts
 * @description MarkdownLint rules English dictionary (MD001~MD058 standard descriptions).
 */

import type { LocalizedRuleInfo } from "./rules-zh.ts";

export const MARKDOWNLINT_EN_RULES: Record<string, LocalizedRuleInfo> = {
  MD001: {
    alias: "Heading level increment",
    description:
      "Heading levels should only increment by one level at a time (e.g. H1 to H3 skip not allowed)",
  },
  MD002: {
    alias: "First heading should be H1",
    description: "First heading in a document should be a top-level heading (H1)",
  },
  MD003: {
    alias: "Heading style",
    description:
      "Heading style should be consistent throughout the document (ATX `#` style recommended)",
  },
  MD004: {
    alias: "Unordered list style",
    description: "Unordered list bullet style should be consistent (`-`, `*`, or `+`)",
  },
  MD005: {
    alias: "List indentation",
    description: "Inconsistent indentation for list items at the same level",
  },
  MD006: {
    alias: "Start lists at beginning of line",
    description:
      "Consider starting top-level lists at the beginning of the line without indentation",
  },
  MD007: {
    alias: "Unordered list indentation",
    description: "Unordered list indentation does not match expected spaces",
  },
  MD009: {
    alias: "Trailing spaces",
    description: "Spaces at the end of lines should be removed",
  },
  MD010: {
    alias: "Hard tabs",
    description: "Hard tab characters should not be used for indentation; use spaces instead",
  },
  MD011: {
    alias: "Reversed link syntax",
    description: "Link syntax appears reversed: standard format is [link text](url)",
  },
  MD012: {
    alias: "Multiple consecutive blank lines",
    description: "Multiple consecutive blank lines between paragraphs should be collapsed",
  },
  MD013: {
    alias: "Line length",
    description: "Line length exceeds maximum configured length",
  },
  MD014: {
    alias: "Dollar signs before commands",
    description: "Dollar signs should not precede commands when command output is present",
  },
  MD018: {
    alias: "No space after hash on atx style heading",
    description: "Heading `#` and heading text require a single space between them",
  },
  MD019: {
    alias: "Multiple spaces after hash on atx style heading",
    description: "Only a single space is allowed after `#` in atx heading",
  },
  MD020: {
    alias: "No space inside hashes on closed atx heading",
    description: "Context requires space inside hashes on closed atx heading",
  },
  MD021: {
    alias: "Multiple spaces inside hashes on closed atx heading",
    description: "Only single space allowed inside hashes on closed atx heading",
  },
  MD022: {
    alias: "Headings should be surrounded by blank lines",
    description: "Headings should be surrounded by blank lines above and below",
  },
  MD023: {
    alias: "Headings must start at the beginning of the line",
    description: "Headings must start at column 1 without indentation",
  },
  MD024: {
    alias: "Multiple headings with the same content",
    description: "Duplicate heading content causes anchor and table-of-contents ambiguity",
  },
  MD025: {
    alias: "Multiple top-level headings in document",
    description: "Documents should generally contain only one top-level H1 heading",
  },
  MD026: {
    alias: "Trailing punctuation in heading",
    description: "Headings should not end with punctuation marks like period, comma, or colon",
  },
  MD027: {
    alias: "Multiple spaces after blockquote symbol",
    description: "Only single space should follow `>` blockquote symbol",
  },
  MD028: {
    alias: "Blank line inside blockquote",
    description: "Blockquotes should not be split by empty lines",
  },
  MD029: {
    alias: "Ordered list item prefix",
    description: "Ordered list item prefixes must be sequential or follow configured style",
  },
  MD030: {
    alias: "Spaces after list markers",
    description: "Incorrect number of spaces after list marker (`-` or `1.`)",
  },
  MD031: {
    alias: "Fenced code blocks should be surrounded by blank lines",
    description: "Fenced code blocks (```) require a blank line above and below",
  },
  MD032: {
    alias: "Lists should be surrounded by blank lines",
    description: "List blocks should be surrounded by blank lines",
  },
  MD033: {
    alias: "Inline HTML",
    description: "Inline HTML is not allowed",
  },
  MD034: {
    alias: "Bare URL used",
    description: "Bare URLs should be wrapped in `<url>` or `[text](url)`",
  },
  MD035: {
    alias: "Horizontal rule style",
    description: "Horizontal rule style (`---` or `***`) should be consistent throughout",
  },
  MD036: {
    alias: "Emphasis used instead of a heading",
    description: "Use standard heading syntax (`#`) instead of standalone bold/italic lines",
  },
  MD037: {
    alias: "Spaces inside emphasis markers",
    description: "Spaces are not allowed inside emphasis markers",
  },
  MD038: {
    alias: "Spaces inside code span elements",
    description: "Spaces are not allowed inside inline code backticks",
  },
  MD039: {
    alias: "Spaces inside link text",
    description: "Spaces are not allowed inside link brackets `[ ... ]`",
  },
  MD040: {
    alias: "Fenced code blocks should have a language specified",
    description: "Fenced code blocks (```) must specify a language identifier (e.g. ts, json)",
  },
  MD041: {
    alias: "First line in a file should be a top-level heading",
    description: "First line of the document should be an H1 heading",
  },
  MD042: {
    alias: "No empty links",
    description: "Link destination URL should not be empty (e.g. `[]( )` or `[text]()`)",
  },
  MD043: {
    alias: "Required heading structure",
    description: "Document structure does not match required heading layout",
  },
  MD044: {
    alias: "Proper names should have the correct capitalization",
    description: "Proper names must match dictionary capitalization",
  },
  MD045: {
    alias: "Images should have alternate text",
    description: "Images must have descriptive alternate text for accessibility",
  },
  MD046: {
    alias: "Code block style",
    description: "Code block style (fenced ``` vs indented) should be consistent",
  },
  MD047: {
    alias: "Files should end with a single newline character",
    description: "Files should end with a single newline character",
  },
  MD048: {
    alias: "Code fence style",
    description: "Code fence style (``` vs ~~~) should be consistent",
  },
  MD049: {
    alias: "Emphasis style",
    description: "Emphasis style (`*` vs `_`) should be consistent",
  },
  MD050: {
    alias: "Strong style",
    description: "Strong style (`**` vs `__`) should be consistent",
  },
  MD051: {
    alias: "Link fragments should be valid",
    description: "Anchor link (#hash) does not match any heading in document",
  },
  MD052: {
    alias: "Reference links and images should use a label that is defined",
    description: "Reference link target is not defined in document",
  },
  MD053: {
    alias: "Link and image reference definitions should be needed",
    description: "Defined reference link is never used in content",
  },
  MD054: {
    alias: "Link and image style",
    description: "Link and image style (inline vs reference) should be consistent",
  },
  MD055: {
    alias: "Table pipe style",
    description: "Table outer pipe style (border) should be consistent",
  },
  MD056: {
    alias: "Table column count",
    description: "Table row column count does not match header count",
  },
  MD058: {
    alias: "Tables should be surrounded by blank lines",
    description: "Tables should be surrounded by blank lines above and below",
  },
};
