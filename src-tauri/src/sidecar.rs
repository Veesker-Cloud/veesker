use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

/// Locate the directory containing oracledb's native `.node` binding for the current
/// platform. Tries (in order): explicit env var, dev-mode node_modules path, bundled
/// resources next to the sidecar binary. Returns None if nothing is found — the sidecar
/// will then run in Thin mode.
fn resolve_oracledb_binding_dir(app: &AppHandle) -> Option<String> {
    if let Ok(explicit) = std::env::var("VEESKER_ORACLEDB_BINARY_DIR") {
        if PathBuf::from(&explicit).is_dir() {
            return Some(explicit);
        }
    }
    // Dev mode: walk up from CARGO_MANIFEST_DIR (set when running cargo) to find the repo's
    // sidecar/node_modules/oracledb/build/Release directory.
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        let dev = PathBuf::from(manifest)
            .join("..")
            .join("sidecar")
            .join("node_modules")
            .join("oracledb")
            .join("build")
            .join("Release");
        if dev.is_dir() {
            return dev.canonicalize().ok().map(strip_extended_prefix);
        }
    }
    // Production: look for `oracledb-bindings/` in resource_dir alongside the bundled app.
    if let Ok(res_dir) = app.path().resource_dir() {
        let prod = res_dir.join("oracledb-bindings");
        if prod.is_dir() {
            return prod.canonicalize().ok().map(strip_extended_prefix);
        }
    }
    None
}

/// On Windows, std::fs::canonicalize returns paths with the `\\?\` extended-length prefix.
/// Node.js's require() and oracledb's binary loader can't handle that format and fail
/// silently with NJS-045. Strip the prefix so we pass plain `C:\foo\bar` style paths.
fn strip_extended_prefix(p: PathBuf) -> String {
    let s = p.to_string_lossy().into_owned();
    s.strip_prefix(r"\\?\").map(String::from).unwrap_or(s)
}

#[derive(Debug, Serialize)]
struct Request<'a> {
    jsonrpc: &'a str,
    id: String,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
pub struct Response {
    pub id: String,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    // Per JSON-RPC 2.0: optional Primitive/Structured error metadata. Not currently
    // surfaced to the renderer but kept for protocol completeness and future telemetry.
    #[serde(default)]
    #[allow(dead_code)]
    pub data: Option<Value>,
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Response>>>>;

pub struct Sidecar {
    stdin_tx: mpsc::Sender<String>,
    pending: Pending,
    _child: Arc<Mutex<CommandChild>>,
}

impl Sidecar {
    pub fn spawn(app: &AppHandle) -> Result<Self, String> {
        // Tell the sidecar where the node-oracledb native binding (.node) lives. Bun's
        // --compile cannot bundle the .node file (oracledb uses a dynamic require path
        // the bundler can't trace), so we ship the file alongside the binary and pass
        // its directory via env var. The sidecar passes this to oracledb.initOracleClient
        // as `binaryDir`. Without this, Thick mode fails with NJS-045 at runtime.
        let mut cmd = app
            .shell()
            .sidecar("veesker-sidecar")
            .map_err(|e| format!("sidecar binary not found: {e}"))?;

        if let Some(dir) = resolve_oracledb_binding_dir(app) {
            cmd = cmd.env("VEESKER_ORACLEDB_BINARY_DIR", dir);
        }

        let (mut rx, child) = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
        let child = Arc::new(Mutex::new(child));

        // Forward stdin writes
        let stdin_writer = child.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                let mut guard = stdin_writer.lock().await;
                if let Err(err) = guard.write(line.as_bytes()) {
                    eprintln!("sidecar stdin write failed: {err}");
                    break;
                }
            }
        });

        // Demux stdout into pending oneshots. Stdout chunks may split a JSON line
        // across events, so accumulate in a buffer and only consume complete lines.
        let pending_clone = pending.clone();
        tauri::async_runtime::spawn(async move {
            let mut buffer = String::new();
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(idx) = buffer.find('\n') {
                            let line = buffer[..idx].trim().to_string();
                            buffer.drain(..=idx);
                            if line.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Response>(&line) {
                                Ok(resp) => {
                                    let mut map = pending_clone.lock().await;
                                    if let Some(tx) = map.remove(&resp.id) {
                                        let _ = tx.send(resp);
                                    }
                                }
                                Err(err) => {
                                    eprintln!("sidecar bad json: {err} line={line}");
                                }
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            eprintln!("[sidecar] {}", text.trim_end());
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!("sidecar terminated: {:?}", payload);
                        // Wake any in-flight callers — dropping their senders
                        // resolves rx.await to RecvError, which call() maps to -32002.
                        pending_clone.lock().await.clear();
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            stdin_tx,
            pending,
            _child: child,
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = Uuid::new_v4().to_string();
        let req = Request {
            jsonrpc: "2.0",
            id: id.clone(),
            method,
            params,
        };
        let mut line = serde_json::to_string(&req).expect("serialize request");
        line.push('\n');

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.clone(), tx);
        }

        if let Err(err) = self.stdin_tx.send(line).await {
            self.pending.lock().await.remove(&id);
            return Err(RpcError {
                code: -32001,
                message: format!("sidecar stdin closed: {err}"),
                data: None,
            });
        }

        let resp = tokio::time::timeout(std::time::Duration::from_secs(120), rx)
            .await
            .map_err(|_| RpcError {
                code: -32002,
                message: "sidecar RPC timed out after 120s".into(),
                data: None,
            })?
            .map_err(|_| RpcError {
                code: -32002,
                message: "sidecar dropped response channel".into(),
                data: None,
            })?;

        if let Some(err) = resp.error {
            return Err(err);
        }
        Ok(resp.result.unwrap_or(Value::Null))
    }
}

pub struct SidecarState(pub Mutex<Option<Sidecar>>);

pub async fn ensure(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().await;
    if guard.is_none() {
        *guard = Some(Sidecar::spawn(app)?);
    }
    Ok(())
}

/// Public helper so tray and other non-command modules can call the sidecar.
pub async fn call_raw(
    app: &AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, RpcError> {
    ensure(app).await.map_err(|msg| RpcError {
        code: -32003,
        message: msg,
        data: None,
    })?;
    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .expect("sidecar ensured")
        .call(method, params)
        .await
}
