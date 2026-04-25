use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

use crate::sidecar::{ensure, SidecarState};
use crate::tray::{self, ActiveConnection, TrayState};

#[derive(Debug, Deserialize)]
#[serde(tag = "authType")]
pub enum ConnectionConfig {
    #[serde(rename = "basic", rename_all = "camelCase")]
    Basic {
        host: String,
        port: u16,
        service_name: String,
        username: String,
        password: String,
    },
    #[serde(rename = "wallet", rename_all = "camelCase")]
    Wallet {
        wallet_dir: String,
        wallet_password: String,
        connect_alias: String,
        username: String,
        password: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestOk {
    pub server_version: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestErr {
    pub code: i32,
    pub message: String,
}

fn config_to_params(config: ConnectionConfig) -> Value {
    use crate::persistence::connection_config::{basic_params, wallet_params};
    use std::path::Path;
    match config {
        ConnectionConfig::Basic {
            host,
            port,
            service_name,
            username,
            password,
        } => basic_params(&host, port, &service_name, &username, &password),
        ConnectionConfig::Wallet {
            wallet_dir,
            wallet_password,
            connect_alias,
            username,
            password,
        } => wallet_params(
            Path::new(&wallet_dir),
            &wallet_password,
            &connect_alias,
            &username,
            &password,
        ),
    }
}

#[tauri::command]
pub async fn connection_test(
    app: AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionTestOk, ConnectionTestErr> {
    if let Err(err) = ensure(&app).await {
        return Err(ConnectionTestErr {
            code: -32003,
            message: err,
        });
    }

    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");

    let params = config_to_params(config);
    let result = sidecar
        .call("connection.test", params)
        .await
        .map_err(|err| ConnectionTestErr {
            code: err.code,
            message: err.message,
        })?;

    let server_version = result
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("Oracle (unknown)")
        .to_string();
    let elapsed_ms = result
        .get("elapsedMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Ok(ConnectionTestOk {
        server_version,
        elapsed_ms,
    })
}

use crate::persistence::connections::{
    ConnectionError, ConnectionFull, ConnectionInput, ConnectionMeta, ConnectionService, WalletInfo,
};
use crate::persistence::history::{HistoryEntry, HistorySaveInput};

/// Returns the canonicalized path if `path` (as supplied by the renderer) resolves to a
/// location under one of the user-data scopes ($DOCUMENT, $DESKTOP, $DOWNLOAD, $HOME,
/// app data dir, app config dir). Anything else is rejected to prevent a compromised
/// renderer from feeding arbitrary system paths to a #[tauri::command] handler that
/// bypasses the renderer-side `fs:scope` capability allow-list.
fn validate_user_path(app: &AppHandle, path: &str) -> Result<PathBuf, ConnectionError> {
    let p = Path::new(path);
    let canon = p
        .canonicalize()
        .map_err(|_| ConnectionError::invalid("file not accessible"))?;
    let candidates = [
        app.path().document_dir().ok(),
        app.path().desktop_dir().ok(),
        app.path().download_dir().ok(),
        app.path().home_dir().ok(),
        app.path().app_data_dir().ok(),
        app.path().app_config_dir().ok(),
    ];
    for root in candidates.iter().flatten() {
        if let Ok(canon_root) = root.canonicalize() {
            if canon.starts_with(&canon_root) {
                return Ok(canon);
            }
        }
    }
    Err(ConnectionError::invalid(
        "path outside allowed user folders (Documents, Desktop, Downloads, Home)",
    ))
}

#[tauri::command]
pub async fn connection_list(app: AppHandle) -> Result<Vec<ConnectionMeta>, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.list()
}

#[tauri::command]
pub async fn connection_get(app: AppHandle, id: String) -> Result<ConnectionFull, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.get(&id)
}

#[tauri::command]
pub async fn connection_save(
    app: AppHandle,
    mut input: ConnectionInput,
) -> Result<ConnectionMeta, ConnectionError> {
    // If a wallet zip path is being supplied, validate it lives under an allowed
    // user folder before the persistence layer touches it.
    if let ConnectionInput::Wallet { wallet_zip_path: Some(ref mut path), .. } = input {
        let canon = validate_user_path(&app, path)?;
        *path = canon.to_string_lossy().into_owned();
    }
    let svc = app.state::<ConnectionService>();
    svc.save(input)
}

#[tauri::command]
pub async fn connection_delete(app: AppHandle, id: String) -> Result<(), ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.delete(&id)
}

#[tauri::command]
pub async fn wallet_inspect(
    app: AppHandle,
    zip_path: String,
) -> Result<WalletInfo, ConnectionError> {
    let canon = validate_user_path(&app, &zip_path)?;
    let svc = app.state::<ConnectionService>();
    svc.inspect_wallet(&canon.to_string_lossy())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub server_version: String,
    pub current_schema: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRow {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRef {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_pk: bool,
    pub data_default: Option<String>,
    pub comments: Option<String>,
    #[serde(default)]
    pub is_vector: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDef {
    pub name: String,
    pub is_unique: bool,
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetails {
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<IndexDef>,
    pub row_count: Option<i64>,
}

async fn call_sidecar(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, ConnectionTestErr> {
    if let Err(err) = ensure(app).await {
        return Err(ConnectionTestErr {
            code: -32003,
            message: err,
        });
    }
    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");
    sidecar
        .call(method, params)
        .await
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

fn map_err(e: ConnectionError) -> ConnectionTestErr {
    ConnectionTestErr {
        code: e.code,
        message: e.message,
    }
}

#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    connection_id: String,
) -> Result<WorkspaceInfo, ConnectionTestErr> {
    let (params, conn_name) = {
        let svc = app.state::<ConnectionService>();
        let params = svc.sidecar_params(&connection_id).map_err(map_err)?;
        let name = svc
            .get(&connection_id)
            .ok()
            .map(|f| match f.meta {
                crate::persistence::connections::ConnectionMeta::Basic { name, .. } => name,
                crate::persistence::connections::ConnectionMeta::Wallet { name, .. } => name,
            })
            .unwrap_or_else(|| connection_id.clone());
        (params, name)
    };

    tray::update_tray(&app, TrayState::Connecting).await;

    let res = match call_sidecar(&app, "workspace.open", params).await {
        Ok(v) => v,
        Err(e) => {
            tray::update_tray(&app, TrayState::Error).await;
            return Err(e);
        }
    };

    *app.state::<ActiveConnection>().0.lock().await = Some(conn_name);
    tray::update_tray(&app, TrayState::Connected).await;

    let server_version = res
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let current_schema = res
        .get("currentSchema")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(WorkspaceInfo {
        server_version,
        current_schema,
    })
}

#[tauri::command]
pub async fn workspace_close(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "workspace.close", json!({})).await?;
    *app.state::<ActiveConnection>().0.lock().await = None;
    tray::update_tray(&app, TrayState::Idle).await;
    Ok(())
}

#[tauri::command]
pub async fn schema_list(app: AppHandle) -> Result<Vec<SchemaRow>, ConnectionTestErr> {
    let res = call_sidecar(&app, "schema.list", json!({})).await?;
    let arr = res
        .get("schemas")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| {
            Some(SchemaRow {
                name: v.get("name")?.as_str()?.to_string(),
                is_current: v.get("isCurrent")?.as_bool().unwrap_or(false),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn objects_list(
    app: AppHandle,
    owner: String,
    kind: String,
) -> Result<Vec<ObjectRef>, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "objects.list",
        json!({ "owner": owner, "type": kind }),
    )
    .await?;
    let arr = res
        .get("objects")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| {
            Some(ObjectRef {
                name: v.get("name")?.as_str()?.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn table_describe(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<TableDetails, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "table.describe",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode table.describe: {e}"),
    })
}

#[tauri::command]
pub async fn table_count_rows(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "table.count_rows",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn table_related(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "table.related",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn query_execute(
    app: AppHandle,
    sql: String,
    request_id: String,
    split_multi: Option<bool>,
) -> Result<Value, ConnectionTestErr> {
    let started = std::time::Instant::now();
    let result = call_sidecar(
        &app,
        "query.execute",
        json!({ "sql": sql, "requestId": request_id, "splitMulti": split_multi.unwrap_or(false) }),
    )
    .await;
    let elapsed_ms = started.elapsed().as_millis() as i64;

    // Authoritative audit write: happens here, server-side, regardless of whether
    // the renderer remembers to call history_save afterwards. A compromised renderer
    // can no longer skip audit just by not calling history_save.
    if let Ok(data_dir) = app.path().app_data_dir() {
        let active_name = app
            .state::<ActiveConnection>()
            .0
            .lock()
            .await
            .clone()
            .unwrap_or_default();
        let (conn_id, host, username) = lookup_active_connection_meta(&app, &active_name);
        let (success, error_message) = match &result {
            Ok(v) => {
                let multi_failed = v
                    .get("results")
                    .and_then(|rs| rs.as_array())
                    .map(|arr| {
                        arr.iter()
                            .any(|r| r.get("status").and_then(|s| s.as_str()) == Some("error"))
                    })
                    .unwrap_or(false);
                (!multi_failed, None)
            }
            Err(e) => (false, Some(e.message.clone())),
        };
        let synthetic_input = HistorySaveInput {
            connection_id: conn_id,
            sql: sql.clone(),
            success,
            row_count: None,
            elapsed_ms,
            error_code: None,
            error_message,
            username: Some(username),
            host: Some(host),
        };
        write_audit_entry(&data_dir, &synthetic_input);
    }

    result
}

/// Best-effort lookup of (connection_id, host, username) for the currently
/// active connection name. Returns empty strings if not found — the audit
/// row is still written with whatever metadata is known.
fn lookup_active_connection_meta(app: &AppHandle, active_name: &str) -> (String, String, String) {
    if active_name.is_empty() {
        return (String::new(), String::new(), String::new());
    }
    let svc = app.state::<ConnectionService>();
    let metas = match svc.list() {
        Ok(m) => m,
        Err(_) => return (String::new(), String::new(), String::new()),
    };
    use crate::persistence::connections::ConnectionMeta;
    for meta in metas {
        match meta {
            ConnectionMeta::Basic {
                id,
                name,
                host,
                username,
                ..
            } if name == active_name => {
                return (id, host, username);
            }
            ConnectionMeta::Wallet {
                id,
                name,
                connect_alias,
                username,
                ..
            } if name == active_name => {
                return (id, connect_alias, username);
            }
            _ => continue,
        }
    }
    (String::new(), String::new(), String::new())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryCancelResult {
    pub cancelled: bool,
    pub request_id: Option<String>,
}

#[tauri::command]
pub async fn query_cancel(
    app: AppHandle,
    request_id: String,
) -> Result<QueryCancelResult, ConnectionTestErr> {
    let res = call_sidecar(&app, "query.cancel", json!({ "requestId": request_id })).await?;
    let cancelled = res
        .get("cancelled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let returned_id = res
        .get("requestId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(QueryCancelResult {
        cancelled,
        request_id: returned_id,
    })
}

#[tauri::command]
pub async fn history_list(
    app: AppHandle,
    connection_id: String,
    limit: i64,
    offset: i64,
    search: Option<String>,
) -> Result<Vec<HistoryEntry>, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.history_list(&connection_id, limit, offset, search.as_deref())
}

fn write_audit_entry(app_data_dir: &std::path::Path, input: &HistorySaveInput) {
    let audit_dir = app_data_dir.join("audit");
    if std::fs::create_dir_all(&audit_dir).is_err() {
        return;
    }
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = audit_dir.join(format!("{date}.jsonl"));
    let entry = serde_json::json!({
        "ts":           now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "connectionId": input.connection_id,
        "host":         input.host.as_deref().unwrap_or(""),
        "username":     input.username.as_deref().unwrap_or(""),
        "sql":          input.sql,
        "success":      input.success,
        "rowCount":     input.row_count,
        "elapsedMs":    input.elapsed_ms,
    });
    let mut line = entry.to_string();
    line.push('\n');
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[tauri::command]
pub async fn history_save(app: AppHandle, input: HistorySaveInput) -> Result<i64, ConnectionError> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        write_audit_entry(&data_dir, &input);
    }
    let svc = app.state::<ConnectionService>();
    svc.history_save(input)
}

#[tauri::command]
pub async fn history_clear(
    app: AppHandle,
    connection_id: String,
) -> Result<usize, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.history_clear(&connection_id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRefWithStatus {
    pub name: String,
    pub status: String,
}

#[tauri::command]
pub async fn objects_list_plsql(
    app: AppHandle,
    owner: String,
    kind: String,
) -> Result<Vec<ObjectRefWithStatus>, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "objects.list.plsql",
        json!({ "owner": owner, "kind": kind }),
    )
    .await?;
    let arr = res
        .get("objects")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let objects = arr
        .into_iter()
        .filter_map(|v| {
            Some(ObjectRefWithStatus {
                name: v.get("name")?.as_str()?.to_string(),
                status: v.get("status")?.as_str()?.to_string(),
            })
        })
        .collect();
    Ok(objects)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileErrorRow {
    pub line: i64,
    pub position: i64,
    pub text: String,
}

#[tauri::command]
pub async fn compile_errors_get(
    app: AppHandle,
    object_type: String,
    object_name: String,
) -> Result<Vec<CompileErrorRow>, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "compile.errors",
        json!({ "objectType": object_type, "objectName": object_name }),
    )
    .await?;
    let arr = res
        .get("errors")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let errors = arr
        .into_iter()
        .filter_map(|v| {
            Some(CompileErrorRow {
                line: v.get("line")?.as_i64()?,
                position: v.get("position")?.as_i64()?,
                text: v.get("text")?.as_str()?.to_string(),
            })
        })
        .collect();
    Ok(errors)
}

#[tauri::command]
pub async fn object_ddl_get(
    app: AppHandle,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<String, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "object.ddl",
        json!({ "owner": owner, "objectType": object_type, "objectName": object_name }),
    )
    .await?;
    let ddl = res
        .get("ddl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(ddl)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowNode {
    pub owner: String,
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowTriggerInfo {
    pub name: String,
    pub trigger_type: String,
    pub event: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowResult {
    pub upstream: Vec<DataFlowNode>,
    pub downstream: Vec<DataFlowNode>,
    pub fk_parents: Vec<DataFlowNode>,
    pub fk_children: Vec<DataFlowNode>,
    pub triggers: Vec<DataFlowTriggerInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultRow {
    pub owner: String,
    pub name: String,
    pub object_type: String,
}

#[tauri::command]
pub async fn objects_search(
    app: AppHandle,
    query: String,
) -> Result<Vec<SearchResultRow>, ConnectionTestErr> {
    let res = call_sidecar(&app, "objects.search", json!({ "query": query })).await?;
    let arr = res
        .get("objects")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| {
            Some(SearchResultRow {
                owner: v.get("owner")?.as_str()?.to_string(),
                name: v.get("name")?.as_str()?.to_string(),
                object_type: v.get("type")?.as_str()?.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn schema_kind_counts(app: AppHandle, owner: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "schema.kind_counts", json!({ "owner": owner })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn ai_chat(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "ai.chat", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn ai_suggest_endpoint(
    app: AppHandle,
    params: Value,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "ai.suggest_endpoint", params).await?;
    Ok(res)
}

#[tauri::command]
pub async fn vector_index_create(
    app: AppHandle,
    payload: Value,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "vector.create_index", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn vector_index_drop(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "vector.drop_index", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn embed_count_pending(
    app: AppHandle,
    payload: Value,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "embed.count_pending", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn embed_batch(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "embed.batch", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn ai_key_save(service: String, key: String) -> Result<(), String> {
    crate::persistence::secrets::set_api_key(&service, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_key_get(service: String) -> Result<Option<String>, String> {
    crate::persistence::secrets::get_api_key(&service).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn connection_commit(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "connection.commit", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn connection_rollback(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "connection.rollback", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn vector_search(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "vector.search", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn vector_tables_in_schema(
    app: AppHandle,
    owner: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "vector.tables_in_schema", json!({ "owner": owner })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn vector_index_list(
    app: AppHandle,
    owner: String,
    table_name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "vector.index_list",
        json!({ "owner": owner, "tableName": table_name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn object_dataflow_get(
    app: AppHandle,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<DataFlowResult, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "object.dataflow",
        json!({ "owner": owner, "objectType": object_type, "objectName": object_name }),
    )
    .await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode object.dataflow: {e}"),
    })
}

#[tauri::command]
pub async fn explain_plan_get(app: AppHandle, sql: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "explain.plan", json!({ "sql": sql })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn proc_describe(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "proc.describe",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn proc_execute(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "proc.execute", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn chart_configure(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "chart.configure", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn chart_reset(app: AppHandle, session_id: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "chart.reset", json!({ "sessionId": session_id })).await?;
    Ok(res)
}

// ── PL/SQL Debugger ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn debug_open(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.open", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_source(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_source", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_start(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.start", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_stop(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.stop", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_into(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_into", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_over(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_over", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_out(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_out", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_continue(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.continue", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_set_breakpoint(
    app: AppHandle,
    payload: Value,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.set_breakpoint", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_remove_breakpoint(
    app: AppHandle,
    payload: Value,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.remove_breakpoint", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_values(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_values", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_call_stack(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_call_stack", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_run(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.run", payload).await?;
    Ok(res)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OrdsDetectResult {
    pub installed: bool,
    #[serde(rename = "userHasAccess", default)]
    pub user_has_access: bool,
    pub version: Option<String>,
    #[serde(rename = "currentSchemaEnabled")]
    pub current_schema_enabled: bool,
    #[serde(rename = "hasAdminRole")]
    pub has_admin_role: bool,
    #[serde(rename = "ordsBaseUrl")]
    pub ords_base_url: Option<String>,
}

#[tauri::command]
pub async fn ords_detect(app: AppHandle) -> Result<OrdsDetectResult, ConnectionTestErr> {
    let res = call_sidecar(&app, "ords.detect", json!({})).await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("ords_detect parse error: {}", e),
    })
}

#[tauri::command]
pub async fn ords_modules_list(
    app: AppHandle,
    owner: String,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.modules.list", json!({ "owner": owner })).await
}

#[tauri::command]
pub async fn ords_module_get(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "ords.module.get",
        json!({ "owner": owner, "name": name }),
    )
    .await
}

#[tauri::command]
pub async fn ords_enable_schema(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "ords.enable_schema", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn ords_module_export_sql(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "ords.module.export_sql",
        json!({ "owner": owner, "name": name }),
    )
    .await
}

#[tauri::command]
pub async fn ords_roles_list(app: AppHandle) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.roles.list", json!({})).await
}

#[tauri::command]
pub async fn ords_generate_sql(
    app: AppHandle,
    config: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.generate_sql", config).await
}

#[tauri::command]
pub async fn ords_apply(
    app: AppHandle,
    config: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    // Server regenerates SQL from config and executes — closes the
    // privilege-escalation hole where the renderer could submit arbitrary PL/SQL.
    call_sidecar(&app, "ords.apply", config).await
}

use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdsTestResult {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub elapsed_ms: u64,
}

/// Headers the renderer is permitted to set on outbound ORDS test requests.
/// Anything else is silently dropped to prevent a compromised renderer from
/// using this command as a generic HTTP exfil tool with attacker-controlled
/// auth/cookies.
const ORDS_TEST_ALLOWED_HEADERS: &[&str] = &[
    "accept",
    "accept-language",
    "authorization",
    "content-type",
    "x-requested-with",
];

#[tauri::command]
pub async fn ords_test_http(
    app: AppHandle,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<OrdsTestResult, ConnectionTestErr> {
    // Authoritative base URL comes from the sidecar (which derives it from the
    // currently-open Oracle session via ORDS metadata) — NOT from the renderer.
    // Closes a renderer-controlled-exfil hole where a compromised UI could pass
    // any allowed_base_url it wanted.
    let detect = call_sidecar(&app, "ords.detect", json!({})).await?;
    let detected_base = detect
        .get("ordsBaseUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ConnectionTestErr {
            code: -32603,
            message: "ORDS base URL not detected for the current connection".to_string(),
        })?;

    let url_obj = reqwest::Url::parse(&url).map_err(|_| ConnectionTestErr {
        code: -32602,
        message: "URL is not a valid absolute HTTPS/HTTP URL".to_string(),
    })?;
    let scheme = url_obj.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(ConnectionTestErr {
            code: -32602,
            message: "Only http/https URLs are allowed".to_string(),
        });
    }
    if !url.starts_with(&detected_base) {
        return Err(ConnectionTestErr {
            code: -32603,
            message: format!(
                "URL not under detected ORDS base ({}). Compromised renderer or stale config.",
                detected_base
            ),
        });
    }

    let start = std::time::Instant::now();
    // Cert verification ON (no .danger_accept_invalid_certs).  Self-signed dev ORDS
    // installs need a proper trust store entry; we don't open the door for MITM.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| ConnectionTestErr {
            code: -32603,
            message: format!("HTTP client error: {}", e),
        })?;

    let req_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => {
            return Err(ConnectionTestErr {
                code: -32602,
                message: format!("Method not supported: {}", method),
            })
        }
    };

    let mut req = client.request(req_method, &url);
    for (k, v) in &headers {
        let name = k.to_ascii_lowercase();
        if !name.is_empty() && ORDS_TEST_ALLOWED_HEADERS.contains(&name.as_str()) {
            req = req.header(k, v);
        }
        // Silently drop disallowed headers — renderer should never have been able
        // to set Cookie, Host, X-Forwarded-*, etc. on an outbound HTTP request.
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("Request failed: {}", e),
    })?;
    let status = resp.status().as_u16();
    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.unwrap_or_default();
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(OrdsTestResult {
        status,
        headers: resp_headers,
        body,
        elapsed_ms,
    })
}

#[tauri::command]
pub async fn ords_clients_list(app: AppHandle) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.clients.list", json!({})).await
}

#[tauri::command]
pub async fn ords_clients_create(
    app: AppHandle,
    name: String,
    description: String,
    roles: Vec<String>,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "ords.clients.create",
        json!({ "name": name, "description": description, "roles": roles }),
    )
    .await
}

#[tauri::command]
pub async fn ords_clients_revoke(app: AppHandle, name: String) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "ords.clients.revoke", json!({ "name": name })).await?;
    Ok(())
}
