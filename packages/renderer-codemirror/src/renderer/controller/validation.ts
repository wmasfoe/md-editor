/**
 * @file validation.ts
 * @description 控制器入参校验与冻结：外部编辑/模式请求的 id 与版本号守卫。
 *
 * 这些守卫被控制器在端口入口处调用，故落在 `controller/` 下（而非 `renderer/index.ts`），
 * 以避免 `controller → index` 的反向运行期依赖。
 */

import type { ExternalEditRequest } from "../types.ts";
import type { ModeRequest } from "@md-editor/editor-core";

export function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function freezeExternalRequest(request: ExternalEditRequest): ExternalEditRequest {
  return Object.freeze({ ...request });
}

export function validateExternalRequest(request: ExternalEditRequest): void {
  if (
    request.operationId.length === 0 ||
    !isNonNegativeSafeInteger(request.expectedGeneration) ||
    !isNonNegativeSafeInteger(request.expectedContentRevision)
  ) {
    throw new Error("External edit requests require an id and non-negative safe revisions.");
  }
}

export function validateModeRequest(request: ModeRequest): void {
  if (
    request.operationId.length === 0 ||
    !isNonNegativeSafeInteger(request.expectedGeneration) ||
    !isNonNegativeSafeInteger(request.expectedStateRevision)
  ) {
    throw new Error("Mode requests require an id and non-negative safe revisions.");
  }
}
