/**
 * @file use-style-learning.ts
 * @description
 * 在主窗口挂载风格学习：加载本地画像、创建学习协调器，并把编辑器、文件树与设置的变化转发给它。
 */
import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { STANDARD_LOCAL_MODEL_ID } from "@md-editor/ai";
import { useTranslation } from "@md-editor/i18n";
import { desktopAiService } from "../desktop-ai-service";
import { desktopLocalAiBridge, readLocalAiModelStatus } from "../local-ai-model";
import { runtime } from "../../runtime/editor-runtime";
import { useAppSettings } from "../../settings-context";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { useToastStore } from "../../stores/toast-store";
import { listenToFolderChanged } from "../../../desktop/folder-watcher-events";
import {
  createDesktopStyleLearningHost,
  loadStyleExclusions,
  loadStyleProfile,
  saveStyleProfile,
} from "./style-learning-host";
import { StyleLearningCoordinator } from "./style-learning-coordinator";
import { clearPendingEditFeedback, flushEditFeedback } from "./edit-feedback-buffer";
import { workspaceRelativePath } from "./paths";
import { findLinkedWorkspaceProfile, useStyleLearningStore } from "./style-learning-store";

/** 文档保存后，把采纳 AI 文本之后的修改特征写入画像（只写特征，不写原文） */
function flushEditFeedbackOnSave(): void {
  const snapshot = runtime.document.getSnapshot();
  const rootPath = useFileTreeStore.getState().folder?.rootPath;
  const { profile, setProfile } = useStyleLearningStore.getState();
  const workspace = findLinkedWorkspaceProfile(profile, rootPath);
  const relPath =
    rootPath && snapshot.filePath ? workspaceRelativePath(rootPath, snapshot.filePath) : null;
  if (!profile || !workspace || !relPath) return;
  const next = flushEditFeedback(
    profile,
    workspace.id,
    relPath,
    snapshot.markdown,
    new Date().toISOString(),
  );
  if (next === profile) return;
  setProfile(next);
  void saveStyleProfile(next).catch(() => undefined);
}

export function useStyleLearning(): void {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const rootPath = useFileTreeStore((state) => state.folder?.rootPath ?? null);
  const coordinatorRef = useRef<StyleLearningCoordinator | null>(null);
  const enabled = settings.ai.styleLearning.enabled;

  // 创建协调器（主窗口生命周期内只有一个）。
  useEffect(() => {
    if (!isTauri()) return;
    const coordinator = new StyleLearningCoordinator(
      {
        now: () => Date.now(),
        setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        isDocumentDirty: () => runtime.document.getSnapshot().isDirty,
        isWindowVisible: () => document.visibilityState === "visible",
      },
      {
        run: async ({ rootPath: root, autoRelink, signal }) => {
          // 学习引擎依赖 Markdown 解析器，只在真正开始学习时加载，不影响启动包体。
          const { StyleLearningEngine } = await import("@md-editor/ai/style-engine");
          return new StyleLearningEngine({
            host: createDesktopStyleLearningHost(root),
            inference: {
              // 与续写、纠错共用同一个调度器，学习任务以独占方式派发并可被抢占。
              schedule: (options) => desktopAiService.scheduler.schedule(options),
              bridge: desktopLocalAiBridge,
            },
          }).run({ autoRelink, signal });
        },
      },
      {
        onDocumentChanged: (document) => useStyleLearningStore.getState().setProfile(document),
        onRelinked: () => useToastStore.getState().showToast(t("styleLearning.relinkedToast")),
      },
    );
    coordinatorRef.current = coordinator;

    const unsubscribeDocument = runtime.document.subscribeTransitions((event) => {
      if (event.transition.kind === "content") {
        coordinator.noteUserInput();
      } else if (event.transition.kind === "save-settled") {
        flushEditFeedbackOnSave();
        coordinator.noteWorkspaceChanged();
      }
    });
    const unlistenFolder = listenToFolderChanged(() => coordinator.noteWorkspaceChanged());
    const onVisibility = () => coordinator.noteWorkspaceChanged();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribeDocument();
      unlistenFolder?.();
      document.removeEventListener("visibilitychange", onVisibility);
      coordinator.dispose();
      coordinatorRef.current = null;
    };
  }, [t]);

  // 开启时加载本地画像与排除列表；关闭时只停止学习，保留数据直到用户清除。
  useEffect(() => {
    if (!enabled) clearPendingEditFeedback();
    if (!isTauri() || !enabled) return;
    let cancelled = false;
    void Promise.all([loadStyleProfile(), loadStyleExclusions()]).then(([profile, exclusions]) => {
      if (cancelled) return;
      useStyleLearningStore.getState().setProfile(profile);
      useStyleLearningStore.getState().setExclusions(exclusions);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // 设置、模型状态或工作区变化时更新学习前提。
  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;
    let cancelled = false;
    void readLocalAiModelStatus(STANDARD_LOCAL_MODEL_ID)
      .then((status) => status.status === "available")
      .catch(() => false)
      .then((standardModelReady) => {
        if (cancelled) return;
        coordinator.update({ settings: settings.ai, standardModelReady, rootPath });
      });
    return () => {
      cancelled = true;
    };
  }, [settings.ai, rootPath]);
}
