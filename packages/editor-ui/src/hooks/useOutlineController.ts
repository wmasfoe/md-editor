import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { extractHeadingOutline, findActiveHeadingIdForLine } from "@md-editor/markdown-fidelity";
import type { TocTarget } from "../types";

interface UseOutlineControllerOptions {
  readonly markdown: string;
  readonly showToast: (message: string | null) => void;
}

export function useOutlineController({ markdown, showToast }: UseOutlineControllerOptions) {
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const deferredMarkdown = useDeferredValue(markdown);
  const outline = useMemo(() => extractHeadingOutline(deferredMarkdown), [deferredMarkdown]);

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    const matched = outline.find(
      (item) => item.line === target.line && item.level === target.level && item.text === target.text
    );
    setActiveOutlineId(matched?.id ?? null);
    setTocTarget({ ...target, nonce: Date.now() });
  }, [outline]);

  const updateActiveOutlineForLine = useCallback(
    (line: number) => {
      setActiveOutlineId(findActiveHeadingIdForLine(outline, line));
    },
    [outline]
  );

  const jumpToMarkdownFragment = useCallback(
    (targetMarkdown: string, fragment: string | null) => {
      if (!fragment) {
        return;
      }

      const nextOutline = extractHeadingOutline(targetMarkdown);
      const item = nextOutline.find((candidate) => candidate.id === fragment);
      if (!item) {
        showToast(`没有找到标题 #${fragment}`);
        return;
      }

      setActiveOutlineId(item.id);
      setTocTarget({ line: item.line, level: item.level, text: item.text, nonce: Date.now() });
    },
    [showToast]
  );

  useEffect(() => {
    // 编辑可能删除或重命名当前标题，及时清掉过期 id，避免大纲高亮不存在的章节。
    if (activeOutlineId && !outline.some((item) => item.id === activeOutlineId)) {
      setActiveOutlineId(null);
    }
  }, [activeOutlineId, outline]);

  return {
    tocTarget,
    outline,
    activeOutlineId,
    setActiveOutlineId,
    jumpToTocItem,
    jumpToMarkdownFragment,
    updateActiveOutlineForLine
  };
}
