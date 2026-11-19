//! Local llama.cpp inference for the native desktop host.
//!
//! Models live beside the existing Tauri app data, so switching hosts preserves
//! user downloads and never starts a model download as a side effect.

use std::{
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

const MODEL_IDS: [&str; 3] = [
    "md-editor-writer-standard",
    "md-editor-writer-lite",
    "md-editor-writer-small-v1",
];
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const LOCAL_BEFORE_WINDOW_CHARS: usize = 1_800;
const LOCAL_AFTER_WINDOW_CHARS: usize = 600;
const FIM_PREFIX: &str = "<|fim_prefix|>";
const FIM_SUFFIX: &str = "<|fim_suffix|>";
const FIM_MIDDLE: &str = "<|fim_middle|>";

/// Reuses models downloaded by the existing desktop app and runs inference off
/// the UI thread. The caller should invoke [`complete`](Self::complete) from a
/// GPUI background executor and present the returned text for user acceptance.
pub(crate) struct LocalAiService {
    sidecar_path: PathBuf,
    app_data_dir: PathBuf,
    runtime: Mutex<Runtime>,
    shutdown: AtomicBool,
}

impl LocalAiService {
    /// `app_data_dir` is the existing `dirs::data_dir()/md-editor` directory.
    pub(crate) fn new(sidecar_path: PathBuf, app_data_dir: PathBuf) -> Self {
        Self {
            sidecar_path,
            app_data_dir,
            runtime: Mutex::new(Runtime::default()),
            shutdown: AtomicBool::new(false),
        }
    }

    /// Stops an active server and prevents future requests. Safe to call on app quit.
    pub(crate) fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.stop();
        }
    }

    /// Generates a Markdown continuation from the local model.
    pub(crate) fn complete(&self, before: &str, after: &str) -> Result<String, String> {
        if before.trim().is_empty() && after.trim().is_empty() {
            return Err("请先输入一些内容，再使用本地 AI 续写。".to_string());
        }
        if self.shutdown.load(Ordering::Acquire) {
            return Err("本地 AI runtime 已关闭。".to_string());
        }

        let model = self.find_model()?;
        let port = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "本地推理 runtime 状态锁已损坏。".to_string())?;
            runtime.ensure_ready(&self.sidecar_path, &model, &self.shutdown)?
        };

        let agent = ureq::AgentBuilder::new()
            .timeout(REQUEST_TIMEOUT)
            .try_proxy_from_env(false)
            .build();
        if model.completion_adapter_path.is_some() {
            activate_completion_adapter(&agent, port)?;
        }
        let response = if model.is_lite() {
            let request = build_lite_request(before, after);
            send_json(
                &agent,
                &format!("http://127.0.0.1:{port}/completion"),
                &request,
            )
            .map_err(|error| format!("本地模型生成失败：{error}"))?
        } else {
            let request = build_request(
                &model.id,
                take_last_chars(before, LOCAL_BEFORE_WINDOW_CHARS),
                take_first_chars(after, LOCAL_AFTER_WINDOW_CHARS),
            );
            send_json(
                &agent,
                &format!("http://127.0.0.1:{port}/v1/chat/completions"),
                &request,
            )
            .map_err(|error| format!("本地模型生成失败：{error}"))?
        };
        let body = response
            .into_string()
            .map_err(|error| format!("读取本地模型响应失败：{error}"))?;
        extract_completion(&body)
    }

    fn find_model(&self) -> Result<Model, String> {
        let models_dir = self.app_data_dir.join("ai").join("models");
        let mut model_ids = Vec::<String>::with_capacity(MODEL_IDS.len());
        if let Ok(settings) = std::fs::read_to_string(self.app_data_dir.join("settings.json"))
            && let Ok(settings) = serde_json::from_str::<Value>(&settings)
            && let Some(selected) = settings
                .pointer("/ai/localModel/modelId")
                .and_then(Value::as_str)
                .filter(|id| MODEL_IDS.contains(id))
        {
            model_ids.push(selected.to_owned());
        }
        for id in MODEL_IDS {
            if !model_ids.iter().any(|existing| existing == id) {
                model_ids.push(id.to_string());
            }
        }

        for id in model_ids {
            let directory = models_dir.join(&id);
            let base = [directory.join("base.gguf"), directory.join("model.gguf")]
                .into_iter()
                .find(|path| path.is_file());
            let Some(base_path) = base else {
                continue;
            };

            return Ok(Model {
                id: id.clone(),
                base_path,
                completion_adapter_path: existing_file(directory.join("completion.gguf")),
                context_size: 8192,
            });
        }

        Err("本地模型尚未下载。请在 Inkpoint 桌面版中先下载 Lite 或 Standard 模型。".to_string())
    }
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.is_file().then_some(path)
}

struct Model {
    id: String,
    base_path: PathBuf,
    completion_adapter_path: Option<PathBuf>,
    context_size: u32,
}

impl Model {
    fn is_lite(&self) -> bool {
        self.id != "md-editor-writer-standard"
    }
}

#[derive(Default)]
struct Runtime {
    process: Option<RuntimeProcess>,
}

struct RuntimeProcess {
    child: Child,
    model_id: String,
    port: u16,
}

impl Runtime {
    fn ensure_ready(
        &mut self,
        sidecar: &Path,
        model: &Model,
        shutdown: &AtomicBool,
    ) -> Result<u16, String> {
        if shutdown.load(Ordering::Acquire) {
            return Err("本地 AI runtime 已关闭。".to_string());
        }
        if let Some(process) = self.process.as_mut() {
            if process.model_id == model.id && process.child.try_wait().ok().flatten().is_none() {
                return Ok(process.port);
            }
            self.stop();
        }

        if !sidecar.is_file() {
            return Err(format!("本地推理 runtime 未打包：{}", sidecar.display()));
        }

        let port = available_port()?;
        let mut command = Command::new(sidecar);
        command
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--model",
            ])
            .arg(&model.base_path)
            .args([
                "--ctx-size",
                &model.context_size.to_string(),
                "--parallel",
                "2",
                "--alias",
                &model.id,
                "--offline",
                "--no-webui",
                "--jinja",
                "--reasoning-budget",
                "0",
                "--n-gpu-layers",
                "99",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(adapter) = &model.completion_adapter_path {
            command
                .arg("--lora")
                .arg(adapter)
                .arg("--lora-init-without-apply");
        }
        set_runtime_library_path(&mut command, sidecar);

        let mut child = command
            .spawn()
            .map_err(|error| format!("启动本地推理 runtime 失败：{error}"))?;
        if let Err(error) = wait_until_ready(&mut child, port, shutdown) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        self.process = Some(RuntimeProcess {
            child,
            model_id: model.id.clone(),
            port,
        });
        Ok(port)
    }

    fn stop(&mut self) {
        if let Some(mut process) = self.process.take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop();
    }
}

fn available_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("无法分配本地推理端口：{error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("无法读取本地推理端口：{error}"))
}

fn wait_until_ready(child: &mut Child, port: u16, shutdown: &AtomicBool) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(300))
        .try_proxy_from_env(false)
        .build();
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if shutdown.load(Ordering::Acquire) {
            return Err("本地 AI runtime 已关闭。".to_string());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("检查本地推理 runtime 状态失败：{error}"))?
        {
            return Err(format!("本地推理 runtime 启动失败：{status}"));
        }
        if agent
            .get(&format!("http://127.0.0.1:{port}/v1/models"))
            .call()
            .is_ok()
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("本地模型加载超时，请稍后重试。".to_string());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn set_runtime_library_path(command: &mut Command, sidecar: &Path) {
    let Some(parent) = sidecar.parent() else {
        return;
    };
    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", parent);
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", parent);
}

fn activate_completion_adapter(agent: &ureq::Agent, port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/lora-adapters");
    let response = agent
        .get(&url)
        .call()
        .map_err(|error| format!("读取本地模型适配器失败：{error}"))?
        .into_string()
        .map_err(|error| format!("读取本地模型适配器失败：{error}"))?;
    let adapters = serde_json::from_str::<Vec<Value>>(&response)
        .map_err(|error| format!("解析本地模型适配器失败：{error}"))?;
    let settings = adapters
        .iter()
        .filter_map(|adapter| {
            let id = adapter.get("id")?.as_u64()?;
            let path = adapter.get("path")?.as_str()?;
            Some(json!({
                "id": id,
                "scale": if path.to_ascii_lowercase().contains("completion") { 1.0 } else { 0.0 }
            }))
        })
        .collect::<Vec<_>>();
    if settings.is_empty() {
        return Err("本地模型已加载 LoRA，但服务未返回适配器。".to_string());
    }
    send_json(agent, &url, &json!(settings))
        .map_err(|error| format!("启用本地续写适配器失败：{error}"))?;
    Ok(())
}

fn send_json(agent: &ureq::Agent, url: &str, body: &Value) -> Result<ureq::Response, String> {
    let body = serde_json::to_string(body).map_err(|error| error.to_string())?;
    agent
        .post(url)
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map_err(|error| error.to_string())
}

fn take_last_chars(text: &str, max_chars: usize) -> &str {
    if max_chars == 0 {
        return "";
    }
    text.char_indices()
        .rev()
        .nth(max_chars - 1)
        .map_or(text, |(offset, _)| &text[offset..])
}

fn take_first_chars(text: &str, max_chars: usize) -> &str {
    text.char_indices()
        .nth(max_chars)
        .map_or(text, |(offset, _)| &text[..offset])
}

fn build_request(model_id: &str, before: &str, after: &str) -> Value {
    json!({
        "model": model_id,
        "messages": [
            {
                "role": "system",
                "content": "你是一个无缝文本续写引擎。请根据用户提供的光标前文（以及可选的光标后文），直接输出接下来自然的续写内容。严禁输出任何解释、说明、前缀或 Markdown 引号包裹，直接输出纯续写正文。"
            },
            {
                "role": "user",
                "content": format!("【光标前文】\n{before}\n【光标后文】\n{after}")
            }
        ],
        "temperature": 0.3,
        "max_tokens": 128,
        "stream": false,
        "chat_template_kwargs": { "enable_thinking": false }
    })
}

fn build_lite_request(before: &str, after: &str) -> Value {
    json!({
        "prompt": format!(
            "{FIM_PREFIX}{}{FIM_SUFFIX}{}{FIM_MIDDLE}",
            take_last_chars(before, LOCAL_BEFORE_WINDOW_CHARS),
            take_first_chars(after, LOCAL_AFTER_WINDOW_CHARS)
        ),
        "n_predict": 64,
        "temperature": 0.3,
        "cache_prompt": true,
        "stream": false,
        "stop": ["<|fim_end|>", "<|im_end|>", "<|endoftext|>"]
    })
}

fn extract_completion(response: &str) -> Result<String, String> {
    let value = serde_json::from_str::<Value>(response)
        .map_err(|error| format!("解析本地模型响应失败：{error}"))?;
    if let Some(message) = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/message").and_then(Value::as_str))
    {
        return Err(format!("本地模型生成失败：{message}"));
    }
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/content").and_then(Value::as_str))
        .or_else(|| value.pointer("/choices/0/text").and_then(Value::as_str))
        .map(|content| content.trim_end().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "本地模型没有返回可用的续写内容。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_non_streaming_chat_request() {
        let request = build_request("md-editor-writer-standard", "# 标题", "后文");
        assert_eq!(request["model"], "md-editor-writer-standard");
        assert_eq!(request["stream"], false);
        assert_eq!(request["max_tokens"], 128);
        assert!(
            request["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("无缝文本续写")
        );
        assert_eq!(
            request["messages"][1]["content"],
            "【光标前文】\n# 标题\n【光标后文】\n后文"
        );
    }

    #[test]
    fn builds_lite_fim_request_with_bounded_context() {
        let context = "甲".repeat(LOCAL_BEFORE_WINDOW_CHARS + 10);
        let request = build_lite_request(&context, "尾部");
        assert!(request["prompt"].as_str().unwrap().starts_with(FIM_PREFIX));
        assert!(request["prompt"].as_str().unwrap().ends_with(FIM_MIDDLE));
        assert_eq!(
            request["prompt"],
            format!(
                "{FIM_PREFIX}{}{FIM_SUFFIX}尾部{FIM_MIDDLE}",
                &context["甲".len() * 10..]
            )
        );
        assert_eq!(request["n_predict"], 64);
        assert_eq!(request["cache_prompt"], true);
    }

    #[test]
    fn extracts_chat_content_and_reports_model_errors() {
        assert_eq!(
            extract_completion(r#"{"choices":[{"message":{"content":"续写\n"}}]}"#).unwrap(),
            "续写"
        );
        assert!(
            extract_completion(r#"{"error":{"message":"unavailable"}}"#)
                .unwrap_err()
                .contains("unavailable")
        );
    }
}
