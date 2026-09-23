/**
 * @fileoverview 文档替换身份声明 —— 宿主共用规则
 *
 * 渲染层需要知道「本次整篇替换是否仍属同一篇文档」，才能决定是否保留阅读位置（视口）。
 * 该判据**只能由宿主声明**（见 `DocumentReplaceIntent`）：同一性属于宿主的领域知识，
 * 渲染层不得从路径或内容反推（architect 终审驱动项 ①）。
 *
 * 本模块收敛宿主共用的**路径规则**，避免 desktop / web / utools 各写一份而漂移：
 * 仅当「当前文档路径」与「即将装载的路径」**都非空且相同**（= 重开当前已打开的文件）
 * 才视为同一篇文档；其余情况（换文件、新建未命名、划词新建）一律回落 fail-safe 的
 * `"different"`（视口归零）。
 *
 * 边界说明：**内容层面**的同一性（如「保存往返后内容几乎相同」）刻意不在此判断 ——
 * 那正是被移除的渲染层推断。确属同一文档但走整篇替换管道的场景（例如粘贴图片），
 * 应由宿主在该调用点**显式**声明 `"same"`。
 */

import type { DocumentReplaceIntent } from "./types/snapshot.ts";

/**
 * 由「当前文档路径」与「即将装载的路径」推导替换身份声明。
 *
 * @param currentFilePath 当前文档的路径（未命名文档为 `null`）
 * @param nextFilePath 即将装载文档的路径（未命名文档为 `null`）
 * @returns 重开同一文件时为 `"same"`，其余为 `"different"`
 */
export function resolveReplaceIntent(
  currentFilePath: string | null,
  nextFilePath: string | null,
): DocumentReplaceIntent {
  if (currentFilePath === null || nextFilePath === null) {
    return "different";
  }
  return currentFilePath === nextFilePath ? "same" : "different";
}
