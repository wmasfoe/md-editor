/**
 * @file use-style-learning-root.ts
 * @description
 * 当前工作区根目录。主窗口直接读文件树；独立设置窗口没有文件树，
 * 从 Rust 侧的学习范围读取，并在窗口重新获得焦点或画像变化时刷新。
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { useStyleLearningStore } from "./style-learning-store";

export function useStyleLearningRoot(): string | null {
  const treeRoot = useFileTreeStore((state) => state.folder?.rootPath ?? null);
  const profile = useStyleLearningStore((state) => state.profile);
  const [scopeRoot, setScopeRoot] = useState<string | null>(null);

  useEffect(() => {
    if (treeRoot || !isTauri()) return;
    let cancelled = false;
    const refresh = () =>
      void invoke<string | null>("get_style_learning_root")
        .then((root) => {
          if (!cancelled) setScopeRoot(root ?? null);
        })
        .catch(() => undefined);
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [treeRoot, profile]);

  return treeRoot ?? scopeRoot;
}
