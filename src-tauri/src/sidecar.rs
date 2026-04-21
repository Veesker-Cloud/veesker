use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

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
    #[serde(default)]
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
        let (mut rx, child) = app
            .shell()
            .sidecar("veesker-sidecar")
            .map_err(|e| format!("sidecar binary not found: {e}"))?
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

        // Demux stdout into pending oneshots
        let pending_clone = pending.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            for line in text.lines() {
                                if line.trim().is_empty() {
                                    continue;
                                }
                                match serde_json::from_str::<Response>(line) {
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
                    }
                    CommandEvent::Stderr(bytes) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            eprintln!("[sidecar] {}", text.trim_end());
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!("sidecar terminated: {:?}", payload);
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

        let resp = rx.await.map_err(|_| RpcError {
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
