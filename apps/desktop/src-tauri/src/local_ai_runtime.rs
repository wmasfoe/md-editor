use std::{
    env,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::local_ai_model::LocalAiModelFile;

const LLAMA_SERVER_BINARY_NAME: &str = "llama-server";
const LOCAL_AI_HOST: &str = "127.0.0.1";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(1);
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Default)]
pub(crate) struct LocalAiRuntimeState {
    manager: Arc<Mutex<LocalAiRuntimeManager>>,
}

impl LocalAiRuntimeState {
    pub(crate) fn manager(&self) -> Arc<Mutex<LocalAiRuntimeManager>> {
        Arc::clone(&self.manager)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiRuntimeEndpoint {
    pub(crate) port: u16,
}

#[derive(Default)]
pub(crate) struct LocalAiRuntimeManager {
    process: Option<LocalAiRuntimeProcess>,
}

struct LocalAiRuntimeProcess {
    child: Child,
    model_id: String,
    port: u16,
}

impl LocalAiRuntimeManager {
    pub(crate) fn ensure_ready(
        &mut self,
        app: &AppHandle,
        model: &LocalAiModelFile,
    ) -> Result<LocalAiRuntimeEndpoint, String> {
        if let Some(endpoint) = self.reusable_endpoint(model)? {
            return Ok(endpoint);
        }

        self.stop_runtime();

        let port = pick_available_localhost_port()?;
        let sidecar_path = resolve_llama_server_path(app)?;
        let args = build_llama_server_args(model, port);
        let mut command = Command::new(&sidecar_path);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(parent) = sidecar_path.parent() {
            command.current_dir(parent);
        }
        apply_runtime_library_paths(&mut command, &sidecar_path);

        let mut child = command.spawn().map_err(|error| {
            format!(
                "本地推理 runtime 启动失败：{}（{}）",
                error,
                sidecar_path.display()
            )
        })?;

        wait_until_runtime_ready(&mut child, port)?;

        self.process = Some(LocalAiRuntimeProcess {
            child,
            model_id: model.model_id.clone(),
            port,
        });

        Ok(LocalAiRuntimeEndpoint { port })
    }

    fn reusable_endpoint(
        &mut self,
        model: &LocalAiModelFile,
    ) -> Result<Option<LocalAiRuntimeEndpoint>, String> {
        let Some(process) = self.process.as_mut() else {
            return Ok(None);
        };

        if process.model_id != model.model_id {
            return Ok(None);
        }

        match process.child.try_wait() {
            Ok(None) => {
                if health_check(process.port).is_ok() {
                    Ok(Some(LocalAiRuntimeEndpoint { port: process.port }))
                } else {
                    Ok(None)
                }
            }
            Ok(Some(_)) => Ok(None),
            Err(error) => Err(format!("检查本地推理 runtime 状态失败：{error}")),
        }
    }

    fn stop_runtime(&mut self) {
        let Some(mut process) = self.process.take() else {
            return;
        };

        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

impl Drop for LocalAiRuntimeManager {
    fn drop(&mut self) {
        self.stop_runtime();
    }
}

pub(crate) fn build_llama_server_args(model: &LocalAiModelFile, port: u16) -> Vec<String> {
    vec![
        "--host".to_string(),
        LOCAL_AI_HOST.to_string(),
        "--port".to_string(),
        port.to_string(),
        "--model".to_string(),
        model.path.to_string_lossy().into_owned(),
        "--ctx-size".to_string(),
        model.context_size.to_string(),
        "--parallel".to_string(),
        "1".to_string(),
        "--alias".to_string(),
        model.model_id.clone(),
        "--offline".to_string(),
        "--no-webui".to_string(),
    ]
}

pub(crate) fn post_chat_completion(
    port: u16,
    request: &Value,
    timeout: Duration,
) -> Result<String, String> {
    let body = serde_json::to_string(request)
        .map_err(|error| format!("序列化本地模型请求失败：{error}"))?;
    let response =
        send_localhost_http_request("POST", "/v1/chat/completions", port, Some(&body), timeout)?;
    Ok(response.body)
}

fn health_check(port: u16) -> Result<(), String> {
    let response =
        send_localhost_http_request("GET", "/v1/models", port, None, HEALTH_CHECK_TIMEOUT)?;
    let value = serde_json::from_str::<Value>(&response.body)
        .map_err(|error| format!("解析本地模型健康检查失败：{error}"))?;
    if value.get("data").and_then(Value::as_array).is_some() {
        Ok(())
    } else {
        Err("本地模型健康检查没有返回模型列表。".to_string())
    }
}

fn wait_until_runtime_ready(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(None) => {}
            Ok(Some(status)) => {
                return Err(format!("本地推理 runtime 启动失败，进程已退出：{status}"));
            }
            Err(error) => return Err(format!("检查本地推理 runtime 启动状态失败：{error}")),
        }

        if health_check(port).is_ok() {
            return Ok(());
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("本地模型加载超时，请稍后重试。".to_string());
        }

        thread::sleep(HEALTH_CHECK_INTERVAL);
    }
}

fn pick_available_localhost_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("无法分配本地推理端口：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法读取本地推理端口：{error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn resolve_llama_server_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("MD_EDITOR_LLAMA_SERVER_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let file_name = sidecar_resource_file_name();
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&file_name));
        candidates.push(resource_dir.join("local-ai-runtime").join(&file_name));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(&file_name));
        }
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "本地推理 runtime 未打包：找不到 {file_name}。请确认 llama-server sidecar 已随 App 打包。"
            )
        })
}

fn sidecar_resource_file_name() -> String {
    if cfg!(target_os = "windows") {
        format!("{LLAMA_SERVER_BINARY_NAME}.exe")
    } else {
        LLAMA_SERVER_BINARY_NAME.to_string()
    }
}

fn apply_runtime_library_paths(command: &mut Command, sidecar_path: &Path) {
    let Some(parent) = sidecar_path.parent() else {
        return;
    };

    let mut library_dirs = vec![parent.to_path_buf()];
    let sibling_runtime_dir = parent.join("llama-runtime-macos-arm64");
    if sibling_runtime_dir.is_dir() {
        library_dirs.push(sibling_runtime_dir);
    }

    let Ok(joined_paths) = env::join_paths(library_dirs) else {
        return;
    };

    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", joined_paths);

    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", joined_paths);

    #[cfg(target_os = "windows")]
    command.env("PATH", joined_paths);
}

#[derive(Debug)]
struct HttpResponse {
    body: String,
}

fn send_localhost_http_request(
    method: &str,
    path: &str,
    port: u16,
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("连接本地推理服务失败：{error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("设置本地推理读取超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("设置本地推理写入超时失败：{error}"))?;

    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\n\
         Host: {LOCAL_AI_HOST}:{port}\r\n\
         Accept: application/json\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n\
         {body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("发送本地模型请求失败：{error}"))?;

    let mut bytes = Vec::new();
    stream
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取本地模型响应失败：{error}"))?;

    parse_http_response(&bytes)
}

fn parse_http_response(bytes: &[u8]) -> Result<HttpResponse, String> {
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "本地推理服务返回了无效 HTTP 响应。".to_string())?;
    let header_bytes = &bytes[..header_end];
    let body_bytes = &bytes[(header_end + 4)..];
    let headers = String::from_utf8_lossy(header_bytes);
    let status_line = headers
        .lines()
        .next()
        .ok_or_else(|| "本地推理服务缺少 HTTP 状态行。".to_string())?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "本地推理服务返回了无效状态码。".to_string())?;

    let is_chunked = headers.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("transfer-encoding:") && lower.contains("chunked")
    });
    let body_bytes = if is_chunked {
        decode_chunked_body(body_bytes)?
    } else {
        body_bytes.to_vec()
    };
    let body = String::from_utf8(body_bytes)
        .map_err(|error| format!("本地推理服务返回了非 UTF-8 响应：{error}"))?;

    if !(200..300).contains(&status_code) {
        return Err(format!(
            "本地推理服务返回 {status_code}：{}",
            truncate_for_error(&body)
        ));
    }

    Ok(HttpResponse { body })
}

fn decode_chunked_body(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let line_end = find_crlf(&bytes[index..])
            .ok_or_else(|| "本地推理服务返回了无效 chunk 响应。".to_string())?;
        let size_line = std::str::from_utf8(&bytes[index..(index + line_end)])
            .map_err(|error| format!("本地推理服务返回了无效 chunk 长度：{error}"))?;
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|error| format!("本地推理服务返回了无效 chunk 长度：{error}"))?;
        index += line_end + 2;

        if size == 0 {
            break;
        }
        if index + size > bytes.len() {
            return Err("本地推理服务 chunk 响应不完整。".to_string());
        }
        decoded.extend_from_slice(&bytes[index..(index + size)]);
        index += size;
        if bytes.get(index..(index + 2)) == Some(&b"\r\n"[..]) {
            index += 2;
        }
    }

    Ok(decoded)
}

fn find_crlf(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"\r\n")
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
    fn builds_llama_server_args_with_localhost_and_model_path() {
        let model = LocalAiModelFile {
            model_id: "md-editor-writer-small-v1".to_string(),
            display_name: "Writer Small".to_string(),
            version: "2026.06.25".to_string(),
            path: PathBuf::from("/tmp/model.gguf"),
            context_size: 4096,
            default_max_tokens: 220,
        };

        let args = build_llama_server_args(&model, 58231);

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--host", LOCAL_AI_HOST]));
        assert!(args.windows(2).any(|pair| pair == ["--port", "58231"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--model", "/tmp/model.gguf"]));
        assert!(args.windows(2).any(|pair| pair == ["--ctx-size", "4096"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--alias", "md-editor-writer-small-v1"]));
        assert!(args.iter().any(|arg| arg == "--offline"));
        assert!(args.iter().any(|arg| arg == "--no-webui"));
    }

    #[test]
    fn parses_regular_http_response_body() {
        let response = parse_http_response(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
        )
        .unwrap();

        assert_eq!(response.body, "{\"ok\":true}");
    }

    #[test]
    fn parses_chunked_http_response_body() {
        let response = parse_http_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nb\r\n{\"ok\":true}\r\n0\r\n\r\n",
        )
        .unwrap();

        assert_eq!(response.body, "{\"ok\":true}");
    }

    #[test]
    fn reports_non_success_http_status() {
        let error = parse_http_response(b"HTTP/1.1 500 Server Error\r\n\r\n{\"error\":\"bad\"}")
            .unwrap_err();

        assert!(error.contains("500"));
        assert!(error.contains("bad"));
    }
}
