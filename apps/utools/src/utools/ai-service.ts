/**
 * @file ai-service.ts
 * @description
 * uTools 端统一 AI 写作服务单例 (Clean Architecture 顶层组装根)。
 * 支持 OpenAI、Anthropic (Claude)、Google Gemini 三大标准协议及自定义 Base URL，
 * 禁用端侧离线本地 GGUF 模型 (allowLocal: false)。
 */

import { createAiWritingService, type AiWritingService } from "@md-editor/ai";

/**
 * uTools 统一 AI 写作服务实例
 */
export const utoolsAiService: AiWritingService = createAiWritingService({
  allowLocal: false,
});
