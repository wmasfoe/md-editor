/**
 * @file style/gate.ts
 * @module @md-editor/ai/style
 * @description
 * 画像闸门：决定一次写作请求能否附带画像。
 *
 * 闸门依据宿主传入的设置与合并画像判断；宿主（desktop 组合根）是可信代码，
 * 闸门防的是漏传、误传，例如 Lite 模型或未授权的云端请求意外带上画像。
 */

import { isLiteLocalModel } from "../domain/settings.ts";
import type { AiSettings, AiStyleLearningSettings } from "../domain/types.ts";
import type { MergedStyleProfile } from "./types.ts";

export type StyleGateDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "disabled" | "empty" | "lite-model" | "cloud-consent-required";
    };

/** 当前云端端点的授权范围：provider + 服务地址的 origin */
export function styleCloudScope(settings: AiSettings): { provider: string; origin: string } {
  const endpoint =
    settings.provider === "local" ? undefined : settings.endpoints[settings.provider];
  return { provider: settings.provider, origin: originOf(endpoint?.baseUrl ?? "") };
}

export function evaluateStyleGate(
  settings: AiSettings,
  styleLearning: AiStyleLearningSettings,
  profile: MergedStyleProfile | undefined,
): StyleGateDecision {
  if (!styleLearning.enabled) {
    return { allowed: false, reason: "disabled" };
  }
  if (!profile || profile.rules.length === 0) {
    return { allowed: false, reason: "empty" };
  }
  if (settings.provider === "local") {
    // Lite 的 FIM 续写与 GEC 都没有可靠的指令注入位置。
    return isLiteLocalModel(settings.localModel.modelId)
      ? { allowed: false, reason: "lite-model" }
      : { allowed: true };
  }
  const scope = styleCloudScope(settings);
  const consent = styleLearning.cloudConsent;
  const consented =
    consent !== null && consent.provider === scope.provider && consent.origin === scope.origin;
  return consented ? { allowed: true } : { allowed: false, reason: "cloud-consent-required" };
}

/** 通过闸门时返回画像本身，否则返回 undefined */
export function gateStyleProfile(
  settings: AiSettings,
  styleLearning: AiStyleLearningSettings,
  profile: MergedStyleProfile | undefined,
): MergedStyleProfile | undefined {
  return evaluateStyleGate(settings, styleLearning, profile).allowed ? profile : undefined;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.trim();
  }
}
