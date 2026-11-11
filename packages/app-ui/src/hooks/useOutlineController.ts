import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  extractHeadingOutline,
  findActiveHeadingIdForLine,
  resolveHeadingAnchor,
  type HeadingOutlineItem,
} from "@md-editor/markdown-fidelity";
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
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    const matched = outlineRef.current.find(
      (item) =>
        item.line === target.line && item.level === target.level && item.text === target.text,
    );
    setActiveOutlineId(matched?.id ?? null);
    setTocTarget({ ...target, nonce: Date.now() });
  }, []);

  const updateActiveOutlineForLine = useCallback((line: number) => {
    setActiveOutlineId(findActiveHeadingIdForLine(outlineRef.current, line));
  }, []);

  /**
   * 跳转到文档内锚点（`#fragment`）。
   *
   * 锚点解析交给 markdown-fidelity：文档内锚点由 TOC 生成器或人工撰写，
   * 对 `、：（）➔` 等标点的处理并不一致，必须容忍这些差异才能命中标题。
   *
   * @returns 命中的标题项（供调用方滚动定位）；未命中返回 null 并提示。
   */
  const jumpToMarkdownFragment = useCallback(
    (targetMarkdown: string, fragment: string | null): HeadingOutlineItem | null => {
      if (!fragment) {
        return null;
      }

      const item = resolveHeadingAnchor(targetMarkdown, fragment);
      if (!item) {
        showToast(`没有找到标题 #${fragment}`);
        return null;
      }

      setActiveOutlineId(item.id);
      setTocTarget({ line: item.line, level: item.level, text: item.text, nonce: Date.now() });
      return item;
    },
    [showToast],
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
    updateActiveOutlineForLine,
  };
}
