import type { ReactNode } from "react";
import { useTranslation } from "@md-editor/i18n";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settings-styles";

export type LanguageSetting = "system" | "zh" | "zh-Hant" | "en" | "ja";

export interface GeneralSettingsPanelProps {
  readonly language?: {
    readonly value: LanguageSetting;
    readonly onChange: (lang: LanguageSetting) => void;
  };
  readonly errorReporting?: {
    readonly enabled: boolean;
    readonly onChange: (enabled: boolean) => void;
  };
  readonly about?: {
    readonly appName?: string;
    readonly description?: string;
    readonly actionLabel?: string;
    readonly onOpen?: () => void;
  };
  readonly extraSections?: ReactNode;
}

/**
 * 通用系统与偏好设置面板（语言、遥测、关于信息与扩展插槽）
 */
export function GeneralSettingsPanel({
  language,
  errorReporting,
  about,
  extraSections,
}: GeneralSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-5">
      {language && (
        <section className={settingsModuleClassName} aria-labelledby="language-settings-title">
          <div className="mb-3">
            <h2 id="language-settings-title" className={settingsSectionTitleClassName}>
              {t("settings.general.languageTitle")}
            </h2>
            <p className={settingsDescriptionClassName}>{t("settings.general.languageDesc")}</p>
          </div>
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>
              {t("settings.general.languageField")}
            </span>
            <select
              className={settingsInputClassName}
              value={language.value}
              onChange={(event) => language.onChange(event.target.value as LanguageSetting)}
            >
              <option value="system">{t("settings.general.languageSystem")}</option>
              <option value="zh">{t("settings.general.languageZh")}</option>
              <option value="zh-Hant">{t("settings.general.languageZhHant")}</option>
              <option value="en">{t("settings.general.languageEn")}</option>
              <option value="ja">{t("settings.general.languageJa")}</option>
            </select>
          </label>
        </section>
      )}

      {errorReporting && (
        <section className={settingsModuleClassName} aria-labelledby="error-reporting-title">
          <div className="mb-3">
            <h2 id="error-reporting-title" className={settingsSectionTitleClassName}>
              {t("settings.general.errorReportingTitle")}
            </h2>
            <p className={settingsDescriptionClassName}>
              {t("settings.general.errorReportingDesc")}
            </p>
          </div>
          <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
            <input
              type="checkbox"
              checked={errorReporting.enabled}
              onChange={(event) => errorReporting.onChange(event.target.checked)}
              className="size-4 rounded border-[var(--theme-border)] accent-[var(--theme-primary)]"
            />
            <span>{t("settings.general.errorReportingEnable")}</span>
          </label>
        </section>
      )}

      {about && (
        <section className={settingsModuleClassName} aria-labelledby="about-settings-title">
          <div className="mb-3">
            <h2 id="about-settings-title" className={settingsSectionTitleClassName}>
              {about.appName ? t("about.windowTitle", { app: about.appName }) : t("settings.title")}
            </h2>
            <p className={settingsDescriptionClassName}>
              {about.description ?? t("settings.general.aboutDesc")}
            </p>
          </div>
          {about.onOpen && (
            <div className="flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
              <span className={settingsFieldLabelClassName}>
                {t("settings.general.aboutVersion")}
              </span>
              <button type="button" className={settingsSmallButtonClassName} onClick={about.onOpen}>
                {about.actionLabel ?? t("settings.general.aboutOpen")}
              </button>
            </div>
          )}
        </section>
      )}

      {extraSections}
    </div>
  );
}
