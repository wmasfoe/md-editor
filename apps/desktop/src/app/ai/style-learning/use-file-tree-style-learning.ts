/**
 * @file use-file-tree-style-learning.ts
 * @description
 * 文件树右键菜单的“不参与 / 恢复参与风格学习”：只在风格学习开启且选中节点时出现，点击后无弹窗。
 */
import { useCallback } from "react";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { useAppSettings } from "../../settings-context";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { excludeStylePath, isStylePathExcluded, restoreStylePath } from "./style-exclusions";
import { useStyleLearningStore } from "./style-learning-store";
import { workspaceRelativePath } from "./paths";

export type FileTreeStyleLearningItem = "exclude" | "restore" | null;

export interface FileTreeStyleLearning {
  /** 某个节点应显示的菜单项；风格学习关闭或节点不在工作区内时为 null */
  readonly itemFor: (node: MarkdownFileTreeNode | null) => FileTreeStyleLearningItem;
  readonly exclude: (node: MarkdownFileTreeNode) => Promise<void>;
  readonly restore: (node: MarkdownFileTreeNode) => Promise<void>;
}

export function useFileTreeStyleLearning(): FileTreeStyleLearning {
  const { settings } = useAppSettings();
  const enabled = settings.ai.styleLearning.enabled;
  const rootPath = useFileTreeStore((state) => state.folder?.rootPath ?? null);
  const exclusions = useStyleLearningStore((state) => state.exclusions);

  const relPathOf = useCallback(
    (node: MarkdownFileTreeNode | null) =>
      node && rootPath ? workspaceRelativePath(rootPath, node.path) : null,
    [rootPath],
  );

  const itemFor = useCallback(
    (node: MarkdownFileTreeNode | null): FileTreeStyleLearningItem => {
      const relPath = relPathOf(node);
      if (!enabled || !rootPath || !relPath) return null;
      return isStylePathExcluded(exclusions, rootPath, relPath) ? "restore" : "exclude";
    },
    [enabled, exclusions, relPathOf, rootPath],
  );

  const exclude = useCallback(
    async (node: MarkdownFileTreeNode) => {
      const relPath = relPathOf(node);
      if (rootPath && relPath) await excludeStylePath(rootPath, relPath);
    },
    [relPathOf, rootPath],
  );

  const restore = useCallback(
    async (node: MarkdownFileTreeNode) => {
      const relPath = relPathOf(node);
      if (rootPath && relPath) await restoreStylePath(rootPath, relPath);
    },
    [relPathOf, rootPath],
  );

  return { itemFor, exclude, restore };
}
