/**
 * @file style-profile-request.ts
 * @description
 * 为写作请求提供当前工作区的合并写作偏好，并处理云端使用写作偏好的授权。
 *
 * 画像是否真正进入 prompt 由 `AiWritingService` 内的闸门决定（开关、Lite、云端授权）；
 * 这里只负责取到画像，以及在用户手动续写时询问云端授权。自动幽灵续写从不弹窗。
 */
import { isRemoteAiProvider, type AiSettings } from "@md-editor/ai";
import { renderStylePrefix, styleCloudScope, type MergedStyleProfile } from "@md-editor/ai/style";
import { t } from "@md-editor/i18n";
import { saveAppSettings, type AppSettings } from "../../settings/app-settings";
import { useConfirmationStore } from "../../stores/confirmation-store";
import { useFileTreeStore } from "../../stores/file-tree-store";
import { resolveMergedStyleProfile, useStyleLearningStore } from "./style-learning-store";

/** 当前工作区的合并写作偏好（未经过闸门）；风格学习关闭时返回 undefined */
export function getStyleProfileForRequest(settings: AiSettings): MergedStyleProfile | undefined {
  if (!settings.styleLearning.enabled) return undefined;
  return resolveMergedStyleProfile(
    useStyleLearningStore.getState().profile,
    useFileTreeStore.getState().folder?.rootPath,
  );
}

/** 当前设置下，云端请求是否需要先取得写作偏好授权 */
export function needsStyleCloudConsent(
  settings: AiSettings,
  profile: MergedStyleProfile | undefined,
): boolean {
  if (!settings.styleLearning.enabled || !profile || profile.rules.length === 0) return false;
  if (!isRemoteAiProvider(settings.provider)) return false;
  const scope = styleCloudScope(settings);
  const consent = settings.styleLearning.cloudConsent;
  return !(consent && consent.provider === scope.provider && consent.origin === scope.origin);
}

/**
 * 手动续写前调用：需要授权时弹出确认框，列出将发送的规则文字。
 * 用户同意后保存授权并返回更新后的设置；拒绝时返回原设置（请求不会附带写作偏好）。
 */
export async function ensureStyleCloudConsent(
  appSettings: AppSettings,
  profile: MergedStyleProfile | undefined,
): Promise<AppSettings> {
  if (!needsStyleCloudConsent(appSettings.ai, profile)) return appSettings;
  const scope = styleCloudScope(appSettings.ai);
  const choice = await useConfirmationStore.getState().requestConfirmation({
    title: t("styleLearning.consentTitle"),
    description: t("styleLearning.consentDesc", {
      origin: scope.origin,
      rules: renderStylePrefix(profile),
    }),
    confirmLabel: t("styleLearning.consentAllow"),
  });
  if (choice !== "confirm") return appSettings;
  const next: AppSettings = {
    ...appSettings,
    ai: {
      ...appSettings.ai,
      styleLearning: {
        ...appSettings.ai.styleLearning,
        cloudConsent: { ...scope, grantedAt: new Date().toISOString() },
      },
    },
  };
  return saveAppSettings(next);
}
