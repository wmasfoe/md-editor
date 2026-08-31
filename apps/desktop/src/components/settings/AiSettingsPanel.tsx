import type { AiSettings } from "@md-editor/ai";
import {
  BUILTIN_LOCAL_MODELS,
  formatSystemSpecsLabel,
  getRecommendedModelId,
  type LocalAiModelCommandStatus,
  type SystemSpecs,
} from "../../app/ai/local-ai-model";
import {
  formatByteSize,
  isRemoteAiProvider,
  providerEndpointPlaceholder,
  providerModelPlaceholder,
  readAiProvider,
  updateAiFeature,
  updateAiProvider,
} from "./settingsUtils";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settingsStyles";

interface AiSettingsPanelProps {
  readonly aiSettingsDraft: AiSettings;
  readonly isLocalModelActionPending: boolean;
  readonly allModelStatuses?: Record<string, LocalAiModelCommandStatus>;
  readonly systemSpecs?: SystemSpecs | null;
  readonly isCheckingModelUpdates?: boolean;
  readonly onChangeAiSettings: (value: AiSettings) => void;
  readonly onDownloadLocalModel: (modelId?: string) => void;
  readonly onCancelLocalModelDownload: (modelId?: string) => void;
  readonly onDeleteLocalModel: (modelId?: string) => void;
  readonly onCheckModelUpdates?: () => void;
}

export function AiSettingsPanel({
  aiSettingsDraft,
  isLocalModelActionPending,
  allModelStatuses = {},
  systemSpecs = null,
  isCheckingModelUpdates = false,
  onChangeAiSettings,
  onDownloadLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel,
  onCheckModelUpdates,
}: AiSettingsPanelProps) {
  return (
    <section className={settingsModuleClassName} aria-labelledby="ai-settings-title">
      <div className="mb-3">
        <h2 id="ai-settings-title" className={settingsSectionTitleClassName}>
          AI 设置
        </h2>
        <p className={settingsDescriptionClassName}>
          AI 只会在你主动触发续写时请求；API Key 会保存在本机设置文件中。
        </p>
      </div>
      <div className="grid gap-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-h-[30px] items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)]"
              checked={aiSettingsDraft.features.editing}
              onChange={(event) =>
                onChangeAiSettings(
                  updateAiFeature(aiSettingsDraft, "editing", event.target.checked),
                )
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
                onChangeAiSettings(
                  updateAiFeature(aiSettingsDraft, "continuation", event.target.checked),
                )
              }
            />
            <span className={settingsFieldLabelClassName}>AI 续写</span>
          </label>
        </div>

        <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
          <span className={settingsFieldLabelClassName}>Provider</span>
          <select
            className={settingsInputClassName}
            value={aiSettingsDraft.provider}
            onChange={(event) =>
              onChangeAiSettings(
                updateAiProvider(aiSettingsDraft, readAiProvider(event.target.value)),
              )
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
            isLocalModelActionPending={isLocalModelActionPending}
            allModelStatuses={allModelStatuses}
            systemSpecs={systemSpecs}
            isCheckingModelUpdates={isCheckingModelUpdates}
            onChangeAiSettings={onChangeAiSettings}
            onDownloadLocalModel={onDownloadLocalModel}
            onCancelLocalModelDownload={onCancelLocalModelDownload}
            onDeleteLocalModel={onDeleteLocalModel}
            onCheckModelUpdates={onCheckModelUpdates}
          />
        )}
      </div>
    </section>
  );
}

function RemoteAiSettings({
  aiSettingsDraft,
  onChangeAiSettings,
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
                baseUrl: event.target.value,
              },
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
                model: event.target.value,
              },
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
                apiKey: event.target.value,
              },
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
  | "isLocalModelActionPending"
  | "allModelStatuses"
  | "systemSpecs"
  | "isCheckingModelUpdates"
  | "onChangeAiSettings"
  | "onDownloadLocalModel"
  | "onCancelLocalModelDownload"
  | "onDeleteLocalModel"
  | "onCheckModelUpdates"
> {}

function LocalAiSettings({
  aiSettingsDraft,
  isLocalModelActionPending,
  allModelStatuses = {},
  systemSpecs = null,
  isCheckingModelUpdates = false,
  onChangeAiSettings,
  onDownloadLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel,
  onCheckModelUpdates,
}: LocalAiSettingsProps) {
  const recommendedId = getRecommendedModelId(systemSpecs);
  const recommendedTierName =
    recommendedId === "md-editor-writer-standard" ? "Standard (1.5B)" : "Lite (0.5B)";

  return (
    <div className="grid gap-3.5">
      {/* 硬件概览与智能推荐卡片 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-chrome)]/60 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base" aria-hidden="true">
            💻
          </span>
          <div className="min-w-0">
            <span className="text-[12px] font-medium text-[var(--theme-title)]">
              {formatSystemSpecsLabel(systemSpecs)}
            </span>
            <p className="m-0 text-[11px] text-[var(--theme-muted)]">
              基于设备硬件自动适配最佳模型档位
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[var(--theme-primary-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--theme-primary)]">
            ⚡️ 推荐：{recommendedTierName}
          </span>
          {onCheckModelUpdates ? (
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={onCheckModelUpdates}
              disabled={isCheckingModelUpdates || isLocalModelActionPending}
            >
              {isCheckingModelUpdates ? "检查中..." : "检查更新"}
            </button>
          ) : null}
        </div>
      </div>

      {/* 三档位模型选择卡片网格 */}
      <div className="grid grid-cols-3 gap-3 max-[980px]:grid-cols-2 max-[640px]:grid-cols-1">
        {BUILTIN_LOCAL_MODELS.map((descriptor) => {
          const status = allModelStatuses[descriptor.id] || {
            modelId: descriptor.id,
            displayName: descriptor.displayName,
            version: null,
            latestVersion: null,
            hasUpdate: false,
            status: "not-downloaded",
            downloadedBytes: 0,
            totalBytes: descriptor.downloadSizeBytes,
            error: null,
            isAvailableTier: descriptor.isAvailable,
            path: null,
            enabled: aiSettingsDraft.localModel.enabled,
          };

          const isSelected = aiSettingsDraft.localModel.modelId === descriptor.id;
          const isRecommended = descriptor.id === recommendedId;
          const isBusy =
            isLocalModelActionPending ||
            status.status === "downloading" ||
            status.status === "verifying";
          const isDownloading = status.status === "downloading";
          const isVerifying = status.status === "verifying";
          const isAvailable = status.status === "available";
          const hasUpdate = status.hasUpdate;
          const isEnabled = isAvailable && isSelected && aiSettingsDraft.localModel.enabled;

          const progressPercent =
            status.totalBytes > 0
              ? Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100))
              : 0;

          return (
            <div
              key={descriptor.id}
              onClick={() => {
                if (!descriptor.isAvailable || !isAvailable) return;
                onChangeAiSettings({
                  ...aiSettingsDraft,
                  localModel: {
                    ...aiSettingsDraft.localModel,
                    enabled: true,
                    modelId: descriptor.id,
                    version: status.version,
                    latestVersion: status.latestVersion,
                    hasUpdate: status.hasUpdate,
                    status: status.status,
                    downloadedBytes: status.downloadedBytes,
                    totalBytes: status.totalBytes,
                    error: status.error,
                  },
                });
              }}
              className={`relative flex flex-col justify-between rounded-lg border p-3 transition-all ${
                !descriptor.isAvailable
                  ? "border-dashed border-[var(--theme-border)] bg-[var(--theme-chrome)]/30 opacity-70"
                  : isEnabled
                    ? "border-[var(--theme-primary)] bg-[var(--theme-surface)] shadow-sm ring-1 ring-[var(--theme-primary)]"
                    : "cursor-pointer border-[var(--theme-border)] bg-[var(--theme-chrome)]/50 hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface)]"
              }`}
            >
              <div>
                {/* 头部：名称 + 徽标 + 开关 */}
                <div className="mb-2 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] font-semibold text-[var(--theme-title)] truncate">
                      {descriptor.displayName}
                    </span>
                    {isRecommended ? (
                      <span className="shrink-0 rounded bg-[var(--theme-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-primary)]">
                        ★推荐
                      </span>
                    ) : null}
                    {!descriptor.isAvailable ? (
                      <span className="shrink-0 rounded bg-[var(--theme-chrome)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
                        即将推出
                      </span>
                    ) : null}
                    {hasUpdate ? (
                      <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                        有更新
                      </span>
                    ) : null}
                  </div>

                  {isAvailable ? (
                    <label
                      className="relative inline-flex cursor-pointer items-center gap-1.5 shrink-0"
                      title={isEnabled ? "已启用此模型（点击关闭）" : "点击开启此模型"}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={`text-[11px] font-medium transition-colors ${
                          isEnabled ? "text-[var(--theme-primary)]" : "text-[var(--theme-muted)]"
                        }`}
                      >
                        {isEnabled ? "开启" : "关闭"}
                      </span>
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={isEnabled}
                        disabled={isBusy}
                        onChange={(e) => {
                          e.stopPropagation();
                          if (e.target.checked) {
                            onChangeAiSettings({
                              ...aiSettingsDraft,
                              localModel: {
                                ...aiSettingsDraft.localModel,
                                enabled: true,
                                modelId: descriptor.id,
                                version: status.version,
                                latestVersion: status.latestVersion,
                                hasUpdate: status.hasUpdate,
                                status: status.status,
                                downloadedBytes: status.downloadedBytes,
                                totalBytes: status.totalBytes,
                                error: status.error,
                              },
                            });
                          } else {
                            onChangeAiSettings({
                              ...aiSettingsDraft,
                              localModel: {
                                ...aiSettingsDraft.localModel,
                                enabled: false,
                              },
                            });
                          }
                        }}
                      />
                      <div className="relative h-4 w-7 rounded-full bg-[var(--theme-border)] transition-colors duration-200 peer-checked:bg-[var(--theme-primary)] peer-focus:outline-none after:absolute after:left-[2px] after:top-[2px] after:size-3 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:after:translate-x-3 peer-disabled:opacity-50" />
                    </label>
                  ) : null}
                </div>

                {/* 描述 */}
                <p className="mb-2 text-[11px] leading-relaxed text-[var(--theme-muted)] min-h-[32px]">
                  {descriptor.description}
                </p>

                {/* 元数据标签 */}
                <div className="mb-3 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-[var(--theme-muted)]">
                  {descriptor.downloadSizeBytes > 0 ? (
                    <span>📦 {formatByteSize(descriptor.downloadSizeBytes)}</span>
                  ) : null}
                  {descriptor.recommendedMemoryGb > 0 ? (
                    <span>🧠 {descriptor.recommendedMemoryGb}GB+ 内存</span>
                  ) : null}
                  {status.version ? <span>🏷 {formatModelVersionTag(status.version)}</span> : null}
                </div>
              </div>

              {/* 底部：状态与操作按钮 */}
              <div className="mt-2 border-t border-[var(--theme-border)]/60 pt-2.5">
                {isDownloading ? (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-[var(--theme-primary)]">
                        {status.version ? "正在更新模型..." : "正在下载模型..."}
                      </span>
                      <span className="text-[10px] text-[var(--theme-muted)]">
                        {progressPercent}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--theme-border)]">
                      <div
                        className="h-full bg-[var(--theme-primary)] transition-all duration-200"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--theme-muted)]">
                      <span>
                        {formatByteSize(status.downloadedBytes)} /{" "}
                        {formatByteSize(status.totalBytes)}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] text-red-500 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelLocalModelDownload(descriptor.id);
                        }}
                      >
                        {status.version ? "取消更新" : "取消下载"}
                      </button>
                    </div>
                  </div>
                ) : isVerifying ? (
                  <div className="flex items-center justify-center py-1 text-[11px] text-[var(--theme-muted)]">
                    <span>{status.version ? "新版本校验中..." : "校验中..."}</span>
                  </div>
                ) : !descriptor.isAvailable ? (
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-[5px] border border-[var(--theme-border)] py-1 text-center text-xs text-[var(--theme-muted)] opacity-60"
                  >
                    即将推出
                  </button>
                ) : isAvailable ? (
                  <div className="flex items-center justify-between gap-1.5">
                    {hasUpdate ? (
                      <button
                        type="button"
                        className="h-[30px] flex-1 rounded-[5px] border border-blue-500 bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-55"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownloadLocalModel(descriptor.id);
                        }}
                        disabled={isBusy}
                      >
                        下载新版本
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 text-[11px]">
                        {isEnabled ? (
                          <span className="font-semibold text-[var(--theme-primary)]">
                            ✓ 当前模型生效中
                          </span>
                        ) : (
                          <span className="text-[var(--theme-muted)]">已就绪</span>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="h-[30px] px-2 rounded-[5px] border border-[var(--theme-border)] bg-[var(--theme-surface)] text-xs text-[var(--theme-muted)] hover:border-red-300 hover:text-red-500 disabled:opacity-55 ml-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLocalModel(descriptor.id);
                      }}
                      disabled={isBusy}
                    >
                      删除
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${settingsSmallButtonClassName} w-full`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadLocalModel(descriptor.id);
                    }}
                    disabled={isBusy}
                  >
                    {status.status === "failed" ? "重试下载" : "下载模型"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="m-0 text-[11px] text-[var(--theme-muted)]">
        🔒
        本地模型与推理完全在您的电脑本机运行，文档内容不会上传至任何云端服务器。下载后支持完全断网离线使用。
      </p>
    </div>
  );
}

function formatModelVersionTag(version: string | null | undefined): string | null {
  if (!version) return null;
  const clean = version.trim();
  if (!clean) return null;
  return clean.startsWith("v") || clean.startsWith("V") ? clean : `v${clean}`;
}
