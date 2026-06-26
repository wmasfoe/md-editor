use std::{sync::Arc, time::Duration};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    local_ai_model::get_available_local_ai_model,
    local_ai_runtime::{post_chat_completion, schedule_idle_shutdown, LocalAiRuntimeState},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiCompletionContext {
    before: String,
    after: String,
    selected_text: String,
    mode: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiContinuationOptions {
    model_id: Option<String>,
    max_tokens: Option<u16>,
}

#[tauri::command]
pub(crate) async fn request_local_ai_continuation(
    app: AppHandle,
    runtime: State<'_, LocalAiRuntimeState>,
    context: LocalAiCompletionContext,
    options: Option<LocalAiContinuationOptions>,
) -> Result<String, String> {
    let model_id = options.as_ref().and_then(|value| value.model_id.clone());
    let model = get_available_local_ai_model(model_id.as_deref())?;
    let max_tokens = options
        .as_ref()
        .and_then(|value| value.max_tokens)
        .unwrap_or(model.default_max_tokens);
    let prompt = build_local_ai_prompt(&context, max_tokens);
    let request = build_local_ai_request(&model, &prompt, max_tokens);
    let runtime_manager = runtime.manager();
    let app_handle = app.clone();
    let model_for_runtime = model.clone();

    let response_body = tauri::async_runtime::spawn_blocking(move || {
        let idle_manager = Arc::clone(&runtime_manager);
        let mut runtime = runtime_manager
            .lock()
            .map_err(|_| "本地推理 runtime 状态锁已损坏。".to_string())?;
        let endpoint = runtime.ensure_ready(&app_handle, &model_for_runtime)?;
        let response = post_chat_completion(endpoint.port, &request, Duration::from_secs(120));
        runtime.mark_used();
        drop(runtime);
        schedule_idle_shutdown(idle_manager);
        response
    })
    .await
    .map_err(|error| format!("本地推理 runtime 任务失败：{error}"))??;

    extract_local_ai_completion_content(&response_body)
}

fn build_local_ai_prompt(context: &LocalAiCompletionContext, max_tokens: u16) -> String {
    format!(
        "你是 Markdown 写作助手，需要根据上下文返回续写建议。\n\
         约束：只返回 JSON，不要解释，不要代码围栏。\n\
         JSON schema: {{\"continuation\":\"string\",\"edit\":null}}。\n\
         目标 token 上限：{max_tokens}\n\
         模式：{mode}\n\n\
         【光标前】\n{before}\n\n\
         【当前选中文本】\n{selected_text}\n\n\
         【光标后】\n{after}\n",
        mode = context.mode.as_str(),
        before = context.before.as_str(),
        selected_text = context.selected_text.as_str(),
        after = context.after.as_str()
    )
}

fn build_local_ai_request(
    model: &crate::local_ai_model::LocalAiModelFile,
    prompt: &str,
    max_tokens: u16,
) -> Value {
    json!({
        "model": model.model_id,
        "messages": [
            {
                "role": "system",
                "content": "你是 Markdown 写作助手，只返回 JSON，不要解释，不要代码围栏。"
            },
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "stream": false,
        "response_format": {
            "type": "json_object"
        }
    })
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
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| response.pointer("/choices/0/text").and_then(Value::as_str))
        .ok_or_else(|| {
            format!(
                "本地模型没有返回可解析内容：{}",
                truncate_for_error(response_body)
            )
        })?;

    Ok(content.trim().to_string())
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
