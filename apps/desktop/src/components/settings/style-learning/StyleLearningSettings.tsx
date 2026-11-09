/**
 * @file StyleLearningSettings.tsx
 * @description
 * 设置页“写作偏好”区块：总开关、自动找回、已学到的偏好（只读）、自定义偏好、
 * 参与学习的文章与排除列表、未关联目录与清除数据。
 *
 * 开关属于 AI 设置草稿，随“保存”一起持久化；画像与排除列表是本地学习数据，修改立即生效。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "@md-editor/i18n";
import { STANDARD_LOCAL_MODEL_ID, isLiteLocalModel, type AiSettings } from "@md-editor/ai";
import {
  STYLE_DIMENSIONS,
  STYLE_DIMENSION_DISABLED,
  STAT_DIMENSION_IDS,
  CLASS_DIMENSION_IDS,
  createEmptyStyleExclusionsDocument,
  createEmptyStyleProfileDocument,
  styleDimensionValues,
  type CustomStyleRule,
  type StyleDimensionId,
  type StyleRuleRecord,
} from "@md-editor/ai/style";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "@md-editor/editor-ui/settings";
import {
  findLinkedWorkspaceProfile,
  useStyleLearningStore,
} from "../../../app/ai/style-learning/style-learning-store";
import {
  clearStyleExclusions,
  clearStyleProfile,
  saveStyleProfile,
} from "../../../app/ai/style-learning/style-learning-host";
import {
  excludeStylePath,
  restoreStylePath,
} from "../../../app/ai/style-learning/style-exclusions";
import { useFileTreeStore } from "../../../app/stores/file-tree-store";
import { useToastStore } from "../../../app/stores/toast-store";

export interface StyleLearningSettingsProps {
  readonly aiSettingsDraft: AiSettings;
  readonly onChangeAiSettings: (settings: AiSettings) => void;
  /** 本地 Standard 模型是否已下载可用 */
  readonly standardModelReady: boolean;
  readonly onDownloadStandardModel: (modelId: string) => void;
}

const ALL_DIMENSIONS: readonly StyleDimensionId[] = [...STAT_DIMENSION_IDS, ...CLASS_DIMENSION_IDS];

/** 自定义规则 id */
function newCustomRuleId(): string {
  return `c-${globalThis.crypto.randomUUID()}`;
}

/** 清空当前排除列表（应用数据目录中的排除文档） */
async function clearExclusionList(): Promise<void> {
  await clearStyleExclusions();
  useStyleLearningStore.getState().setExclusions(createEmptyStyleExclusionsDocument());
}

export function StyleLearningSettings({
  aiSettingsDraft,
  onChangeAiSettings,
  standardModelReady,
  onDownloadStandardModel,
}: StyleLearningSettingsProps) {
  const { t } = useTranslation();
  const styleLearning = aiSettingsDraft.styleLearning;
  const setStyleLearning = (patch: Partial<AiSettings["styleLearning"]>) =>
    onChangeAiSettings({ ...aiSettingsDraft, styleLearning: { ...styleLearning, ...patch } });

  return (
    <section className={settingsModuleClassName} aria-labelledby="style-learning-title">
      <div className="mb-3">
        <h2 id="style-learning-title" className={settingsSectionTitleClassName}>
          {t("styleLearning.title")}
        </h2>
        <p className={settingsDescriptionClassName}>{t("styleLearning.desc")}</p>
      </div>
      <div className="grid gap-3">
        <label className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={styleLearning.enabled}
            onChange={(event) => setStyleLearning({ enabled: event.target.checked })}
          />
          <span className={settingsFieldLabelClassName}>{t("styleLearning.enable")}</span>
        </label>

        {styleLearning.enabled && !standardModelReady ? (
          <div className="flex flex-wrap items-center gap-3" role="status">
            <p className={settingsDescriptionClassName}>{t("styleLearning.localOnly")}</p>
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={() => onDownloadStandardModel(STANDARD_LOCAL_MODEL_ID)}
            >
              {t("styleLearning.downloadStandard")}
            </button>
          </div>
        ) : null}

        {styleLearning.enabled ? (
          <>
            <div>
              <label className="flex min-h-8 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--theme-primary)]"
                  checked={styleLearning.autoRelink}
                  onChange={(event) => setStyleLearning({ autoRelink: event.target.checked })}
                />
                <span className={settingsFieldLabelClassName}>{t("styleLearning.autoRelink")}</span>
              </label>
              <p className={settingsDescriptionClassName}>{t("styleLearning.autoRelinkDesc")}</p>
            </div>
            {styleLearning.cloudConsent ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className={settingsDescriptionClassName}>
                  {t("styleLearning.consentGranted", {
                    origin: styleLearning.cloudConsent.origin,
                  })}
                </p>
                <button
                  type="button"
                  className={settingsSmallButtonClassName}
                  onClick={() => setStyleLearning({ cloudConsent: null })}
                >
                  {t("styleLearning.consentRevoke")}
                </button>
              </div>
            ) : null}
            {aiSettingsDraft.provider === "local" &&
            isLiteLocalModel(aiSettingsDraft.localModel.modelId) ? (
              <p className={settingsDescriptionClassName}>{t("styleLearning.liteNotice")}</p>
            ) : null}
            <StyleProfileDataSection />
          </>
        ) : null}
      </div>
    </section>
  );
}

/** 已学到的偏好、自定义偏好、样本与排除列表等本地学习数据 */
function StyleProfileDataSection() {
  const { t } = useTranslation();
  const profile = useStyleLearningStore((state) => state.profile);
  const exclusions = useStyleLearningStore((state) => state.exclusions);
  const rootPath = useFileTreeStore((state) => state.folder?.rootPath ?? null);
  const workspace = findLinkedWorkspaceProfile(profile, rootPath);
  const unlinked = profile?.workspaces.filter((entry) => entry.linkState === "unlinked") ?? [];
  const excluded = rootPath ? (exclusions.workspaces[rootPath] ?? []) : [];

  const updateProfile = async (custom: readonly CustomStyleRule[]) => {
    const next = { ...(profile ?? createEmptyStyleProfileDocument()), custom };
    useStyleLearningStore.getState().setProfile(next);
    await saveStyleProfile(next);
  };

  const clearAll = async () => {
    await clearStyleProfile();
    useStyleLearningStore.getState().setProfile(null);
    useToastStore.getState().showToast(t("styleLearning.clearDone"));
  };

  return (
    <div className="grid gap-4">
      <section className="grid gap-2" aria-label={t("styleLearning.aiProfile")}>
        <h4 className={settingsFieldLabelClassName}>{t("styleLearning.aiProfile")}</h4>
        <ActiveRuleList title={t("styleLearning.workspaceLayer")} rules={workspace?.rules ?? []} />
        <ActiveRuleList
          title={t("styleLearning.globalLayer")}
          rules={profile?.global.rules ?? []}
        />
      </section>

      <CustomRuleEditor
        rules={profile?.custom ?? []}
        onChange={(custom) => void updateProfile(custom)}
      />

      {rootPath ? (
        <section className="grid gap-2" aria-label={t("styleLearning.samplesTitle")}>
          <h4 className={settingsFieldLabelClassName}>{t("styleLearning.samplesTitle")}</h4>
          {workspace && workspace.samples.length > 0 ? (
            <ul className="grid max-h-48 gap-1 overflow-auto text-xs">
              {workspace.samples.map((sample) => (
                <li key={sample.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{sample.relPath}</span>
                  <button
                    type="button"
                    className={settingsSmallButtonClassName}
                    onClick={() => void excludeStylePath(rootPath, sample.relPath)}
                  >
                    {t("styleLearning.exclude")}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={settingsDescriptionClassName}>{t("styleLearning.samplesEmpty")}</p>
          )}
          {excluded.length > 0 ? (
            <>
              <h4 className={settingsFieldLabelClassName}>{t("styleLearning.excludedTitle")}</h4>
              <ul className="grid gap-1 text-xs">
                {excluded.map((entry) => (
                  <li key={entry} className="flex items-center justify-between gap-2">
                    <span className="truncate">{entry}</span>
                    <button
                      type="button"
                      className={settingsSmallButtonClassName}
                      onClick={() => void restoreStylePath(rootPath, entry)}
                    >
                      {t("styleLearning.restore")}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${settingsSmallButtonClassName} justify-self-start`}
                onClick={() => void clearExclusionList()}
              >
                {t("styleLearning.clearExclusions")}
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {unlinked.length > 0 ? (
        <section className="grid gap-1" aria-label={t("styleLearning.unlinkedTitle")}>
          <h4 className={settingsFieldLabelClassName}>{t("styleLearning.unlinkedTitle")}</h4>
          <p className={settingsDescriptionClassName}>{t("styleLearning.unlinkedDesc")}</p>
          <ul className="grid gap-1 text-xs">
            {unlinked.map((entry) => (
              <li key={entry.id} className="truncate">
                {entry.rootPath}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        className={`${settingsSmallButtonClassName} justify-self-start`}
        onClick={() => void clearAll()}
      >
        {t("styleLearning.clear")}
      </button>
    </div>
  );
}

/** 只读展示某一层已生效的规则 */
function ActiveRuleList({
  title,
  rules,
}: {
  readonly title: string;
  readonly rules: readonly StyleRuleRecord[];
}) {
  const { t } = useTranslation();
  const active = rules.filter((rule) => rule.status === "active");
  return (
    <div className="grid gap-1">
      <span className="text-xs text-[var(--theme-control-subtle)]">{title}</span>
      {active.length === 0 ? (
        <p className={settingsDescriptionClassName}>{t("styleLearning.aiProfileEmpty")}</p>
      ) : (
        <ul className="grid gap-1 text-sm" data-testid="style-active-rules">
          {active.map((rule) => {
            const sources = new Set(rule.rounds.flatMap((round) => round.supportSampleIds));
            return (
              <li key={rule.dimension} className="flex items-baseline justify-between gap-3">
                <span>{STYLE_DIMENSIONS[rule.dimension].templates[rule.value]}</span>
                <span className="shrink-0 text-xs text-[var(--theme-control-subtle)]">
                  {t("styleLearning.sources", { count: sources.size })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 自定义偏好：自由文本，或覆盖某个维度 */
function CustomRuleEditor({
  rules,
  onChange,
}: {
  readonly rules: readonly CustomStyleRule[];
  readonly onChange: (rules: readonly CustomStyleRule[]) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [dimension, setDimension] = useState<StyleDimensionId>(ALL_DIMENSIONS[0]!);
  const [value, setValue] = useState<string>(styleDimensionValues(ALL_DIMENSIONS[0]!)[0]!);
  const values = useMemo(() => styleDimensionValues(dimension), [dimension]);

  return (
    <section className="grid gap-2" aria-label={t("styleLearning.customTitle")}>
      <h4 className={settingsFieldLabelClassName}>{t("styleLearning.customTitle")}</h4>
      <p className={settingsDescriptionClassName}>{t("styleLearning.customDesc")}</p>
      {rules.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-baseline justify-between gap-3">
              <span>
                {rule.kind === "note"
                  ? rule.text
                  : rule.value === STYLE_DIMENSION_DISABLED
                    ? `${STYLE_DIMENSIONS[rule.dimension].label}：${t("styleLearning.customDimensionNone")}`
                    : STYLE_DIMENSIONS[rule.dimension].templates[rule.value]}
              </span>
              <button
                type="button"
                className={settingsSmallButtonClassName}
                onClick={() => onChange(rules.filter((candidate) => candidate.id !== rule.id))}
              >
                {t("styleLearning.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <input
          className={settingsInputClassName}
          value={note}
          placeholder={t("styleLearning.customPlaceholder")}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="button"
          className={settingsSmallButtonClassName}
          disabled={!note.trim()}
          onClick={() => {
            onChange([...rules, { kind: "note", id: newCustomRuleId(), text: note.trim() }]);
            setNote("");
          }}
        >
          {t("styleLearning.customAdd")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--theme-control-subtle)]">
          {t("styleLearning.customDimension")}
        </span>
        <select
          className={settingsInputClassName}
          value={dimension}
          aria-label={t("styleLearning.customDimension")}
          onChange={(event) => {
            const next = event.target.value as StyleDimensionId;
            setDimension(next);
            setValue(styleDimensionValues(next)[0]!);
          }}
        >
          {ALL_DIMENSIONS.map((id) => (
            <option key={id} value={id}>
              {STYLE_DIMENSIONS[id].label}
            </option>
          ))}
        </select>
        <select
          className={settingsInputClassName}
          value={value}
          aria-label={STYLE_DIMENSIONS[dimension].label}
          onChange={(event) => setValue(event.target.value)}
        >
          {values.map((option) => (
            <option key={option} value={option}>
              {STYLE_DIMENSIONS[dimension].templates[option]}
            </option>
          ))}
          <option value={STYLE_DIMENSION_DISABLED}>{t("styleLearning.customDimensionNone")}</option>
        </select>
        <button
          type="button"
          className={settingsSmallButtonClassName}
          onClick={() =>
            onChange([
              // 同一维度只保留最新的一条覆盖规则。
              ...rules.filter((rule) => rule.kind === "note" || rule.dimension !== dimension),
              { kind: "dimension", id: newCustomRuleId(), dimension, value },
            ])
          }
        >
          {t("styleLearning.customAdd")}
        </button>
      </div>
    </section>
  );
}
