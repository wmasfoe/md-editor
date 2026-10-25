/**
 * @file desktop-ai-service.ts
 * @description
 * 桌面端 AI 写作服务单例 (Clean Architecture 顶层组装根)。
 * 通过依赖倒置注入桌面端原生本地模型推理桥接器 (desktopLocalAiBridge)，
 * 提供多协议云端与本地端侧统一的续写、语法纠错、文档提炼与连接测试能力。
 */

import { createAiWritingService, type AiWritingService } from "@md-editor/ai";
import { desktopLocalAiBridge } from "./local-ai-model.ts";

/**
 * 桌面端统一 AI 助写服务实例
 */
export const desktopAiService: AiWritingService = createAiWritingService({
  allowLocal: true,
  localBridge: desktopLocalAiBridge,
});
