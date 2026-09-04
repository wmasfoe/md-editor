// apps/utools/src/utools/ai-disclaimer.ts
// AI 功能与 API Key 安全免责机制
// 明确告知用户：当前应用内嵌在 uTools 中，如果 API Key 或其他数据泄露，与本应用 (InkPoint) 无关

const DISCLAIMER_STORAGE_KEY = "inkpoint_utools_ai_disclaimer_accepted_v1";

/**
 * 免责声明文本
 */
export const AI_DISCLAIMER_CONTENT = {
  title: "【重要安全与免责告知】",
  summary:
    "当前 InkPoint 处于第三方平台 (uTools) 嵌入运行环境中。为了保护您的个人利益，请在配置自定义 API Key 或使用云端大模型前仔细阅读以下条款：",
  points: [
    "1. 运行环境安全：您在此输入的 API Key、Endpoint 以及文本内容直接留存在 uTools 本地存储或插件上下文中。",
    "2. 责任免除：因 uTools 宿主环境、操作系统剪贴板、第三方插件或云端同步引发的 API Key 泄露、额度损失或隐私风险，概与 InkPoint 原生应用及其开发团队无关。",
    "3. 极致安全推荐：如需完全离线零网络外传的隐私安全、银行级数据隔离以及独家【本地专属微调小模型 (SLM)】，请前往官网下载 InkPoint 原生桌面端。",
  ],
  buttonAccept: "我已知晓并同意免责条款",
  buttonReject: "取消",
  buttonDownloadDesktop: "下载原生桌面端 (支持完全离线本地AI)",
};

/**
 * 检查用户是否已经明确阅读并同意了免责协议
 */
export function hasAcceptedAiDisclaimer(): boolean {
  if (typeof window === "undefined" || typeof window.utools === "undefined") {
    return false;
  }
  return window.utools.dbStorage.getItem(DISCLAIMER_STORAGE_KEY) === "true";
}

/**
 * 记录用户同意免责协议
 */
export function acceptAiDisclaimer(): void {
  if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
    window.utools.dbStorage.setItem(DISCLAIMER_STORAGE_KEY, "true");
  }
}

/**
 * 重置免责状态（供测试或重新签署使用）
 */
export function resetAiDisclaimer(): void {
  if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
    window.utools.dbStorage.removeItem(DISCLAIMER_STORAGE_KEY);
  }
}
