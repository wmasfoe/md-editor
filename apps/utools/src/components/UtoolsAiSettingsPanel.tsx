/**
 * @file UtoolsAiSettingsPanel.tsx
 * @description
 * uTools 插件端 AI 设置面板组件。
 * 支持 OpenAI、Anthropic、Google Gemini 三大标准协议及 URL 快速预设，
 * 集成免责声明提示与实时连通性测试。
 */

import { useState } from "react";
import {
  AI_URL_PRESETS,
  applyAiUrlPreset,
  updateAiEndpoint,
  updateAiFeature,
  updateAiProvider,
  type AiConnectionTestResult,
  type AiProtocolId,
  type AiSettings,
} from "@md-editor/ai";
import { utoolsAiService } from "../utools/ai-service";
import { openOfficialSite } from "../utools/referral";
import { ExternalLinkIcon } from "./Icons";

export interface UtoolsAiSettingsPanelProps {
  readonly aiSettings: AiSettings;
  readonly onChangeAiSettings: (next: AiSettings) => void;
  readonly onOpenDisclaimer: () => void;
}

const sectionTitleClassName = "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";
const descriptionClassName = "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";
const fieldLabelClassName = "block text-[13px] font-semibold text-[var(--theme-title)]";
const inputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";
const smallButtonClassName =
  "h-[30px] px-2.5 rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-xs text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] disabled:opacity-55 cursor-pointer";

export function UtoolsAiSettingsPanel({
  aiSettings,
  onChangeAiSettings,
  onOpenDisclaimer,
}: UtoolsAiSettingsPanelProps) {
  const [testState, setTestState] = useState<{
    status: "idle" | "testing" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const activeProtocol: AiProtocolId =
    aiSettings.provider === "local" ? "openai" : aiSettings.provider;
  const currentEndpoint = aiSettings.endpoints[activeProtocol];

  const handleTestConnection = async () => {
    setTestState({ status: "testing", message: "正在测试连接..." });
    try {
      const result: AiConnectionTestResult = await utoolsAiService.testConnection(aiSettings);
      if (result.ok) {
        setTestState({
          status: "success",
          message: `连接成功 (延迟: ${result.latencyMs ?? 0}ms)`,
        });
      } else {
        setTestState({
          status: "error",
          message: result.message || "连接失败",
        });
      }
    } catch (error) {
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className={sectionTitleClassName}>AI 智能助写</h3>
        <p className={descriptionClassName}>
          支持 OpenAI、Anthropic、Google Gemini 各大协议及自定义端点，提供行内续写与语法错别字审校。
        </p>
      </div>

      {/* 免责声明提示横幅 */}
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-chrome)]/60 p-3 text-xs flex items-center justify-between gap-3">
        <span className="text-[var(--theme-muted)]">
          ⚠️ 当前处于 uTools 宿主环境，API Key 直接留存于插件本地存储。
        </span>
        <button
          type="button"
          onClick={onOpenDisclaimer}
          className="shrink-0 text-[var(--theme-primary)] hover:underline cursor-pointer bg-transparent border-0 text-xs"
        >
          查看免责条款
        </button>
      </div>

      {/* 特性开关 */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-[30px] items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={aiSettings.features.editing}
            onChange={(e) =>
              onChangeAiSettings(updateAiFeature(aiSettings, "editing", e.target.checked))
            }
          />
          <span className={fieldLabelClassName}>语法、错别字与标点修复</span>
        </label>
        <label className="flex min-h-[30px] items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-primary)]"
            checked={aiSettings.features.continuation}
            onChange={(e) =>
              onChangeAiSettings(updateAiFeature(aiSettings, "continuation", e.target.checked))
            }
          />
          <span className={fieldLabelClassName}>AI 行内智能续写</span>
        </label>
      </div>

      {/* 协议选择 */}
      <label className="grid grid-cols-[140px_1fr] items-center gap-3">
        <span className={fieldLabelClassName}>协议规范</span>
        <select
          className={inputClassName}
          value={aiSettings.provider}
          onChange={(e) =>
            onChangeAiSettings(updateAiProvider(aiSettings, e.target.value as AiProtocolId))
          }
        >
          <option value="openai">OpenAI 协议 (ChatGPT / 兼容)</option>
          <option value="anthropic">Anthropic 协议 (Claude)</option>
          <option value="google">Google 协议 (Gemini)</option>
        </select>
      </label>

      {/* 快速预设 */}
      <div>
        <label className="block text-xs font-medium text-[var(--theme-muted)] mb-1.5">
          快速预设
        </label>
        <div className="flex flex-wrap gap-2">
          {AI_URL_PRESETS.map((preset) => {
            const isPresetActive =
              aiSettings.provider === preset.protocol && currentEndpoint.baseUrl === preset.baseUrl;
            return (
              <button
                key={preset.id}
                type="button"
                className={`h-[28px] rounded-[5px] border px-2.5 text-xs font-medium transition-colors cursor-pointer ${
                  isPresetActive
                    ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]"
                    : "border-[var(--theme-border-strong)] bg-[var(--theme-surface)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)]"
                }`}
                onClick={() => {
                  onChangeAiSettings(applyAiUrlPreset(aiSettings, preset.id));
                  setTestState({ status: "idle", message: "" });
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Base URL */}
      <label className="grid grid-cols-[140px_1fr] items-center gap-3">
        <span className={fieldLabelClassName}>Endpoint (Base URL)</span>
        <div>
          <input
            type="text"
            className={inputClassName}
            value={currentEndpoint.baseUrl}
            onChange={(e) => {
              onChangeAiSettings(
                updateAiEndpoint(aiSettings, activeProtocol, { baseUrl: e.target.value }),
              );
              setTestState({ status: "idle", message: "" });
            }}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
            支持自定义 Base URL，可连接任意中转代理、DeepSeek、Ollama 或本地服务
          </p>
        </div>
      </label>

      {/* Model Name */}
      <label className="grid grid-cols-[140px_1fr] items-center gap-3">
        <span className={fieldLabelClassName}>Model 名称</span>
        <input
          type="text"
          className={inputClassName}
          value={currentEndpoint.model}
          onChange={(e) => {
            onChangeAiSettings(
              updateAiEndpoint(aiSettings, activeProtocol, { model: e.target.value }),
            );
            setTestState({ status: "idle", message: "" });
          }}
          placeholder="deepseek-chat / gpt-4o-mini"
          spellCheck={false}
        />
      </label>

      {/* API Key */}
      <label className="grid grid-cols-[140px_1fr] items-center gap-3">
        <span className={fieldLabelClassName}>API Key</span>
        <input
          type="password"
          className={inputClassName}
          value={currentEndpoint.apiKey}
          onChange={(e) => {
            onChangeAiSettings(
              updateAiEndpoint(aiSettings, activeProtocol, { apiKey: e.target.value }),
            );
            setTestState({ status: "idle", message: "" });
          }}
          placeholder="sk-..."
          spellCheck={false}
        />
      </label>

      {/* 连接测试 */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          className={smallButtonClassName}
          onClick={handleTestConnection}
          disabled={testState.status === "testing"}
        >
          {testState.status === "testing" ? "测试中..." : "测试连接"}
        </button>
        {testState.status === "success" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ {testState.message}
          </span>
        )}
        {testState.status === "error" && (
          <span className="text-xs text-red-600 dark:text-red-400">✗ {testState.message}</span>
        )}
      </div>

      {/* 原生桌面端推荐横幅 */}
      <div className="mt-4 rounded-lg border border-dashed border-[var(--theme-border)] p-3 text-xs bg-[var(--theme-chrome)]/40 flex items-center justify-between">
        <div className="text-[var(--theme-muted)]">
          💡 需要完全断网离线使用、银行级数据隔离与 0 延时专属小模型？
        </div>
        <button
          type="button"
          onClick={() => openOfficialSite("settings")}
          className="flex items-center gap-1 text-[var(--theme-primary)] hover:underline cursor-pointer bg-transparent border-0 text-xs shrink-0"
        >
          <span>下载原生桌面端</span>
          <ExternalLinkIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
