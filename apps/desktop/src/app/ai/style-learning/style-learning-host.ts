/**
 * @file style-learning-host.ts
 * @description
 * 用 Tauri 命令实现 `@md-editor/ai/style` 的宿主端口。
 * 文件扫描、读取范围校验与本地持久化都在 Rust `style_learning` 模块中完成。
 */
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  STYLE_DOCUMENT_VERSION,
  createEmptyStyleExclusionsDocument,
  createEmptyStyleProfileDocument,
  type StyleExclusionsDocument,
  type StyleLearningHost,
  type StyleProfileDocument,
  type StyleSampleScanResult,
} from "@md-editor/ai/style";

type StyleDocumentKind = "profile" | "exclusions";

/** 存储层拒绝基于过期副本写入时返回的错误（与 Rust `STALE_DOCUMENT_ERROR` 一致） */
const STALE_DOCUMENT_ERROR = "style-learning-stale";
/** 画像文档变化（保存或清除）时广播给所有窗口的事件 */
export const STYLE_PROFILE_CHANGED_EVENT = "md-editor-style-profile-changed";
export const STYLE_EXCLUSIONS_CHANGED_EVENT = "md-editor-style-exclusions-changed";
const MAX_UPDATE_ATTEMPTS = 5;

async function loadDocument<T>(kind: StyleDocumentKind): Promise<T | null> {
  const document = await invoke<T | null>("load_style_learning_document", { kind });
  return document ?? null;
}

function revisionOf(document: unknown): number {
  const revision = (document as { revision?: unknown } | null)?.revision;
  return typeof revision === "number" ? revision : 0;
}

function isStaleError(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes(STALE_DOCUMENT_ERROR);
}

/**
 * 读取最新文档 → 应用修改 → 按 revision 比较后写入；其他写入者抢先时重试。
 * 所有窗口、学习轮次与编辑器记录都经过这里，任何一方都不会覆盖其他方的修改。
 */
async function updateDocument<T>(
  kind: StyleDocumentKind,
  empty: () => T,
  mutate: (latest: T) => T,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const latest = (await loadDocument<T>(kind)) ?? empty();
    const next = mutate(latest);
    // 修改函数没有改动任何内容时不写盘，也不广播。
    if (next === latest) return latest;
    try {
      const revision = await invoke<number>("save_style_learning_document", {
        kind,
        document: next,
        expectedRevision: revisionOf(latest),
      });
      const saved = { ...next, revision } as T;
      await emit(
        kind === "profile" ? STYLE_PROFILE_CHANGED_EVENT : STYLE_EXCLUSIONS_CHANGED_EVENT,
        saved,
      );
      return saved;
    } catch (error) {
      if (!isStaleError(error) || attempt >= MAX_UPDATE_ATTEMPTS) throw error;
    }
  }
}

export async function loadStyleExclusions(): Promise<StyleExclusionsDocument> {
  const document = await loadDocument<StyleExclusionsDocument>("exclusions");
  return document?.version === STYLE_DOCUMENT_VERSION
    ? document
    : createEmptyStyleExclusionsDocument();
}

export function updateStyleExclusions(
  mutate: (latest: StyleExclusionsDocument) => StyleExclusionsDocument,
): Promise<StyleExclusionsDocument> {
  return updateDocument("exclusions", createEmptyStyleExclusionsDocument, mutate);
}

export function loadStyleProfile(): Promise<StyleProfileDocument | null> {
  return loadDocument<StyleProfileDocument>("profile");
}

/** 修改画像的唯一入口：基于最新文档修改，冲突时重试，并通知所有窗口 */
export function updateStyleProfile(
  mutate: (latest: StyleProfileDocument) => StyleProfileDocument,
): Promise<StyleProfileDocument> {
  return updateDocument("profile", createEmptyStyleProfileDocument, mutate);
}

/** 清除画像、样本特征与采纳 AI 段记录；排除列表单独保留。清除后通知所有窗口 */
export async function clearStyleProfile(): Promise<void> {
  await invoke("clear_style_learning_document", { kind: "profile" });
  await emit(STYLE_PROFILE_CHANGED_EVENT, null);
}

export async function clearStyleExclusions(): Promise<void> {
  await invoke("clear_style_learning_document", { kind: "exclusions" });
  await emit(STYLE_EXCLUSIONS_CHANGED_EVENT, createEmptyStyleExclusionsDocument());
}

/**
 * 创建某个工作区的学习宿主。`rootPath` 必须是文件树当前打开的根目录（与 Rust 侧登记的范围一致），
 * 排除列表在每次扫描前读取，保证右键排除立即生效。
 */
export function createDesktopStyleLearningHost(rootPath: string): StyleLearningHost {
  return {
    async scanSamples() {
      const exclusions = await loadStyleExclusions();
      return invoke<StyleSampleScanResult>("scan_style_learning_samples", {
        // Rust 侧确认当前范围仍是这个根目录，工作区已切换时拒绝扫描。
        expectedRoot: rootPath,
        excluded: exclusions.workspaces[rootPath] ?? [],
      });
    },
    readSample: (relPath) =>
      invoke<string>("read_style_learning_sample", { expectedRoot: rootPath, relPath }),
    loadProfile: loadStyleProfile,
    updateProfile: updateStyleProfile,
  };
}
