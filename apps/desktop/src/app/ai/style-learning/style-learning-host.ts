/**
 * @file style-learning-host.ts
 * @description
 * 用 Tauri 命令实现 `@md-editor/ai/style` 的宿主端口。
 * 文件扫描、读取范围校验与本地持久化都在 Rust `style_learning` 模块中完成。
 */
import { invoke } from "@tauri-apps/api/core";
import {
  STYLE_DOCUMENT_VERSION,
  createEmptyStyleExclusionsDocument,
  type StyleExclusionsDocument,
  type StyleLearningHost,
  type StyleProfileDocument,
  type StyleSampleScanResult,
} from "@md-editor/ai/style";

type StyleDocumentKind = "profile" | "exclusions";

async function loadDocument<T>(kind: StyleDocumentKind): Promise<T | null> {
  const document = await invoke<T | null>("load_style_learning_document", { kind });
  return document ?? null;
}

async function saveDocument(kind: StyleDocumentKind, document: unknown): Promise<void> {
  await invoke("save_style_learning_document", { kind, document });
}

export async function loadStyleExclusions(): Promise<StyleExclusionsDocument> {
  const document = await loadDocument<StyleExclusionsDocument>("exclusions");
  return document?.version === STYLE_DOCUMENT_VERSION
    ? document
    : createEmptyStyleExclusionsDocument();
}

export function saveStyleExclusions(document: StyleExclusionsDocument): Promise<void> {
  return saveDocument("exclusions", document);
}

export function loadStyleProfile(): Promise<StyleProfileDocument | null> {
  return loadDocument<StyleProfileDocument>("profile");
}

export function saveStyleProfile(document: StyleProfileDocument): Promise<void> {
  return saveDocument("profile", document);
}

/** 清除画像、样本特征与采纳 AI 段记录；排除列表单独保留 */
export function clearStyleProfile(): Promise<void> {
  return invoke("clear_style_learning_document", { kind: "profile" });
}

export function clearStyleExclusions(): Promise<void> {
  return invoke("clear_style_learning_document", { kind: "exclusions" });
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
        excluded: exclusions.workspaces[rootPath] ?? [],
      });
    },
    readSample: (relPath) => invoke<string>("read_style_learning_sample", { relPath }),
    loadProfile: loadStyleProfile,
    saveProfile: saveStyleProfile,
  };
}
