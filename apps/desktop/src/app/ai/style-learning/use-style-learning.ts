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
import { desktopLocalAiBridge, onLocalAiUse, readLocalAiModelStatus } from "../local-ai-model";
import { runtime } from "../../runtime/editor-runtime";
import { useAppSettings } from "../../settings-context";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { useToastStore } from "../../stores/toast-store";
import { listenToFolderChanged } from "../../../desktop/folder-watcher-events";
import { createDesktopStyleLearningHost, updateStyleProfile } from "./style-learning-host";
import { useStyleLearningData } from "./use-style-learning-data";
import { moveStyleExclusions, onStyleLearningChanged, undoStyleRelinkTo } from "./style-exclusions";
import { StyleLearningCoordinator } from "./style-learning-coordinator";
import {
  clearPendingEditFeedback,
  takeEditFeatures,
  withEditFeatures,
} from "./edit-feedback-buffer";
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
  const features = takeEditFeatures(
    workspace.id,
    relPath,
    snapshot.markdown,
    new Date().toISOString(),
  );
  if (features.length === 0) return;
  void updateStyleProfile((latest) => withEditFeatures(latest, workspace.id, features))
    .then(setProfile)
    .catch(() => undefined);
}

/** 创建当前工作区的学习引擎（引擎依赖 Markdown 解析器，按需加载） */
async function createStyleLearningEngine(rootPath: string) {
  const { StyleLearningEngine } = await import("@md-editor/ai/style-engine");
  return new StyleLearningEngine({
    host: createDesktopStyleLearningHost(rootPath),
    inference: {
      // 与续写、纠错共用同一个调度器，学习任务以独占方式派发并可被抢占。
      schedule: (options) => desktopAiService.scheduler.schedule(options),
      bridge: desktopLocalAiBridge,
    },
  });
}

async function verifyStyleWorkspace(rootPath: string, signal: AbortSignal): Promise<boolean> {
  return (await createStyleLearningEngine(rootPath)).verifyWorkspace(signal);
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
        run: async ({ rootPath: root, autoRelink, signal }) =>
          (await createStyleLearningEngine(root)).run({ autoRelink, signal }),
      },
      {
        onDocumentChanged: (document) => {
          const store = useStyleLearningStore.getState();
          store.setProfile(document);
          // 学习轮次写入前已做过身份校验，仍关联的工作区可以直接应用画像。
          const root = useFileTreeStore.getState().folder?.rootPath ?? null;
          store.setVerifiedRoot(findLinkedWorkspaceProfile(document, root) ? root : null);
        },
        schedulerMetrics: () => desktopAiService.scheduler.waitMetrics,
        onRelinked: ({ fromRoot, toRoot, profileId }) => {
          void moveStyleExclusions(fromRoot, toRoot).catch(() => undefined);
          // 提示里直接提供“撤销”：不需要用户再去找设置页。
          useToastStore.getState().showToast(t("styleLearning.relinkedToast"), {
            label: t("styleLearning.undoRelink"),
            run: () => {
              void undoStyleRelinkTo(profileId, toRoot, fromRoot).catch(() => undefined);
            },
          });
        },
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
    // 写作模型为 Lite 时，用户刚用过本地模型就不为学习切换到 Standard。
    const unlistenLocalAi = onLocalAiUse(() => coordinator.noteLocalAiUse());
    // 设置页或文件树排除/恢复文件后立即重新聚合，并在空闲时补读恢复的文件。
    const unlistenExclusions = onStyleLearningChanged(() => coordinator.noteWorkspaceChanged());
    const onVisibility = () => coordinator.noteVisibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribeDocument();
      unlistenFolder?.();
      unlistenLocalAi();
      unlistenExclusions();
      document.removeEventListener("visibilitychange", onVisibility);
      coordinator.dispose();
      coordinatorRef.current = null;
    };
  }, [t]);

  // 开启时加载本地画像与排除列表并跟随其他窗口的变化；关闭时丢弃内存中暂存的 AI 原文。
  useStyleLearningData(enabled);
  useEffect(() => {
    if (!enabled) clearPendingEditFeedback();
  }, [enabled]);

  // 打开或切换工作区时先做身份校验（不需要模型）；通过之前只使用全局画像与自定义规则。
  useEffect(() => {
    useStyleLearningStore.getState().setVerifiedRoot(null);
    if (!isTauri() || !enabled || !rootPath) return;
    const controller = new AbortController();
    void verifyStyleWorkspace(rootPath, controller.signal)
      .then((linked) => {
        if (linked && !controller.signal.aborted) {
          useStyleLearningStore.getState().setVerifiedRoot(rootPath);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, rootPath]);

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
