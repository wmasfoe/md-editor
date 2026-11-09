/**
 * @file style-exclusions.ts
 * @description
 * 用户排除列表的修改入口（文件树右键与设置页共用）。
 *
 * 排除列表保存在应用数据目录，不在工作区写入任何文件；
 * 排除后下一次扫描就不会再读取该文件，学习引擎会立刻去掉它对画像的贡献。
 */
import {
  isUserStyleExcluded,
  recomputeStyleRound,
  type StyleExclusionsDocument,
} from "@md-editor/ai/style";
import { updateStyleExclusions, updateStyleProfile } from "./style-learning-host";
import { renameExclusions, renameInStyleDocument } from "./style-learning-coordinator";
import { useStyleLearningStore } from "./style-learning-store";

/**
 * 排除列表变化后立即生效：把被排除的样本从画像中剔除并重新聚合（不调用模型），
 * 再请求一次学习轮次以纳入新恢复的文件。
 */
async function applyExclusions(
  rootPath: string,
  next: StyleExclusionsDocument,
): Promise<StyleExclusionsDocument> {
  useStyleLearningStore.getState().setExclusions(next);
  const store = useStyleLearningStore.getState();
  const workspace = store.profile?.workspaces.find(
    (candidate) => candidate.rootPath === rootPath && candidate.linkState === "linked",
  );
  if (store.profile && workspace) {
    const excluded = next.workspaces[rootPath] ?? [];
    // 工作区规则、全局层与采纳 AI 段在同一次重算中更新，排除的证据不会从任何一层漏回 prompt。
    const pruned = await updateStyleProfile((latest) =>
      recomputeStyleRound(latest, workspace.id, { excluded }),
    );
    store.setProfile(pruned);
  }
  // 恢复参与的文件需要重新读取与统计：交给学习协调器在空闲时处理。
  notifyStyleLearningChanged();
  return next;
}

/** 由主窗口注册；设置窗口没有学习协调器时为空操作 */
let changeListener: (() => void) | null = null;

export function onStyleLearningChanged(listener: () => void): () => void {
  changeListener = listener;
  return () => {
    if (changeListener === listener) changeListener = null;
  };
}

function notifyStyleLearningChanged(): void {
  changeListener?.();
}

async function updateExclusions(
  rootPath: string,
  update: (current: readonly string[]) => readonly string[],
): Promise<StyleExclusionsDocument> {
  const next = await updateStyleExclusions((latest) => ({
    ...latest,
    workspaces: {
      ...latest.workspaces,
      [rootPath]: [...update(latest.workspaces[rootPath] ?? [])],
    },
  }));
  return applyExclusions(rootPath, next);
}

/** 排除一个文件或目录（工作区相对路径） */
export function excludeStylePath(
  rootPath: string,
  relPath: string,
): Promise<StyleExclusionsDocument> {
  return updateExclusions(rootPath, (current) =>
    current.includes(relPath) ? current : [...current, relPath],
  );
}

/**
 * 恢复参与学习。路径本身在列表中时直接移除；
 * 若它是被上级目录排除的，则无法单独恢复，保持不变。
 */
export function restoreStylePath(
  rootPath: string,
  relPath: string,
): Promise<StyleExclusionsDocument> {
  return updateExclusions(rootPath, (current) => current.filter((entry) => entry !== relPath));
}

/** 应用内重命名或移动后同步排除路径 */
export function renameStyleExclusionPath(
  rootPath: string,
  from: string,
  to: string,
): Promise<StyleExclusionsDocument> {
  return updateExclusions(rootPath, (current) => renameExclusions(current, from, to));
}

/** 某个路径当前是否被排除（含被上级目录排除） */
export function isStylePathExcluded(
  document: StyleExclusionsDocument,
  rootPath: string,
  relPath: string,
): boolean {
  return isUserStyleExcluded(relPath, document.workspaces[rootPath] ?? []);
}

/**
 * 文件树中重命名或移动后，同步样本路径、采纳 AI 段记录与排除列表。
 * 只读写应用数据目录；风格学习从未开启过（没有画像）时不做任何事。
 */
export async function syncStyleLearningRename(
  rootPath: string,
  from: string,
  to: string,
): Promise<void> {
  const next = await updateStyleProfile((latest) =>
    renameInStyleDocument(latest, rootPath, from, to),
  );
  useStyleLearningStore.getState().setProfile(next);
  if ((useStyleLearningStore.getState().exclusions.workspaces[rootPath] ?? []).length > 0) {
    await renameStyleExclusionPath(rootPath, from, to);
  }
}

/**
 * 自动找回把画像改绑到新根目录后，把旧根目录的排除列表一并迁移（新根目录已有排除列表时不覆盖）。
 */
export async function moveStyleExclusions(fromRoot: string, toRoot: string): Promise<void> {
  if (fromRoot === toRoot) return;
  const next = await updateStyleExclusions((latest) => {
    const moved = latest.workspaces[fromRoot];
    if (!moved?.length || latest.workspaces[toRoot]?.length) return latest;
    const rest = Object.fromEntries(
      Object.entries(latest.workspaces).filter(([root]) => root !== fromRoot),
    );
    return { ...latest, workspaces: { ...rest, [toRoot]: moved } };
  });
  useStyleLearningStore.getState().setExclusions(next);
}
