import type { WebAiConfig } from "./web-settings";

/**
 * 浏览器端原生 Fetch OpenAI 兼容协议客户端
 */

export interface AiTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
}

/**
 * 测试 AI 端点连通性与 API Key 是否有效
 */
export async function testAiConnection(config: WebAiConfig): Promise<AiTestResult> {
  if (!config.baseUrl) {
    return { ok: false, message: "API 端点（Base URL）不能为空" };
  }
  if (!config.apiKey && config.provider !== "ollama") {
    return { ok: false, message: "API Key 不能为空" };
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const startTime = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model || "deepseek-chat",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        temperature: 0.1,
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      let errMsg = `HTTP ${res.status} ${res.statusText}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          errMsg += `: ${parsed.error.message}`;
        }
      } catch {
        if (errorText) {
          errMsg += `: ${errorText.slice(0, 100)}`;
        }
      }
      return { ok: false, message: errMsg, latencyMs };
    }

    return { ok: true, message: "连接成功！模型响应正常", latencyMs };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `网络请求失败: ${errorMsg}（若使用本地 Ollama，请确认已在启动时配置 OLLAMA_ORIGINS="*" 允许跨域）`,
    };
  }
}

/**
 * 请求 AI 行内智能续写建议
 * 基于光标前后上下文，让模型生成简洁后续文本
 */
export async function requestWebAiContinuation(
  config: WebAiConfig,
  beforeCursor: string,
  afterCursor: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!config.enabled || !config.baseUrl) {
    return null;
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // 截取光标前后适量上下文（前文最多 1500 字，后文最多 500 字）
  const prefix = beforeCursor.slice(-1500);
  const suffix = afterCursor.slice(0, 500);

  const systemPrompt = `你是一个专业的写作与编程助手。
你的任务是根据给定的光标前文本与后文本，在光标位置无缝续写 1~2 句话或代码片段。
要求：
1. 绝对不要输出任何说明、问候或多余解释。
2. 绝对不要用代码块包裹输出（除非续写内容本身就是代码）。
3. 只直接输出续写的正文内容。
4. 保持行文语气、语言（中文或英文）与排版风格完全一致。`;

  const userPrompt = `<prefix>${prefix}</prefix>[光标位置]<suffix>${suffix}</suffix>`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0.3,
      }),
      signal,
    });

    if (!res.ok) {
      console.warn("[Web AI] 续写请求失败:", res.status, res.statusText);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      // 过滤掉可能的 markdown 外层包围代码
      return content.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return null;
    }
    console.warn("[Web AI] 请求异常:", err);
    return null;
  }
}
