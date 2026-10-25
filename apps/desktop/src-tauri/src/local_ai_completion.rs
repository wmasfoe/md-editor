use std::{sync::Arc, time::Duration};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    local_ai_model::get_available_local_ai_model,
    local_ai_runtime::{
        post_chat_completion, post_raw_completion, schedule_idle_shutdown, LocalAiRuntimeState,
        LocalAiTask,
    },
};

#[derive(Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiContinuationOptions {
    model_id: Option<String>,
    max_tokens: Option<u16>,
    task: Option<LocalAiTask>,
    raw_prompt: Option<String>,
    messages: Option<Vec<LocalAiChatMessage>>,
    stop: Option<Vec<String>>,
    temperature: Option<f32>,
    grammar: Option<String>,
    disable_thinking: Option<bool>,
    cache_prompt: Option<bool>,
}

#[tauri::command]
pub(crate) async fn request_local_ai_continuation(
    app: AppHandle,
    runtime: State<'_, LocalAiRuntimeState>,
    options: LocalAiContinuationOptions,
) -> Result<String, String> {
    let model = get_available_local_ai_model(options.model_id.as_deref())?;
    let max_tokens = options.max_tokens.unwrap_or(model.default_max_tokens);
    let (is_raw, request) = build_local_ai_request(&model.model_id, max_tokens, &options)?;

    let runtime_manager = runtime.manager();
    let app_handle = app.clone();
    let model_for_runtime = model.clone();
    let task = options.task;

    #[cfg(debug_assertions)]
    {
        eprintln!(
            "[Local AI] 📤 发起推理请求 (model={}, raw={}):\n--- [PROMPT 输入] ---\n{}\n--- [PROMPT 结束] ---",
            model.model_id,
            is_raw,
            request.get("prompt").and_then(Value::as_str).unwrap_or("")
        );
    }

    let response_body = tauri::async_runtime::spawn_blocking(move || {
        let idle_manager = Arc::clone(&runtime_manager);
        let mut runtime = runtime_manager
            .lock()
            .map_err(|_| "本地推理 runtime 状态锁已损坏。".to_string())?;
        let endpoint = match runtime.ensure_ready(&app_handle, &model_for_runtime) {
            Ok(ep) => ep,
            Err(err) => {
                eprintln!("[Local AI Error] ensure_ready 启动服务失败: {err}");
                return Err(err);
            }
        };
        let response = runtime
            .activate_lora_adapter(endpoint.port, task)
            .and_then(|()| {
                if is_raw {
                    post_raw_completion(endpoint.port, &request, Duration::from_secs(120))
                } else {
                    post_chat_completion(endpoint.port, &request, Duration::from_secs(120))
                }
            });
        if let Err(err) = &response {
            eprintln!("[Local AI Error] 请求本地推理服务接口失败: {err}");
        }
        runtime.mark_used();
        drop(runtime);
        schedule_idle_shutdown(idle_manager);
        response
    })
    .await
    .map_err(|error| format!("本地推理 runtime 任务失败：{error}"))??;

    let content = extract_local_ai_completion_content(&response_body)?;

    #[cfg(debug_assertions)]
    {
        eprintln!(
            "[Local AI] 📥 模型生成返回:\n--- [OUTPUT 输出] ---\n{}\n--- [OUTPUT 结束] ---",
            content
        );
    }

    Ok(content)
}

/// Harness owns prompts; the native host only translates its request to llama-server.
fn build_local_ai_request(
    model_id: &str,
    max_tokens: u16,
    options: &LocalAiContinuationOptions,
) -> Result<(bool, Value), String> {
    let messages = options
        .messages
        .as_ref()
        .filter(|messages| !messages.is_empty());
    let raw_prompt = options
        .raw_prompt
        .as_deref()
        .filter(|prompt| !prompt.is_empty());
    let (is_raw, mut payload) = match (messages, raw_prompt) {
        (Some(messages), None) => (
            false,
            json!({
                "model": model_id,
                "messages": messages,
                "temperature": options.temperature.unwrap_or(0.0),
                "max_tokens": max_tokens,
                "stream": false,
                "chat_template_kwargs": {
                    "enable_thinking": !options.disable_thinking.unwrap_or(true)
                }
            }),
        ),
        (None, Some(prompt)) => (
            true,
            json!({
                "prompt": prompt,
                "n_predict": max_tokens,
                "temperature": options.temperature.unwrap_or(0.3),
                "cache_prompt": options.cache_prompt.unwrap_or(true),
                "stream": false
            }),
        ),
        _ => {
            return Err("本地推理请求必须提供 messages 或 rawPrompt，且不能同时提供。".to_string())
        }
    };
    if let Some(stop) = &options.stop {
        if !stop.is_empty() {
            payload["stop"] = json!(stop);
        }
    }
    if let Some(grammar) = &options.grammar {
        if !grammar.trim().is_empty() {
            payload["grammar"] = json!(grammar);
        }
    }
    Ok((is_raw, payload))
}

fn extract_local_ai_completion_content(response_body: &str) -> Result<String, String> {
    let response = serde_json::from_str::<Value>(response_body)
        .map_err(|error| format!("解析本地模型响应失败：{error}"))?;

    if let Some(message) = response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| response.pointer("/message").and_then(Value::as_str))
    {
        return Err(format!("本地模型生成失败：{message}"));
    }

    let content = response
        .pointer("/content")
        .and_then(Value::as_str)
        .or_else(|| {
            response
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
        })
        .or_else(|| response.pointer("/choices/0/text").and_then(Value::as_str))
        .ok_or_else(|| {
            format!(
                "本地模型没有返回可解析内容：{}",
                truncate_for_error(response_body)
            )
        })?;

    Ok(content.trim_end().to_string())
}

fn truncate_for_error(body: &str) -> String {
    const LIMIT: usize = 240;
    let trimmed = body.trim();
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }

    let mut value = trimmed.chars().take(LIMIT).collect::<String>();
    value.push_str("...");
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_shared_harness_requests_without_editor_context() {
        // These exact IPC arguments are also exercised by the TypeScript bridge tests.
        let requests: Vec<Value> = serde_json::from_str(include_str!(
            "../../tests/fixtures/local-ai-inference-requests.json"
        ))
        .unwrap();
        let expected_tasks = [
            LocalAiTask::Gec,
            LocalAiTask::Completion,
            LocalAiTask::Completion,
            LocalAiTask::Distill,
        ];

        for (args, task) in requests.iter().zip(expected_tasks) {
            let source = &args["options"];
            let options: LocalAiContinuationOptions =
                serde_json::from_value(source.clone()).unwrap();
            assert_eq!(options.task, Some(task));
            let (is_raw, payload) = build_local_ai_request(
                options.model_id.as_deref().unwrap(),
                options.max_tokens.unwrap(),
                &options,
            )
            .unwrap();
            assert_eq!(payload["stream"], false);
            assert_eq!(payload["stop"], source["stop"]);
            assert_eq!(payload["grammar"], source["grammar"]);
            if is_raw {
                assert_eq!(payload["prompt"], source["rawPrompt"]);
                assert_eq!(payload["n_predict"], source["maxTokens"]);
                assert_eq!(payload["cache_prompt"], true);
                assert!(payload.get("messages").is_none());
            } else {
                assert_eq!(payload["messages"], source["messages"]);
                assert_eq!(payload["max_tokens"], source["maxTokens"]);
                assert_eq!(payload["chat_template_kwargs"]["enable_thinking"], false);
            }
            let temperature = payload["temperature"].as_f64().unwrap();
            assert!((temperature - source["temperature"].as_f64().unwrap()).abs() < 1e-6);
        }
    }

    #[test]
    fn rejects_unknown_tasks_and_ambiguous_or_missing_payloads() {
        assert!(serde_json::from_value::<LocalAiContinuationOptions>(json!({
            "task": "editing", "rawPrompt": "text"
        }))
        .is_err());
        for source in [
            json!({}),
            json!({"messages": []}),
            json!({"rawPrompt": ""}),
            json!({"messages": [{"role": "user", "content": "text"}], "rawPrompt": "text"}),
        ] {
            let options = serde_json::from_value(source).unwrap();
            assert!(build_local_ai_request("model", 128, &options).is_err());
        }
    }
}
