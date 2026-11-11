/**
 * @file use-accepted-ai-text.ts
 * @description
 * 记录用户采纳的 AI 文本（只存句子 hash），学习时跳过这些句子，避免把模型措辞学成用户风格。
 */
import { useCallback } from "react";
import type { AiSuggestionAcceptedEvent } from "@md-editor/editor";
import { runtime } from "../../runtime/editor-runtime";
import { useAppSettings } from "../../settings-context";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { rememberAcceptedAiText } from "./edit-feedback-buffer";
import { workspaceRelativePath } from "./paths";
import { recordAcceptedAiText } from "./style-learning-coordinator";
import { updateStyleProfile } from "./style-learning-host";
import { findLinkedWorkspaceProfile, useStyleLearningStore } from "./style-learning-store";

export function useAcceptedAiTextRecorder(): (event: AiSuggestionAcceptedEvent) => void {
  const { settings } = useAppSettings();
  const enabled = settings.ai.styleLearning.enabled;

  return useCallback(
    (event: AiSuggestionAcceptedEvent) => {
      if (!enabled) return;
      const rootPath = useFileTreeStore.getState().folder?.rootPath;
      const filePath = runtime.document.getSnapshot().filePath;
      const { profile, setProfile } = useStyleLearningStore.getState();
      const workspace = findLinkedWorkspaceProfile(profile, rootPath);
      if (!rootPath || !filePath || !profile || !workspace) return;
      const relPath = workspaceRelativePath(rootPath, filePath);
      if (!relPath) return;
      // 原文只留在内存，保存时用于提取“用户改了什么”，随后丢弃。
      rememberAcceptedAiText(workspace.id, relPath, event.text);
      // 基于最新文档追加 hash，避免覆盖学习轮次或其他窗口的写入；失败时下次采纳再补。
      void updateStyleProfile((latest) =>
        recordAcceptedAiText(latest, workspace.id, relPath, event.text),
      )
        .then(setProfile)
        .catch(() => undefined);
    },
    [enabled],
  );
}
