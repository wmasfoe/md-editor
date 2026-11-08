/**
 * @file style-learning-store.ts
 * @description
 * 桌面端风格学习的共享状态：本地画像文档、排除列表与本地 Standard 是否就绪。
 *
 * 学习协调器写入，设置页与写作请求读取。画像只在本机保存，这里只是内存镜像。
 */
import { create } from "zustand";
import {
  createEmptyStyleExclusionsDocument,
  mergeStyleProfile,
  type MergedStyleProfile,
  type StyleExclusionsDocument,
  type StyleProfileDocument,
  type WorkspaceStyleProfileRecord,
} from "@md-editor/ai/style";

export interface StyleLearningStore {
  readonly profile: StyleProfileDocument | null;
  readonly exclusions: StyleExclusionsDocument;
  readonly setProfile: (profile: StyleProfileDocument | null) => void;
  readonly setExclusions: (exclusions: StyleExclusionsDocument) => void;
}

export const useStyleLearningStore = create<StyleLearningStore>((set) => ({
  profile: null,
  exclusions: createEmptyStyleExclusionsDocument(),
  setProfile: (profile) => set({ profile }),
  setExclusions: (exclusions) => set({ exclusions }),
}));

/** 当前工作区对应的已关联画像 */
export function findLinkedWorkspaceProfile(
  profile: StyleProfileDocument | null,
  rootPath: string | null | undefined,
): WorkspaceStyleProfileRecord | undefined {
  if (!profile || !rootPath) return undefined;
  return profile.workspaces.find(
    (workspace) => workspace.rootPath === rootPath && workspace.linkState === "linked",
  );
}

/**
 * 计算某个工作区写作请求使用的合并画像（尚未经过闸门）。
 * 工作区失去关联或尚未学习时，只使用全局画像与自定义规则。
 */
export function resolveMergedStyleProfile(
  profile: StyleProfileDocument | null,
  rootPath: string | null | undefined,
): MergedStyleProfile | undefined {
  if (!profile) return undefined;
  const merged = mergeStyleProfile({
    global: profile.global.rules,
    workspace: findLinkedWorkspaceProfile(profile, rootPath)?.rules,
    custom: profile.custom,
  });
  return merged.rules.length > 0 ? merged : undefined;
}
