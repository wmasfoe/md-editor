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
  /** 本次会话中已通过身份校验的工作区根目录；未校验的工作区不应用其画像 */
  readonly verifiedRoot: string | null;
  readonly setProfile: (profile: StyleProfileDocument | null) => void;
  readonly setExclusions: (exclusions: StyleExclusionsDocument) => void;
  readonly setVerifiedRoot: (rootPath: string | null) => void;
}

export const useStyleLearningStore = create<StyleLearningStore>((set) => ({
  profile: null,
  exclusions: createEmptyStyleExclusionsDocument(),
  verifiedRoot: null,
  // 广播事件与本地写入的回调可能乱序到达：同一数据代次只接受不更旧的 revision。
  setProfile: (profile) =>
    set((state) => (isNewerProfile(state.profile, profile) ? { profile } : state)),
  setExclusions: (exclusions) => set({ exclusions }),
  setVerifiedRoot: (verifiedRoot) => set({ verifiedRoot }),
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
  verifiedRoot: string | null,
): MergedStyleProfile | undefined {
  if (!profile) return undefined;
  // 本次会话尚未通过身份校验的工作区，只使用全局画像与自定义规则。
  const verified = Boolean(rootPath) && rootPath === verifiedRoot;
  const merged = mergeStyleProfile({
    global: profile.global.rules,
    workspace: verified ? findLinkedWorkspaceProfile(profile, rootPath)?.rules : undefined,
    custom: profile.custom,
  });
  return merged.rules.length > 0 ? merged : undefined;
}

/** `next` 是否应替换 `current`：清除（null）、新数据代次或不更旧的 revision */
export function isNewerProfile(
  current: StyleProfileDocument | null,
  next: StyleProfileDocument | null,
): boolean {
  if (!next || !current) return true;
  if (next.epoch !== current.epoch) return true;
  return (next.revision ?? 0) >= (current.revision ?? 0);
}
