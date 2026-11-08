use std::{
    collections::{HashMap, HashSet},
    env,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
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
const LOCAL_AI_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// 全局活动 llama-server 进程 PID 记录，用于在应用退出或发生 panic 时内核级强制终结，杜绝孤儿进程
static ACTIVE_LLAMA_PID: AtomicU32 = AtomicU32::new(0);

/// Stable Harness task names are shared with `@md-editor/ai`; no legacy intent aliases.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LocalAiTask {
    Gec,
    Completion,
    Distill,
    /// 风格学习分类任务：只在本地 Standard 上运行，不使用任何 LoRA，
    /// 不能热切换已加载的其他模型，并且提示词与输出属于用户历史文章，禁止打印。
    #[serde(rename = "style-analysis")]
    StyleAnalysis,
}

impl LocalAiTask {
    fn adapter_scale(self, path: &str) -> f32 {
        let name = match self {
            Self::Gec => "gec",
            Self::Completion => "completion",
            Self::Distill => "distill",
            Self::StyleAnalysis => return 0.0,
        };
        if path.to_ascii_lowercase().contains(name) {
            1.0
        } else {
            0.0
        }
    }

    /// 是否允许在 dev 日志中打印该任务的提示词与模型输出。
    pub(crate) fn may_log_content(self) -> bool {
        !matches!(self, Self::StyleAnalysis)
    }
}

/// 冷加载被取消时返回的错误。
pub(crate) const LOCAL_AI_CANCELLED_ERROR: &str = "本地推理请求已取消。";
/// 风格学习不能切换正在使用中的其他模型时返回的错误（TS 侧据此放弃本次空闲窗口）。
pub(crate) const LOCAL_AI_BUSY_ERROR: &str = "local-ai-busy";

#[derive(Clone, Default)]
pub(crate) struct LocalAiRuntimeState {
    manager: Arc<Mutex<LocalAiRuntimeManager>>,
    active_connections: Arc<Mutex<HashMap<String, Arc<TcpStream>>>>,
    active_tasks: Arc<Mutex<HashMap<LocalAiTask, String>>>,
    cancelled_request_ids: Arc<Mutex<HashSet<String>>>,
}

impl LocalAiRuntimeState {
    pub(crate) fn manager(&self) -> Arc<Mutex<LocalAiRuntimeManager>> {
        Arc::clone(&self.manager)
    }

    /// 注册正在执行的网络通信流，若此前存在同 task 的在途旧请求，自动抢占中止
    pub(crate) fn register_connection(
        &self,
        request_id: String,
        task: Option<LocalAiTask>,
        stream: Arc<TcpStream>,
    ) {
        if let Some(t) = task {
            let mut tasks = self.active_tasks.lock().unwrap();
            if let Some(old_id) = tasks.insert(t, request_id.clone()) {
                if old_id != request_id {
                    let mut connections = self.active_connections.lock().unwrap();
                    if let Some(old_stream) = connections.remove(&old_id) {
                        let _ = old_stream.shutdown(std::net::Shutdown::Both);
                    }
                    let mut cancelled = self.cancelled_request_ids.lock().unwrap();
                    cancelled.insert(old_id);
                }
            }
        }

        let mut connections = self.active_connections.lock().unwrap();
        connections.insert(request_id, stream);
    }

    /// 注销已完成的通信流
    pub(crate) fn unregister_connection(&self, request_id: &str) {
        let mut connections = self.active_connections.lock().unwrap();
        connections.remove(request_id);
        let mut cancelled = self.cancelled_request_ids.lock().unwrap();
        cancelled.remove(request_id);
    }

    /// 检查指定请求是否已被显式或抢占取消
    pub(crate) fn is_cancelled(&self, request_id: &str) -> bool {
        let cancelled = self.cancelled_request_ids.lock().unwrap();
        cancelled.contains(request_id)
    }

    /// 清除取消标记。冷加载期间被取消的请求从未注册连接，需要在返回时单独清理。
    pub(crate) fn clear_cancelled(&self, request_id: &str) {
        let mut cancelled = self.cancelled_request_ids.lock().unwrap();
        cancelled.remove(request_id);
    }

    /// 主动取消指定请求：强行关闭连接流并标记为已取消，促使 llama-server 立即停止当前 slot
    pub(crate) fn cancel_request(&self, request_id: &str) {
        {
            let mut cancelled = self.cancelled_request_ids.lock().unwrap();
            cancelled.insert(request_id.to_string());
        }
        let mut connections = self.active_connections.lock().unwrap();
        if let Some(stream) = connections.remove(request_id) {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }

    /// 应用退出或窗口销毁时终结所有在途通信与后台推理子进程
    pub(crate) fn terminate_all(&self) {
        {
            let mut connections = self.active_connections.lock().unwrap();
            for stream in connections.values() {
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
            connections.clear();
        }
        if let Ok(mut manager) = self.manager.lock() {
            manager.stop_runtime();
        }
        let pid = ACTIVE_LLAMA_PID.swap(0, Ordering::SeqCst);
        if pid > 0 {
            kill_process_by_pid(pid);
        }
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
    last_used_at: Instant,
    active_lora_task: Option<LocalAiTask>,
    has_lora_adapters: bool,
}

impl LocalAiRuntimeManager {
    /// 已加载的模型与目标不同，且仍在使用中（未空闲满 `LOCAL_AI_IDLE_TIMEOUT`）时返回 true。
    ///
    /// `last_used_at` 在请求开始与结束时都会刷新，单个请求最长 120s，远小于空闲阈值，
    /// 因此在途请求一定被视为“使用中”。调用方必须持有 manager 锁。
    pub(crate) fn is_other_model_hot(&self, model_id: &str) -> bool {
        self.process.as_ref().is_some_and(|process| {
            process.model_id != model_id && process.last_used_at.elapsed() < LOCAL_AI_IDLE_TIMEOUT
        })
    }

    pub(crate) fn ensure_ready(
        &mut self,
        app: &AppHandle,
        model: &LocalAiModelFile,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<LocalAiRuntimeEndpoint, String> {
        if let Some(endpoint) = self.reusable_endpoint(model)? {
            return Ok(endpoint);
        }

        self.stop_runtime_if_idle(LOCAL_AI_IDLE_TIMEOUT);
        self.stop_runtime();

        let port = pick_available_localhost_port()?;
        let sidecar_path = resolve_llama_server_path(app)?;
        let args = build_llama_server_args(model, port);
        let has_lora_adapters = args.iter().any(|arg| arg == "--lora");
        let mut command = Command::new(&sidecar_path);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(parent) = sidecar_path.parent() {
            command.current_dir(parent);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        apply_runtime_library_paths(&mut command, &sidecar_path);

        let mut child = command.spawn().map_err(|error| {
            format!(
                "本地推理 runtime 启动失败：{}（{}）",
                error,
                sidecar_path.display()
            )
        })?;

        ACTIVE_LLAMA_PID.store(child.id(), Ordering::SeqCst);

        let ready = wait_until_runtime_ready(&mut child, port, is_cancelled);
        if ready.is_err() {
            // 启动失败或被取消时子进程已被回收，不能留下指向它的 PID。
            ACTIVE_LLAMA_PID.store(0, Ordering::SeqCst);
        }
        ready?;

        self.process = Some(LocalAiRuntimeProcess {
            child,
            model_id: model.model_id.clone(),
            port,
            last_used_at: Instant::now(),
            active_lora_task: None,
            has_lora_adapters,
        });

        Ok(LocalAiRuntimeEndpoint { port })
    }

    fn reusable_endpoint(
        &mut self,
        model: &LocalAiModelFile,
    ) -> Result<Option<LocalAiRuntimeEndpoint>, String> {
        if self.process.as_ref().is_some_and(|process| {
            process.model_id == model.model_id
                && process.last_used_at.elapsed() >= LOCAL_AI_IDLE_TIMEOUT
        }) {
            self.stop_runtime();
            return Ok(None);
        }

        let Some(process) = self.process.as_mut() else {
            return Ok(None);
        };

        if process.model_id != model.model_id {
            return Ok(None);
        }

        match process.child.try_wait() {
            Ok(None) => {
                if health_check(process.port).is_ok() {
                    process.last_used_at = Instant::now();
                    Ok(Some(LocalAiRuntimeEndpoint { port: process.port }))
                } else {
                    Ok(None)
                }
            }
            Ok(Some(_)) => Ok(None),
            Err(error) => Err(format!("检查本地推理 runtime 状态失败：{error}")),
        }
    }

    pub(crate) fn stop_runtime(&mut self) {
        let Some(mut process) = self.process.take() else {
            return;
        };

        ACTIVE_LLAMA_PID.store(0, Ordering::SeqCst);
        let _ = process.child.kill();
        let _ = process.child.wait();
    }

    pub(crate) fn mark_used(&mut self) {
        if let Some(process) = self.process.as_mut() {
            process.last_used_at = Instant::now();
        }
    }

    pub(crate) fn stop_runtime_if_model(&mut self, model_id: &str) {
        if self
            .process
            .as_ref()
            .is_some_and(|process| process.model_id == model_id)
        {
            self.stop_runtime();
        }
    }

    pub(crate) fn activate_lora_adapter(
        &mut self,
        port: u16,
        task: Option<LocalAiTask>,
    ) -> Result<(), String> {
        let Some(process) = self.process.as_mut() else {
            return Ok(());
        };
        if process.port != port || !process.has_lora_adapters {
            return Ok(());
        }

        if process.active_lora_task == task {
            return Ok(());
        }

        let response = send_localhost_http_request(
            "GET",
            "/lora-adapters",
            port,
            None,
            Duration::from_secs(2),
        )?;

        #[derive(serde::Deserialize)]
        struct LoraAdapterInfo {
            id: u32,
            path: String,
            #[serde(default)]
            #[allow(dead_code)]
            scale: f32,
        }

        let adapters = serde_json::from_str::<Vec<LoraAdapterInfo>>(&response.body)
            .map_err(|error| format!("解析本地 LoRA 适配器列表失败：{error}"))?;

        if adapters.is_empty() {
            return Err("本地模型已加载 LoRA，但服务未返回适配器。".to_string());
        }

        let mut update_payload = Vec::new();
        for adapter in &adapters {
            // A base-only request must also clear any adapter enabled by a prior GEC.
            let scale = task.map_or(0.0, |task| task.adapter_scale(&adapter.path));
            update_payload.push(serde_json::json!({
                "id": adapter.id,
                "scale": scale,
            }));
        }

        let post_body = serde_json::to_string(&update_payload).map_err(|e| e.to_string())?;
        send_localhost_http_request(
            "POST",
            "/lora-adapters",
            port,
            Some(&post_body),
            Duration::from_secs(2),
        )?;

        // Cache only a successful switch; a failed update must be retried.
        process.active_lora_task = task;
        Ok(())
    }

    fn stop_runtime_if_idle(&mut self, max_idle: Duration) {
        let Some(process) = self.process.as_ref() else {
            return;
        };
        if process.last_used_at.elapsed() >= max_idle {
            self.stop_runtime();
        }
    }
}

impl Drop for LocalAiRuntimeManager {
    fn drop(&mut self) {
        self.stop_runtime();
    }
}

pub(crate) fn build_llama_server_args(model: &LocalAiModelFile, port: u16) -> Vec<String> {
    let mut args = vec![
        "--host".to_string(),
        LOCAL_AI_HOST.to_string(),
        "--port".to_string(),
        port.to_string(),
        "--model".to_string(),
        model.base_path.to_string_lossy().into_owned(),
        "--ctx-size".to_string(),
        model.context_size.to_string(),
        "--parallel".to_string(),
        "2".to_string(),
        "--alias".to_string(),
        model.model_id.clone(),
        "--offline".to_string(),
        "--no-webui".to_string(),
        "--jinja".to_string(),
        "--reasoning-budget".to_string(),
        "0".to_string(),
        "--n-gpu-layers".to_string(),
        "99".to_string(),
    ];

    let mut has_lora = false;
    if let Some(path) = &model.gec_adapter_path {
        if path.is_file() {
            args.push("--lora".to_string());
            args.push(path.to_string_lossy().into_owned());
            has_lora = true;
        }
    }
    if let Some(path) = &model.completion_adapter_path {
        if path.is_file() {
            args.push("--lora".to_string());
            args.push(path.to_string_lossy().into_owned());
            has_lora = true;
        }
    }
    if let Some(path) = &model.distill_adapter_path {
        if path.is_file() {
            args.push("--lora".to_string());
            args.push(path.to_string_lossy().into_owned());
            has_lora = true;
        }
    }

    if has_lora {
        args.push("--lora-init-without-apply".to_string());
    }

    args
}

pub(crate) fn post_chat_completion(
    port: u16,
    request: &Value,
    timeout: Duration,
    request_id: Option<&str>,
    state: Option<&LocalAiRuntimeState>,
    task: Option<LocalAiTask>,
) -> Result<String, String> {
    let body = serde_json::to_string(request)
        .map_err(|error| format!("序列化本地模型请求失败：{error}"))?;
    let response = send_localhost_http_request_cancellable(
        "POST",
        "/v1/chat/completions",
        port,
        Some(&body),
        timeout,
        CancellableRequestOptions {
            request_id,
            state,
            task,
        },
    )?;
    Ok(response.body)
}

pub(crate) fn post_raw_completion(
    port: u16,
    request: &Value,
    timeout: Duration,
    request_id: Option<&str>,
    state: Option<&LocalAiRuntimeState>,
    task: Option<LocalAiTask>,
) -> Result<String, String> {
    let body = serde_json::to_string(request)
        .map_err(|error| format!("序列化本地模型请求失败：{error}"))?;
    let response = send_localhost_http_request_cancellable(
        "POST",
        "/completion",
        port,
        Some(&body),
        timeout,
        CancellableRequestOptions {
            request_id,
            state,
            task,
        },
    )?;
    Ok(response.body)
}

pub(crate) fn schedule_idle_shutdown(manager: Arc<Mutex<LocalAiRuntimeManager>>) {
    thread::spawn(move || {
        thread::sleep(LOCAL_AI_IDLE_TIMEOUT);
        if let Ok(mut manager) = manager.lock() {
            manager.stop_runtime_if_idle(LOCAL_AI_IDLE_TIMEOUT);
        }
    });
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

/// 轮询等待 llama-server 就绪。每轮检查一次取消判定，被取消时 kill 并回收子进程，
/// 使持有 manager 锁的冷加载最多再阻塞一次轮询间隔加一次健康检查超时。
fn wait_until_runtime_ready(
    child: &mut Child,
    port: u16,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<(), String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(LOCAL_AI_CANCELLED_ERROR.to_string());
        }

        match child.try_wait() {
            Ok(None) => {}
            Ok(Some(status)) => {
                let mut stderr_detail = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let mut buf = Vec::new();
                    if stderr.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                        stderr_detail = String::from_utf8_lossy(&buf).trim().to_string();
                    }
                }
                let err_msg = if stderr_detail.is_empty() {
                    format!("本地推理 runtime 启动失败，进程已退出：{status}")
                } else {
                    format!("本地推理 runtime 启动失败，进程已退出：{status}。错误日志：{stderr_detail}")
                };
                eprintln!("[Local AI Runtime Error] {err_msg}");
                return Err(err_msg);
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

// Bundled macOS dylibs live beside the sidecar before signing (tauri.macos.conf.json).
// These environment paths support development and external runtimes; startup never writes
// into the installed app, and the signed sidecar resolves its own @loader_path dependencies.
fn apply_runtime_library_paths(command: &mut Command, sidecar_path: &Path) {
    let Some(parent) = sidecar_path.parent() else {
        return;
    };

    let mut library_dirs = vec![parent.to_path_buf()];
    let candidate_subdirs = [
        parent.join("llama-runtime-macos-arm64"),
        parent.join("binaries").join("llama-runtime-macos-arm64"),
        parent
            .join("..")
            .join("..")
            .join("binaries")
            .join("llama-runtime-macos-arm64"),
        parent
            .join("..")
            .join("..")
            .join("src-tauri")
            .join("binaries")
            .join("llama-runtime-macos-arm64"),
    ];
    for dir in candidate_subdirs {
        if dir.is_dir() {
            library_dirs.push(dir);
        }
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

#[derive(Default)]
struct CancellableRequestOptions<'a> {
    request_id: Option<&'a str>,
    state: Option<&'a LocalAiRuntimeState>,
    task: Option<LocalAiTask>,
}

fn send_localhost_http_request(
    method: &str,
    path: &str,
    port: u16,
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    send_localhost_http_request_cancellable(
        method,
        path,
        port,
        body,
        timeout,
        CancellableRequestOptions::default(),
    )
}

fn send_localhost_http_request_cancellable(
    method: &str,
    path: &str,
    port: u16,
    body: Option<&str>,
    timeout: Duration,
    options: CancellableRequestOptions<'_>,
) -> Result<HttpResponse, String> {
    let request_id = options.request_id;
    let state = options.state;
    let task = options.task;

    if let (Some(req_id), Some(st)) = (request_id, state) {
        if st.is_cancelled(req_id) {
            return Err("本地推理请求已取消。".to_string());
        }
    }

    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("连接本地推理服务失败：{error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("设置本地推理读取超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("设置本地推理写入超时失败：{error}"))?;

    let stream = Arc::new(stream);
    if let (Some(req_id), Some(st)) = (request_id, state) {
        st.register_connection(req_id.to_string(), task, Arc::clone(&stream));
    }

    struct ConnectionGuard<'a> {
        request_id: Option<&'a str>,
        state: Option<&'a LocalAiRuntimeState>,
    }
    impl<'a> Drop for ConnectionGuard<'a> {
        fn drop(&mut self) {
            if let (Some(req_id), Some(st)) = (self.request_id, self.state) {
                st.unregister_connection(req_id);
            }
        }
    }
    let _guard = ConnectionGuard { request_id, state };

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

    let mut stream_write = &*stream;
    stream_write
        .write_all(request.as_bytes())
        .map_err(|error| format!("发送本地模型请求失败：{error}"))?;

    let mut bytes = Vec::new();
    let mut stream_read = &*stream;
    let read_result = stream_read.read_to_end(&mut bytes);

    if let (Some(req_id), Some(st)) = (request_id, state) {
        if st.is_cancelled(req_id) {
            return Err("本地推理请求已取消。".to_string());
        }
    }

    read_result.map_err(|error| {
        if let (Some(req_id), Some(st)) = (request_id, state) {
            if st.is_cancelled(req_id) {
                return "本地推理请求已取消。".to_string();
            }
        }
        format!("读取本地模型响应失败：{error}")
    })?;

    parse_http_response(&bytes)
}

fn kill_process_by_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }
}

pub(crate) fn terminate_all_runtimes(state: &LocalAiRuntimeState) {
    state.terminate_all();
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
    fn style_analysis_never_enables_any_lora_adapter() {
        for path in [
            "lite-gec-lora.gguf",
            "completion.gguf",
            "style-analysis.gguf",
        ] {
            assert_eq!(LocalAiTask::StyleAnalysis.adapter_scale(path), 0.0);
        }
        assert!(!LocalAiTask::StyleAnalysis.may_log_content());
        assert!(LocalAiTask::Completion.may_log_content());
    }

    fn spawn_idle_child() -> Child {
        // 一个不会监听任何端口的长寿命子进程，模拟尚未就绪的 llama-server。
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "ping -n 30 127.0.0.1 >NUL"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    #[test]
    fn cancelling_a_cold_load_kills_the_child_promptly() {
        let mut child = spawn_idle_child();
        // 端口不绑定，健康检查的连接会被立即拒绝。
        let port = pick_available_localhost_port().unwrap();
        let state = LocalAiRuntimeState::default();
        state.cancel_request("learn-1");

        let started = Instant::now();
        let result = wait_until_runtime_ready(&mut child, port, &|| state.is_cancelled("learn-1"));

        assert_eq!(result, Err(LOCAL_AI_CANCELLED_ERROR.to_string()));
        assert!(started.elapsed() < Duration::from_millis(250));
        assert!(child.try_wait().unwrap().is_some(), "子进程应已被回收");
    }

    #[test]
    fn cancellation_during_polling_is_observed_within_one_interval() {
        let mut child = spawn_idle_child();
        let port = pick_available_localhost_port().unwrap();
        let state = LocalAiRuntimeState::default();
        let canceller = state.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            canceller.cancel_request("learn-2");
        });

        let started = Instant::now();
        let result = wait_until_runtime_ready(&mut child, port, &|| state.is_cancelled("learn-2"));

        assert_eq!(result, Err(LOCAL_AI_CANCELLED_ERROR.to_string()));
        // 300ms 后取消，最多再等一个轮询间隔（连接被拒，健康检查立即失败）。
        assert!(started.elapsed() < Duration::from_millis(300) + HEALTH_CHECK_INTERVAL * 2);
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn clear_cancelled_removes_ids_left_by_cold_load_cancellation() {
        let state = LocalAiRuntimeState::default();
        state.cancel_request("learn-3");
        assert!(state.is_cancelled("learn-3"));
        state.clear_cancelled("learn-3");
        assert!(!state.is_cancelled("learn-3"));
    }

    #[test]
    fn reports_other_model_hot_only_while_it_is_in_use() {
        let child = spawn_idle_child();
        let mut runtime = LocalAiRuntimeManager {
            process: Some(LocalAiRuntimeProcess {
                child,
                model_id: "lite".to_string(),
                port: 0,
                last_used_at: Instant::now(),
                active_lora_task: None,
                has_lora_adapters: false,
            }),
        };
        assert!(runtime.is_other_model_hot("standard"));
        assert!(!runtime.is_other_model_hot("lite"));

        runtime.process.as_mut().unwrap().last_used_at = Instant::now()
            .checked_sub(LOCAL_AI_IDLE_TIMEOUT + Duration::from_secs(1))
            .unwrap();
        assert!(!runtime.is_other_model_hot("standard"));

        runtime.stop_runtime();
        assert!(!runtime.is_other_model_hot("standard"));
    }

    #[test]
    fn lite_uses_gec_adapter_only_for_gec() {
        let path = "lite-gec-qwen3-0.6b-v1.4.0-lora-f16.gguf";
        for (name, scale) in [("gec", 1.0), ("completion", 0.0), ("distill", 0.0)] {
            let task: LocalAiTask = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(task.adapter_scale(path), scale);
        }
    }

    #[test]
    fn switches_lora_scales_and_retries_failed_updates() {
        use std::io::{BufRead, BufReader};

        let listener = TcpListener::bind((LOCAL_AI_HOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut scales = Vec::new();
            for status in [200, 500, 200, 200, 200] {
                for method in ["GET", "POST"] {
                    let mut stream = loop {
                        match listener.accept() {
                            Ok((stream, _)) => break stream,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                assert!(Instant::now() < deadline, "missing adapter request");
                                thread::sleep(Duration::from_millis(5));
                            }
                            Err(error) => panic!("{error}"),
                        }
                    };
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut reader = BufReader::new(&stream);
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert!(line.starts_with(&format!("{method} /lora-adapters ")));
                    let mut content_length = 0;
                    loop {
                        line.clear();
                        assert!(reader.read_line(&mut line).unwrap() > 0);
                        if line == "\r\n" {
                            break;
                        }
                        if let Some((name, value)) = line.split_once(':') {
                            if name.eq_ignore_ascii_case("content-length") {
                                content_length = value.trim().parse::<usize>().unwrap();
                            }
                        }
                    }
                    let (code, body) = if method == "GET" {
                        (
                            200,
                            r#"[{"id":0,"path":"lite-gec-lora-f16.gguf","scale":0}]"#,
                        )
                    } else {
                        let mut body = vec![0; content_length];
                        reader.read_exact(&mut body).unwrap();
                        let update: Value = serde_json::from_slice(&body).unwrap();
                        scales.push(update[0]["scale"].as_f64().unwrap());
                        (status, "[]")
                    };
                    drop(reader);
                    write!(stream, "HTTP/1.1 {code} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
            }
            scales
        });

        // A short-lived test binary supplies the process handle; no model is started.
        let child = Command::new(env::current_exe().unwrap())
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut runtime = LocalAiRuntimeManager {
            process: Some(LocalAiRuntimeProcess {
                child,
                model_id: "lite".to_string(),
                port,
                last_used_at: Instant::now(),
                active_lora_task: None,
                has_lora_adapters: true,
            }),
        };
        runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Gec))
            .unwrap();
        assert!(runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Completion))
            .is_err());
        assert_eq!(
            runtime.process.as_ref().unwrap().active_lora_task,
            Some(LocalAiTask::Gec)
        );
        runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Completion))
            .unwrap();
        // Reusing the successful task should not issue another HTTP update.
        runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Completion))
            .unwrap();
        runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Distill))
            .unwrap();
        runtime.activate_lora_adapter(port, None).unwrap();
        assert_eq!(runtime.process.as_ref().unwrap().active_lora_task, None);
        assert_eq!(server.join().unwrap(), vec![1.0, 0.0, 0.0, 0.0, 0.0]);
        // Standard has no adapters and should not contact the adapter endpoint.
        runtime.process.as_mut().unwrap().has_lora_adapters = false;
        runtime
            .activate_lora_adapter(port, Some(LocalAiTask::Gec))
            .unwrap();
    }

    #[test]
    fn builds_llama_server_args_with_localhost_and_model_path() {
        let model = LocalAiModelFile {
            model_id: "md-editor-writer-small-v1".to_string(),
            display_name: "Writer Small".to_string(),
            version: "2026.06.25".to_string(),
            base_path: PathBuf::from("/tmp/model.gguf"),
            gec_adapter_path: None,
            completion_adapter_path: None,
            distill_adapter_path: None,
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
        assert!(args.iter().any(|arg| arg == "--jinja"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--reasoning-budget", "0"]));
        assert!(args.windows(2).any(|pair| pair == ["--n-gpu-layers", "99"]));
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

    #[test]
    fn preempts_and_cancels_in_flight_request_of_same_task() {
        let state = LocalAiRuntimeState::default();
        let listener = TcpListener::bind((LOCAL_AI_HOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let stream1 = TcpStream::connect((LOCAL_AI_HOST, port)).unwrap();
        state.register_connection(
            "req-1".to_string(),
            Some(LocalAiTask::Completion),
            Arc::new(stream1),
        );
        assert!(!state.is_cancelled("req-1"));

        // 模拟打字过程中发起同任务的更新请求：应自动抢占旧任务
        let stream2 = TcpStream::connect((LOCAL_AI_HOST, port)).unwrap();
        state.register_connection(
            "req-2".to_string(),
            Some(LocalAiTask::Completion),
            Arc::new(stream2),
        );

        assert!(state.is_cancelled("req-1"));
        assert!(!state.is_cancelled("req-2"));

        // 显式主动取消请求
        state.cancel_request("req-2");
        assert!(state.is_cancelled("req-2"));
    }

    #[test]
    fn terminate_all_cleans_up_without_panic() {
        let state = LocalAiRuntimeState::default();
        terminate_all_runtimes(&state);
    }
}
