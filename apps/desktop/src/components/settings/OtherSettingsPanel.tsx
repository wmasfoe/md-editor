import type { ErrorReportingSettings, LanguageSetting } from "../../app/settings/app-settings";
import { useTranslation } from "@md-editor/i18n";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
} from "./settingsStyles";

interface OtherSettingsPanelProps {
  readonly languageDraft: LanguageSetting;
  readonly assetsDirectoryDraft: string;
  readonly errorReportingDraft: ErrorReportingSettings;
  readonly onChangeLanguage: (value: LanguageSetting) => void;
  readonly onChangeAssetsDirectory: (value: string) => void;
  readonly onChangeErrorReporting: (value: ErrorReportingSettings) => void;
}

export function OtherSettingsPanel({
  languageDraft,
  assetsDirectoryDraft,
  errorReportingDraft,
  onChangeLanguage,
  onChangeAssetsDirectory,
  onChangeErrorReporting,
}: OtherSettingsPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5">
      <section className={settingsModuleClassName} aria-labelledby="language-settings-title">
        <div className="mb-3">
          <h2 id="language-settings-title" className={settingsSectionTitleClassName}>
            {t("settings.general.languageTitle")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.general.languageDesc")}</p>
        </div>
        <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
          <span className={settingsFieldLabelClassName}>{t("settings.general.languageField")}</span>
          <select
            className={settingsInputClassName}
            value={languageDraft}
            onChange={(event) => onChangeLanguage(event.target.value as LanguageSetting)}
          >
            <option value="system">{t("settings.general.languageSystem")}</option>
            <option value="zh">{t("settings.general.languageZh")}</option>
            <option value="zh-Hant">{t("settings.general.languageZhHant")}</option>
            <option value="en">{t("settings.general.languageEn")}</option>
            <option value="ja">{t("settings.general.languageJa")}</option>
          </select>
        </label>
      </section>

      <section className={settingsModuleClassName} aria-labelledby="assets-settings-title">
        <div className="mb-3">
          <h2 id="assets-settings-title" className={settingsSectionTitleClassName}>
            {t("settings.general.assetsTitle")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.general.assetsDesc")}</p>
        </div>
        <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
          <span className={settingsFieldLabelClassName}>{t("settings.general.assetsField")}</span>
          <input
            className={settingsInputClassName}
            value={assetsDirectoryDraft}
            onChange={(event) => onChangeAssetsDirectory(event.target.value)}
            placeholder="assets"
            spellCheck={false}
          />
        </label>
      </section>

      <section className={settingsModuleClassName} aria-labelledby="error-reporting-title">
        <div className="mb-3">
          <h2 id="error-reporting-title" className={settingsSectionTitleClassName}>
            {t("settings.general.errorReportingTitle")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.general.errorReportingDesc")}</p>
        </div>
        <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={errorReportingDraft.enabled}
            onChange={(event) => onChangeErrorReporting({ enabled: event.target.checked })}
          />
          <span>{t("settings.general.errorReportingEnable")}</span>
        </label>
      </section>
    </div>
  );
}
