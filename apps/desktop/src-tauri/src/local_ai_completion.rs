use std::{sync::Arc, time::Duration};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    local_ai_model::get_available_local_ai_model,
    local_ai_runtime::{
        post_chat_completion, post_raw_completion, schedule_idle_shutdown, LocalAiRuntimeState,
    },
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
    intent: Option<String>,
    prompt: Option<String>,
    stop: Option<Vec<String>>,
    temperature: Option<f32>,
    grammar: Option<String>,
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
    let intent = options.as_ref().and_then(|value| value.intent.as_deref());

    let (is_raw, request) = if let Some(prompt) = options.as_ref().and_then(|o| o.prompt.as_deref())
    {
        let stop = options
            .as_ref()
            .and_then(|o| o.stop.clone())
            .unwrap_or_default();
        let temp = options.as_ref().and_then(|o| o.temperature).unwrap_or(0.0);
        let mut payload = json!({
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": temp,
            "top_p": 1.0,
            "stop": stop,
            "cache_prompt": true,
            "stream": false
        });
        if let Some(grammar) = options.as_ref().and_then(|o| o.grammar.as_deref()) {
            if !grammar.trim().is_empty() {
                payload["grammar"] = json!(grammar);
            }
        }
        (true, payload)
    } else {

        let prompt = build_local_ai_prompt(&context, intent, max_tokens);
        (false, build_local_ai_request(&model, &prompt, max_tokens))
    };

    let runtime_manager = runtime.manager();
    let app_handle = app.clone();
    let model_for_runtime = model.clone();

    #[cfg(debug_assertions)]
    {
        eprintln!(
            "[Local AI] 发起推理 (model={}, raw={}):\n--- PROMPT ---\n{}\n--------------",
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
        let endpoint = runtime.ensure_ready(&app_handle, &model_for_runtime)?;
        let response = if is_raw {
            post_raw_completion(endpoint.port, &request, Duration::from_secs(120))
        } else {
            post_chat_completion(endpoint.port, &request, Duration::from_secs(120))
        };
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
            "[Local AI] 模型返回结果:\n--- OUTPUT ---\n{}\n--------------",
            content
        );
    }

    Ok(content)
}

fn build_local_ai_prompt(
    context: &LocalAiCompletionContext,
    intent: Option<&str>,
    max_tokens: u16,
) -> String {
    let is_editing = intent.is_none() || intent == Some("editing") || intent == Some("both");
    let is_continuation =
        intent.is_none() || intent == Some("continuation") || intent == Some("both");

    let instruction = match (is_editing, is_continuation) {
        (true, false) => "你是一个精通中文写作与审校的编辑。请仔细检查【当前选中文本/待检行】或【光标前】句子中的错别字、标点错误、语病并给出修改建议。若有修改需求则 hasEdit 设为 true 并填写 edit，否则 hasEdit 设为 false 且 edit 设为 null。hasContinuation 设为 false 且 continuation 设为空字符串。",
        (false, true) => "你是一个 Markdown 写作助手。请根据【光标前】内容在光标位置提供自然连贯的续写。hasContinuation 设为 true 并填写 continuation，hasEdit 设为 false 且 edit 设为 null。",
        _ => "你是一个专业的 Markdown 写作与修改润色助手。请检查【当前选中文本/待检行】或【光标前】句子是否存在错别字、标点误用或语病，若有请设置 hasEdit 为 true 并给出 edit；若无需修改则 hasEdit 为 false 且 edit 为 null。同时可在光标处提供续写并设置 hasContinuation 与 continuation。",
    };

    format!(
        "{instruction}\n\
         约束：只返回 JSON，不要任何解释，不要代码围栏。\n\
         JSON schema: {{\"hasEdit\":boolean,\"edit\":{{\"original\":\"string\",\"replacement\":\"string\",\"reason\":\"string\"}},\"hasContinuation\":boolean,\"continuation\":\"string\"}}。\n\
         说明：\n\
         1. hasEdit: true 时，edit.original 必须是上下文中真实存在的待修改原文片段，edit.replacement 是修改后内容，edit.reason 是简短修改理由。\n\
         2. hasEdit: false 时，edit 设为 null。\n\
         3. hasContinuation: true 时，continuation 是光标处连贯自然的后续文本；否则为 false 且为空字符串。\n\
         目标 token 上限：{max_tokens}\n\
         模式：{mode}\n\n\
         【光标前】\n{before}\n\n\
         【当前选中文本/待检行】\n{selected_text}\n\n\
         【光标后】\n{after}\n",
        instruction = instruction,
        max_tokens = max_tokens,
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
                "content": "你是 Markdown 写作助手，只返回严格符合 JSON Schema 的建议，不要解释，不要代码围栏。"
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
            "type": "json_object",
            "schema": {
                "type": "object",
                "properties": {
                    "hasContinuation": { "type": "boolean" },
                    "continuation": { "type": "string" },
                    "hasEdit": { "type": "boolean" },
                    "edit": {
                        "type": ["object", "null"],
                        "properties": {
                            "original": { "type": "string" },
                            "replacement": { "type": "string" },
                            "reason": { "type": "string" }
                        },
                        "required": ["original", "replacement"]
                    }
                },
                "required": ["hasContinuation", "continuation", "hasEdit", "edit"]
            }
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
