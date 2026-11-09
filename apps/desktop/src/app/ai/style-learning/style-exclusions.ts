/**
 * @file style-exclusions.ts
 * @description
 * 用户排除列表的修改入口（文件树右键与设置页共用）。
 *
 * 排除列表保存在应用数据目录，不在工作区写入任何文件；
 * 排除后下一次扫描就不会再读取该文件，学习引擎会立刻去掉它对画像的贡献。
 */
import { isUserStyleExcluded, type StyleExclusionsDocument } from "@md-editor/ai/style";
import {
  loadStyleExclusions,
  loadStyleProfile,
  saveStyleExclusions,
  saveStyleProfile,
} from "./style-learning-host";
import { renameExclusions, renameInStyleDocument } from "./style-learning-coordinator";
import { useStyleLearningStore } from "./style-learning-store";

async function updateExclusions(
  rootPath: string,
  update: (current: readonly string[]) => readonly string[],
): Promise<StyleExclusionsDocument> {
  const document = await loadStyleExclusions();
  const next: StyleExclusionsDocument = {
    ...document,
    workspaces: {
      ...document.workspaces,
      [rootPath]: [...update(document.workspaces[rootPath] ?? [])],
    },
  };
  await saveStyleExclusions(next);
  useStyleLearningStore.getState().setExclusions(next);
  return next;
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
  const profile = useStyleLearningStore.getState().profile ?? (await loadStyleProfile());
  if (profile) {
    const next = renameInStyleDocument(profile, rootPath, from, to);
    if (next !== profile) {
      useStyleLearningStore.getState().setProfile(next);
      await saveStyleProfile(next);
    }
  }
  const exclusions = await loadStyleExclusions();
  if ((exclusions.workspaces[rootPath] ?? []).length > 0) {
    await renameStyleExclusionPath(rootPath, from, to);
  }
}
