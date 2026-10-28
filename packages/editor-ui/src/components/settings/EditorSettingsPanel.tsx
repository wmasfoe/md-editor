/**
 * @fileoverview 跨端统一编辑器配置面板组件 (Editor Settings Panel)
 */

import { useTranslation } from "@md-editor/i18n";
import {
  CODE_FONT_OPTIONS,
  PROSE_FONT_OPTIONS,
  WYSIWYG_FONT_SIZE_MAX,
  WYSIWYG_FONT_SIZE_MIN,
} from "../../themes/editor-fonts";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
} from "./settings-styles";

export interface EditorSettingsPanelProps {
  readonly fontSize: {
    readonly value: number;
    readonly onChange: (value: number) => void;
  };
  readonly proseFont?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
  };
  readonly codeFont?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
  };
  readonly showLineNumbers: {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
  };
  readonly showInlineStyleMarkers: {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
  };
  readonly enableMarkdownLint: {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
  };
  /** 可选当前编辑模式切换（如 Web 端传入即展示，未传自动隐藏） */
  readonly editorMode?: {
    readonly mode: "wysiwyg" | "source";
    readonly onChange: (mode: "wysiwyg" | "source") => void;
  };
  /** 可选图片相对保存目录（仅支持本地文档保存的 Desktop 传入，Web/uTools 自动隐藏） */
  readonly assetsDirectory?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
  };
}

export function EditorSettingsPanel({
  fontSize,
  proseFont,
  codeFont,
  showLineNumbers,
  showInlineStyleMarkers,
  enableMarkdownLint,
  editorMode,
  assetsDirectory,
}: EditorSettingsPanelProps) {
  const { t } = useTranslation();

  const isCustomProse =
    Boolean(proseFont?.value) && !PROSE_FONT_OPTIONS.some((opt) => opt.id === proseFont?.value);

  const isCustomCode =
    Boolean(codeFont?.value) && !CODE_FONT_OPTIONS.some((opt) => opt.id === codeFont?.value);

  return (
    <div className="grid gap-5">
      {/* 模块 1：字体与排版 */}
      <section className={settingsModuleClassName} aria-labelledby="editor-font-title">
        <div className="mb-3">
          <h2 id="editor-font-title" className={settingsSectionTitleClassName}>
            {t("settings.appearance.fontTitle")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.appearance.fontDesc")}</p>
        </div>

        <div className="grid gap-3">
          {editorMode ? (
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>
                {t("web.currentEditorMode", { defaultValue: "编辑模式" })}
              </span>
              <select
                className={settingsInputClassName}
                value={editorMode.mode}
                onChange={(event) =>
                  editorMode.onChange(event.target.value as "wysiwyg" | "source")
                }
              >
                <option value="wysiwyg">
                  {t("web.wysiwygMode", { defaultValue: "所见即所得" })}
                </option>
                <option value="source">{t("web.sourceMode", { defaultValue: "源码模式" })}</option>
              </select>
            </label>
          ) : null}

          {proseFont ? (
            <>
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>
                  {t("settings.appearance.proseFont")}
                </span>
                <select
                  className={settingsInputClassName}
                  value={isCustomProse ? "custom" : proseFont.value}
                  onChange={(event) => {
                    const val = event.target.value;
                    proseFont.onChange(val === "custom" ? "CustomFont" : val);
                  }}
                >
                  {PROSE_FONT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.id ? opt.label : t("settings.appearance.fonts.followTheme")}
                    </option>
                  ))}
                  <option value="custom">{t("settings.appearance.customFontOption")}</option>
                </select>
              </label>

              {isCustomProse ? (
                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.customProseFont")}
                  </span>
                  <input
                    type="text"
                    className={settingsInputClassName}
                    placeholder={t("settings.appearance.customProsePlaceholder")}
                    value={proseFont.value}
                    onChange={(event) => proseFont.onChange(event.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {codeFont ? (
            <>
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>
                  {t("settings.appearance.codeFont")}
                </span>
                <select
                  className={settingsInputClassName}
                  value={isCustomCode ? "custom" : codeFont.value}
                  onChange={(event) => {
                    const val = event.target.value;
                    codeFont.onChange(val === "custom" ? "CustomCodeFont" : val);
                  }}
                >
                  {CODE_FONT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.id ? opt.label : t("settings.appearance.fonts.followTheme")}
                    </option>
                  ))}
                  <option value="custom">{t("settings.appearance.customCodeOption")}</option>
                </select>
              </label>

              {isCustomCode ? (
                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.customCodeFont")}
                  </span>
                  <input
                    type="text"
                    className={settingsInputClassName}
                    placeholder={t("settings.appearance.customCodePlaceholder")}
                    value={codeFont.value}
                    onChange={(event) => codeFont.onChange(event.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] text-[var(--theme-text)] max-[760px]:grid-cols-[minmax(0,1fr)_44px]">
            <span className={settingsFieldLabelClassName}>{t("settings.appearance.fontSize")}</span>
            <input
              type="range"
              min={WYSIWYG_FONT_SIZE_MIN}
              max={WYSIWYG_FONT_SIZE_MAX}
              step={1}
              value={fontSize.value}
              aria-label={t("settings.appearance.fontSize")}
              onChange={(event) => fontSize.onChange(Number.parseInt(event.target.value, 10))}
              className="accent-[var(--theme-primary)]"
            />
            <output className="text-right text-[13px] tabular-nums text-[var(--theme-control-text)]">
              {fontSize.value}px
            </output>
          </label>
        </div>
      </section>

      {/* 模块 2：显示与标记 */}
      <section className={settingsModuleClassName} aria-labelledby="editor-display-title">
        <div className="mb-3">
          <h2 id="editor-display-title" className={settingsSectionTitleClassName}>
            {t("settings.editor.displayTitle", { defaultValue: "编辑显示与标记" })}
          </h2>
          <p className={settingsDescriptionClassName}>
            {t("settings.editor.displayDesc", {
              defaultValue: "控制行号、行内格式标记符号及交互细节。",
            })}
          </p>
        </div>

        <div className="grid gap-3">
          <label className="flex min-h-[30px] items-center gap-2 text-[13px] text-[var(--theme-text)]">
            <input
              type="checkbox"
              className="size-4 rounded border-[var(--theme-border)] accent-[var(--theme-primary)]"
              checked={showLineNumbers.checked}
              onChange={(event) => showLineNumbers.onChange(event.target.checked)}
            />
            <span>{t("settings.appearance.showLineNumbers")}</span>
          </label>

          <label className="flex min-h-[30px] items-center gap-2 text-[13px] text-[var(--theme-text)]">
            <input
              type="checkbox"
              className="size-4 rounded border-[var(--theme-border)] accent-[var(--theme-primary)]"
              checked={showInlineStyleMarkers.checked}
              onChange={(event) => showInlineStyleMarkers.onChange(event.target.checked)}
            />
            <span>{t("settings.appearance.showInlineStyleMarkers")}</span>
          </label>
        </div>
      </section>

      {/* 模块 3：Markdown 规范与排版校验 */}
      <section className={settingsModuleClassName} aria-labelledby="editor-lint-title">
        <div className="mb-3">
          <h2 id="editor-lint-title" className={settingsSectionTitleClassName}>
            {t("settings.editor.lintTitle", { defaultValue: "语法与排版规范检查" })}
          </h2>
          <p className={settingsDescriptionClassName}>
            {t("settings.editor.lintDesc", {
              defaultValue:
                "基于行业通用规范（markdownlint）提供实时原位波浪线与规范诊断，保障文档排版质量。",
            })}
          </p>
        </div>

        <label className="flex min-h-[30px] items-center gap-2 text-[13px] text-[var(--theme-text)]">
          <input
            type="checkbox"
            className="size-4 rounded border-[var(--theme-border)] accent-[var(--theme-primary)]"
            checked={enableMarkdownLint.checked}
            onChange={(event) => enableMarkdownLint.onChange(event.target.checked)}
          />
          <span>
            {t("settings.editor.enableMarkdownLint", {
              defaultValue: "开启 Markdown 实时语法与格式规范检查",
            })}
          </span>
        </label>
      </section>

      {/* 模块 4：图片静态资源目录（仅 Desktop 传入） */}
      {assetsDirectory ? (
        <section className={settingsModuleClassName} aria-labelledby="editor-assets-title">
          <div className="mb-3">
            <h2 id="editor-assets-title" className={settingsSectionTitleClassName}>
              {t("settings.general.assetsTitle")}
            </h2>
            <p className={settingsDescriptionClassName}>{t("settings.general.assetsDesc")}</p>
          </div>
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>{t("settings.general.assetsField")}</span>
            <input
              type="text"
              className={settingsInputClassName}
              value={assetsDirectory.value}
              onChange={(event) => assetsDirectory.onChange(event.target.value)}
              placeholder="assets"
              spellCheck={false}
            />
          </label>
        </section>
      ) : null}
    </div>
  );
}
