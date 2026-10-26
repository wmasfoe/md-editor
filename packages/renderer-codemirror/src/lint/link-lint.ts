import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import type { LinkLintOptions } from "./types.ts";

/**
 * 将外部传入的链接检查结果投影为 CM6 Diagnostic
 */
export async function runLinkValidation(
  state: EditorState,
  options: LinkLintOptions,
): Promise<Diagnostic[]> {
  const text = state.doc.toString();
  if (!text.trim() || !options.validateLinks) {
    return [];
  }

  try {
    const items = await options.validateLinks(text);
    const diagnostics: Diagnostic[] = [];

    for (const item of items) {
      let from: number;
      let to: number;

      if (typeof item.from === "number" && typeof item.to === "number") {
        from = Math.max(0, Math.min(item.from, state.doc.length));
        to = Math.max(from, Math.min(item.to, state.doc.length));
      } else if (typeof item.line === "number" && item.line > 0 && item.line <= state.doc.lines) {
        const line = state.doc.line(item.line);
        from = Math.min(line.from + Math.max(0, (item.col ?? 1) - 1), line.to);
        to = Math.min(from + Math.max(1, item.target?.length ?? 1), line.to);
      } else {
        continue;
      }

      diagnostics.push({
        from,
        to,
        severity: item.severity ?? "error",
        message: `[链接检查] ${item.message}`,
      });
    }

    return diagnostics;
  } catch (error) {
    console.warn("链接检查执行异常:", error);
    return [];
  }
}
