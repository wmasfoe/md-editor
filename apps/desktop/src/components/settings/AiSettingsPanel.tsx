import type { AiSettings } from "@md-editor/editor-core";
import {
  isRemoteAiProvider,
  localModelProgressLabel,
  localModelStatusLabel,
  providerEndpointPlaceholder,
  providerModelPlaceholder,
  readAiProvider,
  updateAiFeature,
  updateAiProvider
} from "./settingsUtils";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName
} from "./settingsStyles";

interface AiSettingsPanelProps {
  readonly aiSettingsDraft: AiSettings;
  readonly isLocalModelActionPending: boolean;
  readonly onChangeAiSettings: (value: AiSettings) => void;
  readonly onDownloadLocalModel: () => void;
  readonly onCancelLocalModelDownload: () => void;
  readonly onDeleteLocalModel: () => void;
}

export function AiSettingsPanel({
  aiSettingsDraft,
  isLocalModelActionPending,
  onChangeAiSettings,
  onDownloadLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel
}: AiSettingsPanelProps) {
  const isLocalModelBusy =
    isLocalModelActionPending ||
    aiSettingsDraft.localModel.status === "downloading" ||
    aiSettingsDraft.localModel.status === "verifying";
  const canCancelLocalModelDownload =
    !isLocalModelActionPending && aiSettingsDraft.localModel.status === "downloading";
  const canDeleteLocalModel =
    aiSettingsDraft.localModel.status === "available" ||
    aiSettingsDraft.localModel.status === "failed";

  return (
    <section className={settingsModuleClassName} aria-labelledby="ai-settings-title">
      <div className="mb-3">
        <h2 id="ai-settings-title" className={settingsSectionTitleClassName}>AI 设置</h2>
        <p className={settingsDescriptionClassName}>
          AI 只会在你主动触发续写时请求；API Key 会保存在本机设置文件中。
        </p>
      </div>
      <div className="grid gap-3">
        <label className="flex min-h-[30px] items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={aiSettingsDraft.features.editing}
            onChange={(event) =>
              onChangeAiSettings(updateAiFeature(aiSettingsDraft, "editing", event.target.checked))
            }
          />
          <span className={settingsFieldLabelClassName}>语法、标点修复</span>
        </label>
        <label className="flex min-h-[30px] items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={aiSettingsDraft.features.continuation}
            onChange={(event) =>
              onChangeAiSettings(updateAiFeature(aiSettingsDraft, "continuation", event.target.checked))
            }
          />
          <span className={settingsFieldLabelClassName}>AI 续写</span>
        </label>

        <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
          <span className={settingsFieldLabelClassName}>Provider</span>
          <select
            className={settingsInputClassName}
            value={aiSettingsDraft.provider}
            onChange={(event) =>
              onChangeAiSettings(updateAiProvider(aiSettingsDraft, readAiProvider(event.target.value)))
            }
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="deepseek">DeepSeek</option>
            <option value="local">本地模型</option>
          </select>
        </label>

        {isRemoteAiProvider(aiSettingsDraft.provider) ? (
          <RemoteAiSettings
            aiSettingsDraft={aiSettingsDraft}
            onChangeAiSettings={onChangeAiSettings}
          />
        ) : (
          <LocalAiSettings
            aiSettingsDraft={aiSettingsDraft}
            isLocalModelBusy={isLocalModelBusy}
            canCancelLocalModelDownload={canCancelLocalModelDownload}
            canDeleteLocalModel={canDeleteLocalModel}
            onChangeAiSettings={onChangeAiSettings}
            onDownloadLocalModel={onDownloadLocalModel}
            onCancelLocalModelDownload={onCancelLocalModelDownload}
            onDeleteLocalModel={onDeleteLocalModel}
          />
        )}
      </div>
    </section>
  );
}

function RemoteAiSettings({
  aiSettingsDraft,
  onChangeAiSettings
}: Pick<AiSettingsPanelProps, "aiSettingsDraft" | "onChangeAiSettings">) {
  return (
    <div className="grid gap-2.5">
      <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
        <span className={settingsFieldLabelClassName}>Endpoint</span>
        <input
          className={settingsInputClassName}
          value={aiSettingsDraft.openAiCompatible.baseUrl}
          disabled={aiSettingsDraft.provider === "deepseek"}
          onChange={(event) =>
            onChangeAiSettings({
              ...aiSettingsDraft,
              openAiCompatible: {
                ...aiSettingsDraft.openAiCompatible,
                baseUrl: event.target.value
              }
            })
          }
          placeholder={providerEndpointPlaceholder(aiSettingsDraft.provider)}
          spellCheck={false}
        />
      </label>
      <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
        <span className={settingsFieldLabelClassName}>Model</span>
        <input
          className={settingsInputClassName}
          value={aiSettingsDraft.openAiCompatible.model}
          onChange={(event) =>
            onChangeAiSettings({
              ...aiSettingsDraft,
              openAiCompatible: {
                ...aiSettingsDraft.openAiCompatible,
                model: event.target.value
              }
            })
          }
          placeholder={providerModelPlaceholder(aiSettingsDraft.provider)}
          spellCheck={false}
        />
      </label>
      <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
        <span className={settingsFieldLabelClassName}>API Key</span>
        <input
          type="password"
          className={settingsInputClassName}
          value={aiSettingsDraft.openAiCompatible.apiKey}
          onChange={(event) =>
            onChangeAiSettings({
              ...aiSettingsDraft,
              openAiCompatible: {
                ...aiSettingsDraft.openAiCompatible,
                apiKey: event.target.value
              }
            })
          }
          placeholder="sk-..."
          spellCheck={false}
        />
      </label>
    </div>
  );
}

interface LocalAiSettingsProps extends Pick<
  AiSettingsPanelProps,
  | "aiSettingsDraft"
  | "onChangeAiSettings"
  | "onDownloadLocalModel"
  | "onCancelLocalModelDownload"
  | "onDeleteLocalModel"
> {
  readonly isLocalModelBusy: boolean;
  readonly canCancelLocalModelDownload: boolean;
  readonly canDeleteLocalModel: boolean;
}

function LocalAiSettings({
  aiSettingsDraft,
  isLocalModelBusy,
  canCancelLocalModelDownload,
  canDeleteLocalModel,
  onChangeAiSettings,
  onDownloadLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel
}: LocalAiSettingsProps) {
  return (
    <div className="grid gap-2.5">
      <label className="flex min-h-[30px] items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-[var(--theme-primary)]"
          checked={aiSettingsDraft.localModel.enabled}
          onChange={(event) =>
            onChangeAiSettings({
              ...aiSettingsDraft,
              localModel: {
                ...aiSettingsDraft.localModel,
                enabled: event.target.checked
              }
            })
          }
        />
        <span className={settingsFieldLabelClassName}>启用本地模型</span>
      </label>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={settingsFieldLabelClassName}>
            模型状态：{localModelStatusLabel(aiSettingsDraft.localModel.status)}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={onDownloadLocalModel}
              disabled={isLocalModelBusy}
            >
              {aiSettingsDraft.localModel.status === "available" ? "重新下载" : "下载模型"}
            </button>
            {canCancelLocalModelDownload ? (
              <button
                type="button"
                className={settingsSmallButtonClassName}
                onClick={onCancelLocalModelDownload}
              >
                取消下载
              </button>
            ) : null}
            {canDeleteLocalModel ? (
              <button
                type="button"
                className={settingsSmallButtonClassName}
                onClick={onDeleteLocalModel}
                disabled={isLocalModelBusy}
              >
                删除模型
              </button>
            ) : null}
          </div>
        </div>
        <p className={settingsDescriptionClassName}>
          {localModelProgressLabel(aiSettingsDraft.localModel)}
        </p>
      </div>
      <p className={settingsDescriptionClassName}>
        用户风格学习后续只会走本地模型，不会把历史文章批量上传到远程 provider。
      </p>
    </div>
  );
}
