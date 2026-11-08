/**
 * @file use-style-learning-data.ts
 * @description
 * 让任意窗口（主窗口、独立设置窗口）都持有最新的画像与排除列表：
 * 开启风格学习时从本地读取一次，之后跟随其他窗口与学习轮次广播的变化。
 */
import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StyleExclusionsDocument, StyleProfileDocument } from "@md-editor/ai/style";
import { safeUnlisten } from "../../../desktop/safe-unlisten";
import {
  STYLE_EXCLUSIONS_CHANGED_EVENT,
  STYLE_PROFILE_CHANGED_EVENT,
  loadStyleExclusions,
  loadStyleProfile,
} from "./style-learning-host";
import { useStyleLearningStore } from "./style-learning-store";

export function useStyleLearningData(enabled: boolean): void {
  useEffect(() => {
    if (!isTauri() || !enabled) return;
    let cancelled = false;
    void Promise.all([loadStyleProfile(), loadStyleExclusions()]).then(([profile, exclusions]) => {
      if (cancelled) return;
      useStyleLearningStore.getState().setProfile(profile);
      useStyleLearningStore.getState().setExclusions(exclusions);
    });

    const unlisteners: Array<Promise<() => void>> = [
      listen<StyleProfileDocument | null>(STYLE_PROFILE_CHANGED_EVENT, (event) =>
        useStyleLearningStore.getState().setProfile(event.payload),
      ),
      listen<StyleExclusionsDocument>(STYLE_EXCLUSIONS_CHANGED_EVENT, (event) =>
        useStyleLearningStore.getState().setExclusions(event.payload),
      ),
    ];
    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        void unlisten.then((dispose) => safeUnlisten(dispose)).catch(() => undefined);
      }
    };
  }, [enabled]);
}
