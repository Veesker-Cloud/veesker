// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::sidecar::acquire;
use crate::tray::{self, ActiveConnection, TrayState};

pub struct ActiveSessionEnv(pub tokio::sync::Mutex<Option<String>>);

// L2.1 PSDPM (PL/SQL Developer Parity Mode) — per-session active flag mirrored
// from the saved connection. Workspace_open populates it from the connection
// row; workspace_close clears it. The sidecar enforces the gate on incoming
// non-user-initiated RPCs (AI tools, embed batches, query.execute origins).
pub struct PsdpmState(pub tokio::sync::Mutex<bool>);

pub struct AuditChainState(pub tokio::sync::Mutex<String>);

// Item #1D: Rate-limit state for audit_verify_chain. At most 1 verify per 60s
// to prevent runaway I/O on large JSONL files from a compromised renderer.
pub struct VerifyChainRateLimit {
    pub last_call: tokio::sync::Mutex<Option<std::time::Instant>>,
}

const VERIFY_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainBrokenAt {
    pub index: usize,
    pub ts: String,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerifyResult {
    pub ok: bool,
    pub checked: usize,
    pub skipped_legacy: usize,
    pub sub_chains: usize,
    pub broken_at: Option<ChainBrokenAt>,
}

/// L1.2 (Sprint C — Air-gap mode). When `true`, every Tauri command that makes
/// outbound HTTPS calls (cloud_api_*, auth_token_*, ai_*, embed_*,
/// object_version_push, object_version_get_remote, sandbox_*) short-circuits
/// with the shared `-32099` JSON-RPC error. The state is loaded from
/// `connection.airgap_mode` on `workspace_open` and reset on `workspace_close`,
/// so toggling is per-connection and resets between sessions.
///
/// Note: `tauri-plugin-updater` runs its own check on app start. Air-gap mode
/// does NOT disable that startup check; it only gates renderer-initiated
/// network commands. True air-gap requires running the app with
/// `VEESKER_DISABLE_UPDATER=1` set; the env-var support is tracked separately.
/// This struct gates renderer-controllable egress only.
pub struct AirGapState(pub tokio::sync::Mutex<bool>);

/// Shared error message and code for every air-gap-blocked command. -32099 is
/// outside the standard JSON-RPC reserved range so the renderer can match it
/// reliably.
pub(crate) const AIRGAP_ERR_CODE: i32 = -32099;
pub(crate) const AIRGAP_ERR_MSG: &str =
    "Air-gap mode active: outbound network calls are disabled for this connection";

pub(crate) fn airgap_blocked_err() -> ConnectionTestErr {
    ConnectionTestErr {
        code: AIRGAP_ERR_CODE,
        message: AIRGAP_ERR_MSG.to_string(),
    }
}

pub(crate) fn airgap_blocked_string() -> String {
    format!("airgap_blocked: {AIRGAP_ERR_MSG}")
}

/// Read the current air-gap state. Awaits the lock briefly and returns the
/// inner bool — callers should use this at the top of every gated command.
async fn airgap_active(app: &AppHandle) -> bool {
    *app.state::<AirGapState>().0.lock().await
}

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

// MEDIUM-002 (audit 2026-04-30): validate the wallet directory path BEFORE
// passing it to the sidecar. Without this, connection_test would accept a UNC
// path like \\evil-server\share which would leak NTLM hashes on Windows when
// oracledb opens the wallet location.
//
// HIGH-002 also re-validates host/serviceName/connect_alias as belt-and-
// suspenders even though connection_save already does so via persistence layer.
fn config_to_params(app: &AppHandle, config: ConnectionConfig) -> Result<Value, ConnectionError> {
    use crate::persistence::connection_config::{basic_params, wallet_params};
    use crate::persistence::connections::{
        validate_connect_alias, validate_host, validate_service_name,
    };
    match config {
        ConnectionConfig::Basic {
            host,
            port,
            service_name,
            username,
            password,
        } => {
            validate_host(&host)?;
            validate_service_name(&service_name)?;
            Ok(basic_params(
                &host,
                port,
                &service_name,
                &username,
                &password,
            ))
        }
        ConnectionConfig::Wallet {
            wallet_dir,
            wallet_password,
            connect_alias,
            username,
            password,
        } => {
            let canon = validate_user_path(app, &wallet_dir)?;
            validate_connect_alias(&connect_alias)?;
            Ok(wallet_params(
                &canon,
                &wallet_password,
                &connect_alias,
                &username,
                &password,
            ))
        }
    }
}

#[tauri::command]
pub async fn connection_test(
    app: AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionTestOk, ConnectionTestErr> {
    let sidecar = acquire(&app).await.map_err(|err| ConnectionTestErr {
        code: -32003,
        message: err,
    })?;

    let params = config_to_params(&app, config).map_err(|err| ConnectionTestErr {
        code: err.code,
        message: err.message,
    })?;
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
use crate::persistence::keep_open::KeepOpenRecord;

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
        if let Ok(canon_root) = root.canonicalize()
            && canon.starts_with(&canon_root)
        {
            return Ok(canon);
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
    if let ConnectionInput::Wallet {
        wallet_zip_path: Some(ref mut path),
        ..
    } = input
    {
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

/// Verify that an Oracle connection has resolvable credentials for the
/// sandbox publish wizard, **without** returning the password to the
/// renderer. Returns Ok(()) if the keychain entry exists and the connection
/// is basic-auth (sandbox doesn't yet support wallet); otherwise returns
/// the descriptive error message. The wizard pre-checks this in Step 1 so
/// the user gets a clear failure surface before navigating to Step 2.
#[tauri::command]
pub async fn connection_sandbox_oracle_check(
    app: AppHandle,
    id: String,
) -> Result<(), ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.sandbox_oracle_config(&id).map(|_| ())
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
    pub user: String,
    pub service_name: String,
    pub apex: Option<Value>,
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
    // acquire() returns an Arc<Sidecar> after a brief lock. The lock is dropped
    // before we await the call, so concurrent RPCs (e.g. query.cancel arriving
    // while query.execute is in flight) don't serialize through us.
    let sidecar = acquire(app).await.map_err(|err| ConnectionTestErr {
        code: -32003,
        message: err,
    })?;
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
    let (params, conn_name, conn_env, conn_airgap, conn_psdpm) = {
        let svc = app.state::<ConnectionService>();
        let params = svc.sidecar_params(&connection_id).map_err(map_err)?;
        let full = svc.get(&connection_id).ok();
        let (name, env, airgap, psdpm) = full
            .map(|f| {
                use crate::persistence::connections::ConnectionMeta;
                match f.meta {
                    ConnectionMeta::Basic { name, safety, .. } => {
                        (name, safety.env, safety.airgap_mode, safety.psdpm_mode)
                    }
                    ConnectionMeta::Wallet { name, safety, .. } => {
                        (name, safety.env, safety.airgap_mode, safety.psdpm_mode)
                    }
                }
            })
            .unwrap_or_else(|| (connection_id.clone(), None, false, false));
        (params, name, env, airgap, psdpm)
    };

    tray::update_tray(&app, TrayState::Connecting).await;

    let res = match call_sidecar(&app, "workspace.open", params).await {
        Ok(v) => v,
        Err(e) => {
            tray::update_tray(&app, TrayState::Error).await;
            return Err(e);
        }
    };

    // 4-layer hard-lock Layer 3 (Sprint C): when env=prod, force airgap_mode
    // and psdpm_mode ON regardless of stored value. Catches hand-edited SQLite
    // rows or migrations from before the hard-lock was wired.
    let env_is_prod = conn_env.as_deref() == Some("prod");
    let effective_airgap = env_is_prod || conn_airgap;
    let effective_psdpm = env_is_prod || conn_psdpm;
    *app.state::<ActiveConnection>().0.lock().await = Some(conn_name);
    *app.state::<ActiveSessionEnv>().0.lock().await = conn_env;
    *app.state::<AirGapState>().0.lock().await = effective_airgap;
    *app.state::<PsdpmState>().0.lock().await = effective_psdpm;
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
    let user = res
        .get("user")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let service_name = res
        .get("serviceName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let apex = call_sidecar(&app, "apex.detect", json!({})).await.ok();
    Ok(WorkspaceInfo {
        server_version,
        current_schema,
        user,
        service_name,
        apex,
    })
}

/// L2.1: expose the active PSDPM flag so the StatusBar badge and diagnostic
/// surfaces can render the lock without re-loading the connection row.
#[tauri::command]
pub async fn psdpm_active(app: AppHandle) -> bool {
    *app.state::<PsdpmState>().0.lock().await
}

#[tauri::command]
pub async fn workspace_close(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "workspace.close", json!({})).await?;
    *app.state::<ActiveConnection>().0.lock().await = None;
    *app.state::<ActiveSessionEnv>().0.lock().await = None;
    *app.state::<AirGapState>().0.lock().await = false;
    *app.state::<PsdpmState>().0.lock().await = false;
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
#[allow(clippy::too_many_arguments)]
pub async fn query_execute(
    app: AppHandle,
    sql: String,
    request_id: String,
    split_multi: Option<bool>,
    fetch_all: Option<bool>,
    acknowledge_unsafe: Option<bool>,
    // L2.2 Origin attribution: tags the source of this SQL so the
    // Activity Ledger can color-code and filter by who/what initiated it.
    origin: Option<String>,
    origin_detail: Option<String>,
) -> Result<Value, ConnectionTestErr> {
    let started = std::time::Instant::now();
    let result = call_sidecar(
        &app,
        "query.execute",
        json!({
            "sql": sql,
            "requestId": request_id,
            "splitMulti": split_multi.unwrap_or(false),
            "fetchAll": fetch_all.unwrap_or(false),
            "acknowledgeUnsafe": acknowledge_unsafe.unwrap_or(false),
        }),
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
        // L2.2: if the renderer didn't pass an origin, infer ai_approved from
        // the requestId convention ("ai:*"). Falls back to user_typed otherwise.
        let final_origin = origin.unwrap_or_else(|| {
            if request_id.starts_with("ai:") {
                "ai_approved".to_string()
            } else {
                "user_typed".to_string()
            }
        });
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
            origin: Some(final_origin),
            origin_detail,
        };
        let source = if request_id.starts_with("ai:") {
            "ai"
        } else {
            "user"
        };
        let env_val = app.state::<ActiveSessionEnv>().0.lock().await.clone();
        let entry = write_audit_entry(
            &app,
            &data_dir,
            &synthetic_input,
            source,
            env_val.as_deref(),
        )
        .await;
        // L2.5 Activity Ledger: emit the just-written entry to the renderer for
        // real-time updates. Best-effort — emit failure does not affect the query.
        if let Some(ref e) = entry {
            let _ = app.emit("audit:append", e);
        }
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

// L2.5: returns the JSON entry that was just written so callers can emit it
// to the renderer (Activity Ledger). Returns None if the audit dir or file
// could not be created/opened — emit is then skipped.
//
// L2.2: includes the `origin` and `originDetail` fields in the body that gets
// HMAC'd, so the Sprint B HMAC chain still validates with the new fields
// present (verifiers reproduce the same body shape).
//
// Async because callers run inside the Tokio runtime — using `blocking_lock()`
// here panics ("Cannot block the current thread from within a runtime") and
// kills the worker, leaving frontend promises hanging forever (F-02).
async fn write_audit_entry(
    app: &AppHandle,
    app_data_dir: &std::path::Path,
    input: &HistorySaveInput,
    source: &str,
    env: Option<&str>,
) -> Option<Value> {
    let audit_dir = app_data_dir.join("audit");
    if std::fs::create_dir_all(&audit_dir).is_err() {
        return None;
    }
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = audit_dir.join(format!("{date}.jsonl"));

    let chain = app.state::<AuditChainState>();
    let mut prev_hash_guard = chain.0.lock().await;

    // F-D-002: get_or_create_key now returns Option. None = OS keychain
    // unavailable; previously this silently used a zero key, producing
    // forgeable HMACs. We now emit the entry without HMAC/prevHash fields
    // and mark it `chain: "no-chain"`. The verifier treats `no-chain`
    // entries as outside the integrity-protected chain (`skipped_legacy`)
    // rather than chain breaks.
    let key_opt = crate::audit::chain::get_or_create_key();

    let body_value = serde_json::json!({
        "ts":           now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "connectionId": input.connection_id,
        "host":         input.host.as_deref().unwrap_or(""),
        "username":     input.username.as_deref().unwrap_or(""),
        "sql":          crate::audit::redact::redact_sql(&input.sql),
        "success":      input.success,
        "rowCount":     input.row_count,
        "elapsedMs":    input.elapsed_ms,
        "errorCode":    input.error_code,
        "errorMessage": input.error_message,
        "source":       source,
        "env":          env.unwrap_or(""),
        // L2.2 Origin attribution. Defaults to "user_typed" when missing so
        // legacy callers (history_save) still produce a valid origin for the
        // Activity Ledger filter UI. These fields are part of the HMAC body —
        // any tampering with origin invalidates the chain.
        "origin":       input.origin.clone().unwrap_or_else(|| "user_typed".to_string()),
        "originDetail": input.origin_detail,
    });
    let body_str = body_value.to_string();

    let mut entry_obj = body_value.as_object().cloned().unwrap_or_default();
    let hmac = match key_opt.as_deref() {
        Some(key) => {
            let h = crate::audit::chain::compute_hmac(key, &prev_hash_guard, &body_str);
            entry_obj.insert(
                "prevHash".to_string(),
                serde_json::Value::String(prev_hash_guard.clone()),
            );
            entry_obj.insert("hmac".to_string(), serde_json::Value::String(h.clone()));
            h
        }
        None => {
            // No keychain key — emit honestly without chain fields.
            entry_obj.insert(
                "chain".to_string(),
                serde_json::Value::String("no-chain".to_string()),
            );
            String::new()
        }
    };

    let entry = serde_json::Value::Object(entry_obj);
    // L1.4 (Sprint C, Onda 1.B) — wrap the HMAC-signed body in an AES-GCM
    // envelope before writing to disk. The chain invariant is preserved:
    // HMAC was computed over the plain body above, BEFORE this encryption
    // layer; a verifier with both keys decrypts → strips hmac/prevHash →
    // recomputes HMAC over the rest → matches. An attacker with read-only
    // access to the JSONL but neither key learns nothing about the SQL.
    // If the cipher key is unavailable we degrade to plaintext rather than
    // dropping the audit record (legacy lines are still parseable).
    let body = entry.to_string();
    // F-D-001: when the keychain is unavailable, fall back to the legacy
    // plain-JSON line format honestly rather than emitting a body
    // "encrypted" with a publicly-known zero key. The read path already
    // handles plain-JSON lines for backward compat.
    let line_payload = match crate::crypto::get_or_create_audit_cipher_key() {
        Ok(cipher_key) => match crate::crypto::encrypt_audit_line(&cipher_key, &body) {
            Ok(s) => s,
            Err(_) => body.clone(),
        },
        Err(e) => {
            eprintln!(
                "audit-cipher: keychain unavailable ({e}) — writing line in legacy plaintext format"
            );
            body.clone()
        }
    };
    let mut line = line_payload;
    line.push('\n');
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        if file.write_all(line.as_bytes()).is_err() {
            return None;
        }
    } else {
        return None;
    }
    // Advance in-memory chain only after the entry is durably on disk.
    *prev_hash_guard = hmac;
    Some(entry)
}

#[tauri::command]
pub async fn history_save(app: AppHandle, input: HistorySaveInput) -> Result<i64, ConnectionError> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        // L2.5 Activity Ledger: emit the entry so the renderer panel updates
        // even when the SQL was logged through history_save (e.g. background
        // jobs that don't go through query_execute).
        let entry = write_audit_entry(&app, &data_dir, &input, "user", None).await;
        if let Some(ref e) = entry {
            let _ = app.emit("audit:append", e);
        }
    }
    let svc = app.state::<ConnectionService>();
    svc.history_save(input)
}

// L2.5 Activity Ledger: read the last `limit` audit entries from today's
// JSONL log and return them in chronological-newest-first order. Used by the
// frontend on mount to populate the panel before live `audit:append` events
// take over. Lines that fail to parse as JSON are skipped silently.
#[tauri::command]
pub async fn audit_recent(app: AppHandle, limit: Option<i64>) -> Vec<Value> {
    let limit = limit.unwrap_or(200).clamp(1, 1000) as usize;
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let audit_dir = data_dir.join("audit");
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = audit_dir.join(format!("{date}.jsonl"));
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let text = match std::str::from_utf8(&bytes) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    // L1.4 (Sprint C, Onda 1.B) — transparently decrypt `02:`-prefixed lines
    // (current wire format) while still parsing legacy plaintext JSON lines
    // for backward compat. A line that claims encryption but fails to
    // decrypt (key mismatch, tampering, truncation) is silently skipped so
    // a single bad record doesn't black out the entire panel.
    // F-D-001: when keychain is unavailable, encrypted lines cannot be
    // decoded — they're silently skipped. Legacy plain-JSON lines still
    // parse. This is acceptable degradation for the read path.
    let cipher_key_opt = crate::crypto::get_or_create_audit_cipher_key().ok();
    let mut entries: Vec<Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| match cipher_key_opt.as_deref() {
            Some(cipher_key) => {
                match crate::crypto::decrypt_audit_line_if_envelope(cipher_key, l) {
                    Ok(Some(plain)) => serde_json::from_str::<Value>(&plain).ok(),
                    Ok(None) => serde_json::from_str::<Value>(l).ok(),
                    Err(_) => None,
                }
            }
            None => {
                // No key: only legacy plain-JSON lines are readable.
                if l.starts_with(crate::crypto::ENCRYPTED_LINE_PREFIX) {
                    None
                } else {
                    serde_json::from_str::<Value>(l).ok()
                }
            }
        })
        .collect();
    // newest-first
    entries.reverse();
    entries.truncate(limit);
    entries
}

// Item #1D: Pure, testable chain verification logic. Reads a JSONL file,
// decrypts each line, and verifies the HMAC chain. "genesis" prevHash values
// mark the start of a new sub-chain (one per app session/restart) — these are
// not treated as breaks.
pub fn verify_chain_file(path: &Path, key: &[u8]) -> ChainVerifyResult {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return ChainVerifyResult { ok: true, checked: 0, skipped_legacy: 0, sub_chains: 0, broken_at: None },
    };
    let text = match std::str::from_utf8(&bytes) {
        Ok(t) => t,
        Err(_) => return ChainVerifyResult { ok: false, checked: 0, skipped_legacy: 0, sub_chains: 0,
            broken_at: Some(ChainBrokenAt { index: 0, ts: String::new(), reason: "file_not_utf8".to_string() }) },
    };
    // F-D-001: same fallback as audit_recent — if no keychain key is
    // available, encrypted envelopes are unreadable and we treat them as
    // skipped. Legacy plaintext lines still verify against the HMAC chain.
    let cipher_key_opt = crate::crypto::get_or_create_audit_cipher_key().ok();
    let mut checked: usize = 0;
    let mut skipped_legacy: usize = 0;
    let mut sub_chains: usize = 0;
    let mut expected_prev = String::new();
    let mut raw_index: usize = 0;

    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let plain = match cipher_key_opt.as_deref() {
            Some(cipher_key) => match crate::crypto::decrypt_audit_line_if_envelope(cipher_key, line) {
                Ok(Some(p)) => p,
                Ok(None) => line.to_string(),
                Err(_) => { raw_index += 1; continue; }
            },
            None => {
                if line.starts_with(crate::crypto::ENCRYPTED_LINE_PREFIX) {
                    raw_index += 1;
                    continue;
                }
                line.to_string()
            }
        };
        let obj: serde_json::Map<String, Value> = match serde_json::from_str::<Value>(&plain) {
            Ok(Value::Object(m)) => m,
            _ => { raw_index += 1; continue; }
        };
        let ts = obj.get("ts").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let stored_hmac = match obj.get("hmac").and_then(|v| v.as_str()) {
            Some(h) => h.to_string(),
            None => { skipped_legacy += 1; raw_index += 1; continue; }
        };
        let stored_prev = match obj.get("prevHash").and_then(|v| v.as_str()) {
            Some(p) => p.to_string(),
            None => { skipped_legacy += 1; raw_index += 1; continue; }
        };
        // Sub-chain boundary: a new app session resets prevHash to "genesis".
        if stored_prev == "genesis" {
            sub_chains += 1;
            expected_prev = "genesis".to_string();
        }
        // Verify chain linkage.
        if stored_prev != expected_prev {
            return ChainVerifyResult { ok: false, checked, skipped_legacy, sub_chains,
                broken_at: Some(ChainBrokenAt { index: raw_index, ts, reason: "prev_hash_mismatch".to_string() }) };
        }
        // Reconstruct body_str: strip hmac and prevHash, re-serialize.
        let mut stripped = obj.clone();
        stripped.remove("hmac");
        stripped.remove("prevHash");
        let body_str = Value::Object(stripped).to_string();
        let recomputed = crate::audit::chain::compute_hmac(key, &stored_prev, &body_str);
        if recomputed != stored_hmac {
            return ChainVerifyResult { ok: false, checked, skipped_legacy, sub_chains,
                broken_at: Some(ChainBrokenAt { index: raw_index, ts, reason: "hmac_mismatch".to_string() }) };
        }
        expected_prev = stored_hmac;
        checked += 1;
        raw_index += 1;
    }
    ChainVerifyResult { ok: true, checked, skipped_legacy, sub_chains, broken_at: None }
}

#[tauri::command]
pub async fn audit_verify_chain(
    app: AppHandle,
    rate_limit: tauri::State<'_, VerifyChainRateLimit>,
) -> Result<ChainVerifyResult, String> {
    let mut last = rate_limit.last_call.lock().await;
    if let Some(t) = *last
        && t.elapsed() < VERIFY_MIN_INTERVAL
    {
        return Err("RATE_LIMITED".into());
    }
    *last = Some(std::time::Instant::now());
    drop(last);

    let data_dir = app.path().app_data_dir().map_err(|_| "data_dir_unavailable")?;
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = data_dir.join("audit").join(format!("{date}.jsonl"));
    if !path.exists() {
        return Ok(ChainVerifyResult { ok: true, checked: 0, skipped_legacy: 0, sub_chains: 0, broken_at: None });
    }
    // F-D-002: get_or_create_key now returns Option. None = keychain
    // unavailable — verify cannot proceed because HMAC recomputation needs
    // the key. Surface that honestly rather than verifying with a zero
    // key (which would pass-by-accident on every forged entry).
    let key = match crate::audit::chain::get_or_create_key() {
        Some(k) => k,
        None => {
            return Ok(ChainVerifyResult {
                ok: false,
                checked: 0,
                skipped_legacy: 0,
                sub_chains: 0,
                broken_at: Some(ChainBrokenAt {
                    index: 0,
                    ts: String::new(),
                    reason: "hmac_key_unavailable_keychain_locked".to_string(),
                }),
            });
        }
    };
    Ok(verify_chain_file(&path, &key))
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDdlResult {
    pub ddl: String,
    pub spec: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn object_ddl_get(
    app: AppHandle,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<ObjectDdlResult, ConnectionTestErr> {
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
    let spec = res
        .get("spec")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let body = res
        .get("body")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(ObjectDdlResult { ddl, spec, body })
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
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    let res = call_sidecar(&app, "ai.chat", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn ai_suggest_endpoint(
    app: AppHandle,
    params: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
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
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    let res = call_sidecar(&app, "embed.count_pending", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn embed_batch(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    let res = call_sidecar(&app, "embed.batch", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn ai_key_save(app: AppHandle, service: String, key: String) -> Result<(), String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    crate::persistence::secrets::set_api_key(&service, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_key_get(app: AppHandle, service: String) -> Result<Option<String>, String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
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
pub async fn connection_tx_state(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "connection.txState", json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn tx_keep_open_record(
    app: AppHandle,
    connection_id: String,
    env: String,
    last_tx_id: Option<String>,
    opened_at: i64,
    expires_at: i64,
) -> Result<KeepOpenRecord, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.keep_open_record(
        &connection_id,
        &env,
        last_tx_id.as_deref(),
        opened_at,
        expires_at,
    )
}

#[tauri::command]
pub async fn tx_keep_open_clear(
    app: AppHandle,
    connection_id: String,
) -> Result<(), ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.keep_open_clear(&connection_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxModalAuditInput {
    pub decision: String,
    pub triggered_by: String,
    pub connection_id: String,
    pub env: Option<String>,
    pub pending_statements: i64,
    pub last_tx_id: Option<String>,
}

#[tauri::command]
pub async fn tx_modal_audit(
    app: AppHandle,
    input: TxModalAuditInput,
) -> Result<(), ConnectionError> {
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    let svc = app.state::<ConnectionService>();
    let (host, username) = match svc.get(&input.connection_id) {
        Ok(full) => match full.meta {
            ConnectionMeta::Basic {
                host, username, ..
            } => (host, username),
            ConnectionMeta::Wallet {
                connect_alias,
                username,
                ..
            } => (connect_alias, username),
        },
        Err(_) => (String::new(), String::new()),
    };
    let origin_detail = json!({
        "triggeredBy": input.triggered_by,
        "pendingStatements": input.pending_statements,
        "lastTxId": input.last_tx_id,
    })
    .to_string();
    let synthetic_input = HistorySaveInput {
        connection_id: input.connection_id.clone(),
        sql: String::new(),
        success: true,
        row_count: None,
        elapsed_ms: 0,
        error_code: None,
        error_message: None,
        username: Some(username),
        host: Some(host),
        origin: Some(input.decision.clone()),
        origin_detail: Some(origin_detail),
    };
    let entry = write_audit_entry(
        &app,
        &data_dir,
        &synthetic_input,
        "user",
        input.env.as_deref(),
    )
    .await;
    if let Some(ref e) = entry {
        let _ = app.emit("audit:append", e);
    }
    Ok(())
}

#[tauri::command]
pub async fn driver_mode(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "driver.mode", json!({})).await?;
    Ok(res)
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
pub async fn vision_graph(
    app: AppHandle,
    owner: String,
    object_name: String,
    object_type: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "vision.graph",
        json!({ "owner": owner, "objectName": object_name, "objectType": object_type }),
    )
    .await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode vision.graph: {e}"),
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
pub async fn flow_trace_proc(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "flow.trace_proc", payload).await
}

#[tauri::command]
pub async fn flow_trace_sql(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "flow.trace_sql", payload).await
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
pub async fn apex_detect(app: AppHandle) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "apex.detect", json!({})).await
}

#[tauri::command]
pub async fn apex_workspaces_list(app: AppHandle) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "apex.workspaces.list", json!({})).await
}

#[tauri::command]
pub async fn apex_applications_list(
    app: AppHandle,
    workspace: String,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "apex.applications.list",
        json!({ "workspace": workspace }),
    )
    .await
}

#[tauri::command]
pub async fn apex_pages_list(
    app: AppHandle,
    application_id: i64,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "apex.pages.list",
        json!({ "applicationId": application_id }),
    )
    .await
}

#[tauri::command]
pub async fn session_self(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    call_sidecar(&app, "oracle.session_self", json!({})).await
}

#[tauri::command]
pub async fn ai_approval_resolve(
    app: AppHandle,
    request_id: String,
    approved: bool,
    apply_to_turn: bool,
) -> Result<Value, ConnectionTestErr> {
    call_sidecar(
        &app,
        "ai.approval.resolve",
        json!({
            "requestId": request_id,
            "approved": approved,
            "applyToTurn": apply_to_turn,
        }),
    )
    .await
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
    fallback_base_url: Option<String>,
) -> Result<OrdsTestResult, ConnectionTestErr> {
    // Authoritative base URL comes from the sidecar (which derives it from the
    // currently-open Oracle session via ORDS metadata) — NOT from the renderer.
    // Closes a renderer-controlled-exfil hole where a compromised UI could pass
    // any allowed_base_url it wanted.
    // Self-hosted ORDS where security.host.url isn't set falls back to the
    // user-supplied base URL (validated as a well-formed http/https URL).
    let detect = call_sidecar(&app, "ords.detect", json!({})).await?;
    let detected_base = detect
        .get("ordsBaseUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            fallback_base_url.filter(|s| !s.is_empty()).filter(|s| {
                reqwest::Url::parse(s)
                    .map(|u| matches!(u.scheme(), "http" | "https"))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| ConnectionTestErr {
            code: -32603,
            message: "ORDS base URL not detected and no valid fallback provided".to_string(),
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
            });
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

#[tauri::command]
pub async fn perf_stats(app: AppHandle, sql: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "perf.stats", json!({ "sql": sql })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn dml_preview(app: AppHandle, sql: String) -> Result<Value, ConnectionTestErr> {
    call_sidecar(&app, "dml.preview", json!({ "sql": sql })).await
}

#[tauri::command]
pub async fn unsafe_dml_confirm(
    app: AppHandle,
    summary: String,
) -> Result<bool, ConnectionTestErr> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let safe_summary = summary.chars().take(300).collect::<String>();
    app.dialog()
        .message(format!(
            "You are about to execute a potentially unsafe SQL statement:\n\n{safe_summary}\n\nThis operation cannot be automatically rolled back. Proceed?"
        ))
        .title("Unsafe SQL — Confirm Execution")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Execute Anyway".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    Ok(rx.await.unwrap_or(false))
}

// ─── DDL Confirmation Gate (Item #1E) ────────────────────────────────────────

fn write_ddl_event(app: &AppHandle, event_obj: Value) {
    let Ok(data_dir) = app.path().app_data_dir() else { return };
    let audit_dir = data_dir.join("audit");
    if std::fs::create_dir_all(&audit_dir).is_err() { return }
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = audit_dir.join(format!("{date}.jsonl"));
    let body = event_obj.to_string();
    // F-D-001: same legacy-plaintext fallback when keychain is unavailable.
    let line = match crate::crypto::get_or_create_audit_cipher_key() {
        Ok(cipher_key) => match crate::crypto::encrypt_audit_line(&cipher_key, &body) {
            Ok(s) => format!("{s}\n"),
            Err(_) => format!("{body}\n"),
        },
        Err(e) => {
            eprintln!(
                "audit-cipher (ddl event): keychain unavailable ({e}) — writing line as legacy plaintext"
            );
            format!("{body}\n")
        }
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
    let _ = app.emit("audit:append", &event_obj);
}

#[tauri::command]
pub async fn ddl_confirm(app: AppHandle, kind: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "ddl.confirm", json!({ "kind": kind })).await?;
    let now = chrono::Utc::now();
    write_ddl_event(&app, json!({
        "event": "ddl_window_opened",
        "kind": kind,
        "user_action": "explicit_confirm",
        "ts": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }));
    Ok(res)
}

#[tauri::command]
pub async fn ddl_unlock(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "ddl.unlock", json!({})).await?;
    let now = chrono::Utc::now();
    write_ddl_event(&app, json!({
        "event": "ddl_window_closed",
        "reason": "explicit_unlock",
        "ts": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }));
    Ok(res)
}

#[tauri::command]
pub async fn audit_ddl_event(
    app: AppHandle,
    risk_level: String,
    statement: String,
    env: String,
    window_age_ms: i64,
) -> Result<(), ConnectionTestErr> {
    let now = chrono::Utc::now();
    write_ddl_event(&app, json!({
        "event": "ddl_executed",
        "sql_kind": "ddl",
        "risk_level": risk_level,
        "statement": statement.chars().take(500).collect::<String>(),
        "env": env,
        "window_age_ms": window_age_ms,
        "ts": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }));
    Ok(())
}

#[tauri::command]
pub async fn confirm_rollback_tx(app: AppHandle) -> Result<bool, ConnectionTestErr> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    app.dialog()
        .message(
            "You have uncommitted changes in this session.\n\nRolling back will permanently discard all pending DML and DDL changes since your last COMMIT. This action cannot be undone.\n\nProceed with ROLLBACK?"
        )
        .title("Discard Pending Transaction")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Rollback".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    Ok(rx.await.unwrap_or(false))
}

// ─── Object Version History ───────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub captured: bool,
}

#[tauri::command]
pub async fn object_version_capture(
    app: AppHandle,
    connection_id: String,
    owner: String,
    object_type: String,
    object_name: String,
    ddl: String,
    reason: String,
) -> CaptureResult {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    let captured = svc.object_version_capture(
        &connection_id,
        &owner,
        &object_type,
        &object_name,
        &ddl,
        &reason,
    );
    CaptureResult { captured }
}

#[tauri::command]
pub async fn object_version_list(
    app: AppHandle,
    connection_id: String,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<Vec<crate::persistence::object_versions::ObjectVersionEntry>, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_list(&connection_id, &owner, &object_type, &object_name)
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub diff: String,
}

#[tauri::command]
pub async fn object_version_diff(
    app: AppHandle,
    connection_id: String,
    sha_a: String,
    sha_b: String,
    file_path: String,
) -> Result<DiffResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_diff(&connection_id, &sha_a, &sha_b, &file_path)
        .map(|diff| DiffResult { diff })
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[derive(Serialize)]
pub struct LoadResult {
    pub ddl: String,
}

#[tauri::command]
pub async fn object_version_load(
    app: AppHandle,
    connection_id: String,
    commit_sha: String,
    file_path: String,
) -> Result<LoadResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_load(&connection_id, &commit_sha, &file_path)
        .map(|ddl| LoadResult { ddl })
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[tauri::command]
pub async fn object_version_label(
    app: AppHandle,
    connection_id: String,
    version_id: i64,
    owner: String,
    object_type: String,
    object_name: String,
    label: Option<String>,
) -> Result<(), ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_set_label(
        &connection_id,
        version_id,
        &owner,
        &object_type,
        &object_name,
        label.as_deref(),
    )
    .map_err(|e| ConnectionTestErr {
        code: e.code,
        message: e.message,
    })
}

#[tauri::command]
pub async fn object_version_set_remote(
    app: AppHandle,
    connection_id: String,
    remote_url: String,
    pat: String,
) -> Result<(), ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_set_remote(&connection_id, &remote_url, &pat)
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub pushed_commits: u32,
}

#[tauri::command]
pub async fn object_version_push(
    app: AppHandle,
    connection_id: String,
) -> Result<PushResult, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_push(&connection_id)
        .map(|pushed_commits| PushResult { pushed_commits })
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRemoteResult {
    pub url: Option<String>,
}

#[tauri::command]
pub async fn object_version_get_remote(
    app: AppHandle,
    connection_id: String,
) -> Result<GetRemoteResult, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_get_remote(&connection_id)
        .map(|url| GetRemoteResult { url })
        .map_err(|e| ConnectionTestErr {
            code: e.code,
            message: e.message,
        })
}

#[tauri::command]
pub async fn auth_token_get(app: AppHandle) -> Result<Option<String>, String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    crate::persistence::secrets::get_auth_token().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_token_set(app: AppHandle, token: String) -> Result<(), String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    crate::persistence::secrets::set_auth_token(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_token_clear(app: AppHandle) -> Result<(), String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    crate::persistence::secrets::delete_auth_token().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cloud_api_get(
    app: AppHandle,
    path: String,
    params: Option<std::collections::HashMap<String, String>>,
) -> Result<Value, String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    let token = crate::persistence::secrets::get_auth_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_authenticated".to_string())?;

    let base = "https://api.veesker.cloud";
    let url = format!("{}{}", base, path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url).bearer_auth(&token);
    if let Some(p) = params {
        req = req.query(&p.into_iter().collect::<Vec<_>>());
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;

    if status == 401 {
        return Err("not_authenticated".to_string());
    }
    if status == 403 {
        return Err("forbidden".to_string());
    }
    if status >= 400 {
        return Err(format!("server_error_{}", status));
    }
    Ok(body)
}

#[tauri::command]
pub async fn cloud_api_post(app: AppHandle, path: String, body: Value) -> Result<(), String> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_string());
    }
    let token = crate::persistence::secrets::get_auth_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_authenticated".to_string())?;

    let url = format!("https://api.veesker.cloud{}", path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status == 401 {
        return Err("not_authenticated".to_string());
    }
    if status >= 400 {
        return Err(format!("server_error_{}", status));
    }
    Ok(())
}

/// Inject the Veesker Cloud auth envelope into a sandbox.* sidecar payload.
/// Reads the JWT from the OS keychain and adds `apiToken` + `apiBaseUrl`
/// to the payload before forwarding. The renderer never touches the JWT.
///
/// The sidecar derives `ownerAccount` and `ownerUserId` from the JWT inside
/// `expandSandboxEnvelope` — the renderer cannot influence those identity
/// fields anymore, closing the previous attack surface where a compromised
/// renderer could call sandbox.open with `ownerAccount="other-user"` to
/// load a sibling account's keypair from the OS keychain.
///
/// Same defense-in-depth pattern as inject_sandbox_oracle_config: scrub
/// any pre-existing keys before re-inserting the Rust-resolved values.
fn inject_cloud_envelope(payload: &mut Value) -> Result<(), ConnectionTestErr> {
    let token = crate::persistence::secrets::get_auth_token()
        .map_err(|e| ConnectionTestErr {
            code: -32000,
            message: format!("auth token unavailable: {}", e),
        })?
        .ok_or_else(|| ConnectionTestErr {
            code: -32001,
            message: "not_authenticated".to_string(),
        })?;

    if let Some(obj) = payload.as_object_mut() {
        obj.remove("apiToken");
        obj.remove("apiBaseUrl");
        // Also scrub renderer-supplied identity fields — the sidecar derives
        // ownerAccount/ownerUserId from the JWT we're about to inject.
        obj.remove("ownerAccount");
        obj.remove("ownerUserId");
        obj.insert("apiToken".to_string(), Value::String(token));
        obj.insert(
            "apiBaseUrl".to_string(),
            Value::String("https://api.veesker.cloud".to_string()),
        );
        Ok(())
    } else {
        Err(ConnectionTestErr {
            code: -32602,
            message: "sandbox payload must be a JSON object".to_string(),
        })
    }
}

/// Resolve, ensure-exists, canonicalize, and inject the
/// `app_data/sandbox-builds` path so the sidecar can validate any
/// renderer-supplied `outPath` against a Rust-controlled anchor. Creating
/// the directory here (idempotent) means dry-run callers don't need to
/// pre-create it. Same scrub-then-insert defense-in-depth pattern as
/// `inject_cloud_envelope`.
fn inject_expected_builds_dir(
    app: &AppHandle,
    payload: &mut Value,
) -> Result<(), ConnectionTestErr> {
    let app_data = app.path().app_data_dir().map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("could not resolve app data dir: {}", e),
    })?;
    let builds_dir = app_data.join("sandbox-builds");
    // canonicalize() requires the directory to exist. Create it first
    // so callers (sandbox_build_dry_run, future ones) don't have to
    // remember to do it. Idempotent.
    std::fs::create_dir_all(&builds_dir).map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("could not create sandbox-builds dir: {}", e),
    })?;
    let canonical = builds_dir.canonicalize().map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("could not canonicalize sandbox-builds dir: {}", e),
    })?;
    let canonical_str = canonical.to_string_lossy().into_owned();
    // Strip the Windows `\\?\` UNC prefix when present so the sidecar's
    // path.resolve produces matching strings.
    let cleaned = canonical_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&canonical_str)
        .to_string();

    if let Some(obj) = payload.as_object_mut() {
        obj.remove("expectedBuildsDir");
        obj.insert("expectedBuildsDir".to_string(), Value::String(cleaned));
        Ok(())
    } else {
        Err(ConnectionTestErr {
            code: -32602,
            message: "sandbox payload must be a JSON object".to_string(),
        })
    }
}

#[tauri::command]
pub async fn sandbox_ensure_keypair(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.ensureKeypair", payload).await
}

#[tauri::command]
pub async fn sandbox_publish(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    inject_expected_builds_dir(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.publish", payload).await
}

/// Plan 7: read the persisted build config snapshot from
/// `<expectedBuildsDir>/<sandboxId>.config.json` and inject its `connectionId`
/// into the payload, so the next-up `inject_sandbox_oracle_config` can resolve
/// Oracle credentials. Must run AFTER `inject_expected_builds_dir` (which sets
/// `expectedBuildsDir`) and BEFORE `inject_sandbox_oracle_config`.
fn inject_republish_connection_id(payload: &mut Value) -> Result<(), ConnectionTestErr> {
    let sandbox_id = payload
        .get("sandboxId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ConnectionTestErr {
            code: -32602,
            message: "sandbox.republish requires sandboxId".to_string(),
        })?
        .to_string();
    let builds_dir = payload
        .get("expectedBuildsDir")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ConnectionTestErr {
            code: -32603,
            message: "expectedBuildsDir not injected before connectionId resolution".to_string(),
        })?
        .to_string();

    let config_path =
        std::path::PathBuf::from(&builds_dir).join(format!("{}.config.json", sandbox_id));
    let raw = std::fs::read_to_string(&config_path).map_err(|e| ConnectionTestErr {
        code: -32004,
        message: format!(
            "republish: build config missing for sandbox {} — was the original publish from this machine? ({})",
            sandbox_id, e
        ),
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("republish: build config JSON malformed: {}", e),
    })?;
    let connection_id = parsed
        .get("connectionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ConnectionTestErr {
            code: -32603,
            message: "republish: build config missing 'connectionId' field".to_string(),
        })?
        .to_string();

    if let Some(obj) = payload.as_object_mut() {
        obj.insert("connectionId".to_string(), Value::String(connection_id));
        Ok(())
    } else {
        Err(ConnectionTestErr {
            code: -32602,
            message: "sandbox payload must be a JSON object".to_string(),
        })
    }
}

#[tauri::command]
pub async fn sandbox_republish(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    // Frontend only sends { sandboxId }. We inject everything else here:
    // 1. Cloud envelope (apiToken/apiBaseUrl from auth secrets)
    // 2. expectedBuildsDir (path to canonical builds dir)
    // 3. connectionId (read from <buildsDir>/<sandboxId>.config.json saved at publish time)
    // 4. oracleConfig (resolved from connectionId via the connection store)
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    inject_expected_builds_dir(&app, &mut payload)?;
    inject_republish_connection_id(&mut payload)?;
    inject_sandbox_oracle_config(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.republish", payload).await
}

#[tauri::command]
pub async fn sandbox_pull(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.pull", payload).await
}

#[tauri::command]
pub async fn sandbox_list(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.list", payload).await
}

#[tauri::command]
pub async fn sandbox_grant(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.grant", payload).await
}

#[tauri::command]
pub async fn sandbox_revoke(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.revoke", payload).await
}

#[tauri::command]
pub async fn sandbox_delete(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.delete", payload).await
}

#[tauri::command]
pub async fn sandbox_open(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.open", payload).await
}

#[tauri::command]
pub async fn sandbox_query(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.query", payload).await
}

#[tauri::command]
pub async fn sandbox_close(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.close", payload).await
}

#[tauri::command]
pub async fn sandbox_list_cached(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.list-cached", payload).await
}

#[tauri::command]
pub async fn sandbox_leave(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.leave", payload).await
}

#[tauri::command]
pub async fn sandbox_mark_seen(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.markSeen", payload).await
}

#[tauri::command]
pub async fn sandbox_list_last_seen(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    call_sidecar(&app, "sandbox.listLastSeen", payload).await
}

/// Resolve sandbox Oracle credentials server-side and inject them into the
/// payload before forwarding to the sidecar. The renderer passes only
/// `connectionId` (and the build spec); the password is read from the OS
/// keychain by `ConnectionService::sandbox_oracle_config` and never crosses
/// the JS process. Look up either at the payload root (list-schema-tables /
/// compute-fk-closure) or under `payload.spec` (sandbox.build), since the
/// build spec is the only place that nests the connection identifier.
///
/// Defense-in-depth: explicitly REMOVE any pre-existing `oracleConfig` key
/// before re-inserting the Rust-resolved value. `serde_json::Map::insert`
/// already overwrites, but the explicit remove makes it visually obvious
/// to future maintainers that no renderer-supplied oracleConfig survives.
/// If a future commands.rs regression ever calls `call_sidecar` without
/// going through this helper, the sidecar would naively trust a forged
/// renderer payload — that is documented as a known gap; the long-term fix
/// is an HMAC nonce shared with the sidecar at spawn time so the sidecar
/// can refuse calls without a Rust-issued tag.
fn inject_sandbox_oracle_config(
    app: &AppHandle,
    payload: &mut Value,
) -> Result<(), ConnectionTestErr> {
    let connection_id = payload
        .get("connectionId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            payload
                .get("spec")
                .and_then(|s| s.get("connectionId"))
                .and_then(|v| v.as_str())
        })
        .ok_or_else(|| ConnectionTestErr {
            code: -32602,
            message: "missing connectionId in sandbox payload".to_string(),
        })?
        .to_string();

    let svc = app.state::<ConnectionService>();
    let oracle_config =
        svc.sandbox_oracle_config(&connection_id)
            .map_err(|e| ConnectionTestErr {
                code: e.code,
                message: e.message,
            })?;

    if let Some(obj) = payload.as_object_mut() {
        // Belt-and-suspenders: scrub any renderer-supplied value first.
        obj.remove("oracleConfig");
        obj.insert("oracleConfig".to_string(), oracle_config);
        Ok(())
    } else {
        Err(ConnectionTestErr {
            code: -32602,
            message: "sandbox payload must be a JSON object".to_string(),
        })
    }
}

#[tauri::command]
pub async fn sandbox_list_schema_tables(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    inject_sandbox_oracle_config(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.list-schema-tables", payload).await
}

#[tauri::command]
pub async fn sandbox_compute_fk_closure(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    inject_sandbox_oracle_config(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.compute-fk-closure", payload).await
}

#[tauri::command]
pub async fn sandbox_discover_plsql(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    inject_sandbox_oracle_config(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.discover_plsql", payload).await
}

#[tauri::command]
pub async fn sandbox_build_dry_run(
    app: AppHandle,
    mut payload: Value,
) -> Result<Value, ConnectionTestErr> {
    // Identical RPC to sandbox.build; the frontend wrapper forces dryRun:true
    // in the spec before this is invoked. Phase events still flow through the
    // existing sidecar response envelope.
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    inject_expected_builds_dir(&app, &mut payload)?;
    inject_sandbox_oracle_config(&app, &mut payload)?;
    call_sidecar(&app, "sandbox.build", payload).await
}

/// Windows reserved device names (case-insensitive, with or without a trailing
/// extension) — opening a file with one of these names refers to the legacy
/// device, not a regular file. Surfaced as confusing failures even when the
/// path is otherwise rooted under app_data.
const WINDOWS_RESERVED_BASENAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a renderer-suggested sandbox basename so the resolved outPath is
/// always Rust-controlled. Strips path separators, parent-dir tokens, and any
/// chars outside `[A-Za-z0-9._-]`; rejects Windows reserved device names by
/// prefixing `_`; falls back to "sandbox" when the result would be empty.
/// Bounded length prevents pathological filenames.
fn sanitize_sandbox_basename(suggested: &str) -> String {
    let cleaned: String = suggested
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .collect();
    let trimmed = cleaned.trim_matches('.').trim_matches('-');
    let mut base = if trimmed.is_empty() {
        "sandbox".to_string()
    } else {
        trimmed.to_string()
    };

    // Check Windows reserved device names against the part before any '.'
    // extension (CON.vsk would still reach the console device).
    let stem = base.split('.').next().unwrap_or("").to_uppercase();
    if WINDOWS_RESERVED_BASENAMES.iter().any(|r| *r == stem) {
        base.insert(0, '_');
    }

    let max_len = 64;
    if base.len() > max_len {
        base[..max_len].to_string()
    } else {
        base
    }
}

#[cfg(test)]
mod sandbox_basename_tests {
    use super::sanitize_sandbox_basename;

    #[test]
    fn keeps_alphanumeric_and_safe_punctuation() {
        assert_eq!(
            sanitize_sandbox_basename("ORDERS_2025-Q1.demo"),
            "ORDERS_2025-Q1.demo"
        );
    }

    #[test]
    fn strips_path_separators() {
        assert_eq!(sanitize_sandbox_basename("../../etc/hosts"), "etchosts");
        assert_eq!(
            sanitize_sandbox_basename("..\\..\\Windows\\System32"),
            "WindowsSystem32"
        );
    }

    #[test]
    fn falls_back_to_sandbox_on_empty_result() {
        assert_eq!(sanitize_sandbox_basename(""), "sandbox");
        assert_eq!(sanitize_sandbox_basename("...."), "sandbox");
        assert_eq!(sanitize_sandbox_basename("////"), "sandbox");
        assert_eq!(sanitize_sandbox_basename("São Paulo"), "SoPaulo");
    }

    #[test]
    fn caps_length_at_64() {
        let long = "A".repeat(200);
        assert_eq!(sanitize_sandbox_basename(&long).len(), 64);
    }

    #[test]
    fn prefixes_underscore_on_windows_reserved_names() {
        assert_eq!(sanitize_sandbox_basename("CON"), "_CON");
        assert_eq!(sanitize_sandbox_basename("aux"), "_aux");
        assert_eq!(sanitize_sandbox_basename("NUL.vsk"), "_NUL.vsk");
        assert_eq!(sanitize_sandbox_basename("COM1.demo"), "_COM1.demo");
        assert_eq!(sanitize_sandbox_basename("LPT9"), "_LPT9");
        // not reserved
        assert_eq!(sanitize_sandbox_basename("CONNECTION"), "CONNECTION");
        assert_eq!(sanitize_sandbox_basename("LPT0"), "LPT0");
    }

    #[test]
    fn unicode_silently_stripped_to_ascii() {
        // Documents the current behavior — non-ASCII chars are dropped. If
        // localized names need to round-trip, normalize to NFC + Punycode in
        // the renderer first, or surface a UI hint when the result differs.
        assert_eq!(sanitize_sandbox_basename("ção_café"), "o_caf");
    }
}

#[tauri::command]
pub async fn sandbox_build(app: AppHandle, mut payload: Value) -> Result<Value, ConnectionTestErr> {
    // Real (non-dryRun) sandbox build — runs the full extract/encrypt/pack
    // pipeline and writes the .vsk under the app data dir. The renderer's
    // suggested outPath is ignored to prevent path-traversal (../etc/hosts,
    // UNC paths, arbitrary system locations); Rust always constructs an
    // app-data-rooted path from a sanitized basename derived from sandbox
    // name. v1 of the wizard treats the local .vsk as ephemeral (the next
    // step uploads it).
    if airgap_active(&app).await {
        return Err(airgap_blocked_err());
    }
    inject_cloud_envelope(&mut payload)?;
    inject_sandbox_oracle_config(&app, &mut payload)?;

    let sandbox_name = payload
        .get("spec")
        .and_then(|s| s.get("sandboxName"))
        .and_then(|v| v.as_str())
        .unwrap_or("sandbox");
    let basename = sanitize_sandbox_basename(sandbox_name);

    let app_data = app.path().app_data_dir().map_err(|_| ConnectionTestErr {
        code: -32603,
        message: "could not resolve app data dir for sandbox build".to_string(),
    })?;
    let builds_dir = app_data.join("sandbox-builds");
    std::fs::create_dir_all(&builds_dir).map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("could not create sandbox-builds dir: {}", e),
    })?;
    inject_expected_builds_dir(&app, &mut payload)?;
    // Append a timestamp so two distinct user-typed names that sanitize to
    // the same basename ("café" / "cafe" → both "cafe", or any reuse of the
    // same name across builds) never overwrite each other on disk. Format is
    // `<basename>-<unix-millis>.vsk` — monotonically increasing so the
    // newest build is the lexicographically-last entry in the directory
    // (helps diagnostics + future cleanup jobs).
    let stamp = chrono::Utc::now().timestamp_millis();
    let out_path = builds_dir.join(format!("{}-{}.vsk", basename, stamp));
    let out_path_str = out_path.to_string_lossy().into_owned();

    if let Some(spec) = payload.get_mut("spec").and_then(|s| s.as_object_mut()) {
        spec.insert("outPath".to_string(), Value::String(out_path_str));
    }

    call_sidecar(&app, "sandbox.build", payload).await
}

// Sprint D Onda D.1 — Command Window history + script reader.
//
// Three thin commands consumed by the renderer's Command Window REPL:
//   * `command_history_load`   — page through recent submitted lines
//   * `command_history_append` — record one submitted line after execution
//   * `command_script_read`    — read a `@file.sql` script from disk

use crate::persistence::command_history::{CommandHistoryEntry, LoadResult as CommandHistoryRaw};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryLoadResult {
    pub entries: Vec<CommandHistoryEntry>,
    pub inaccessible_count: usize,
    pub history_disabled: bool,
}

#[tauri::command]
pub async fn command_history_load(
    app: AppHandle,
    connection_id: String,
    limit: i64,
) -> Result<CommandHistoryLoadResult, String> {
    let svc = app.state::<ConnectionService>();
    let raw: CommandHistoryRaw = svc
        .command_history_load(&connection_id, limit)
        .map_err(|e| e.message)?;
    Ok(CommandHistoryLoadResult {
        entries: raw.entries,
        inaccessible_count: raw.inaccessible_count,
        history_disabled: raw.history_disabled,
    })
}

#[tauri::command]
pub async fn command_history_append(
    app: AppHandle,
    connection_id: String,
    command: String,
    origin: String,
    status: String,
    duration_ms: Option<i64>,
) -> Result<i64, String> {
    let svc = app.state::<ConnectionService>();
    svc.command_history_append(&connection_id, &command, &origin, &status, duration_ms)
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn command_history_clear_inaccessible(app: AppHandle) -> Result<i64, String> {
    let svc = app.state::<ConnectionService>();
    svc.command_history_clear_inaccessible()
        .map_err(|e| e.message)
}

const COMMAND_SCRIPT_MAX_BYTES: u64 = 1024 * 1024;

#[tauri::command]
pub async fn command_script_read(app: AppHandle, path: String) -> Result<String, String> {
    if path.is_empty() {
        return Err("path required".to_string());
    }
    // Reject any path containing parent-dir segments. We check the raw input
    // (before canonicalize) so a renderer cannot smuggle `..` past the user's
    // own scope-allow-list — the canonical form would silently flatten them.
    let raw = Path::new(&path);
    if raw
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path traversal segments ('..') are not allowed".to_string());
    }
    // Confine reads to the same user folders the renderer is already allowed
    // to browse (Documents, Desktop, Downloads, Home, app data/config).
    let canon = validate_user_path(&app, &path).map_err(|e| e.message)?;
    let meta = std::fs::metadata(&canon)
        .map_err(|e| format!("SP2-0310: unable to open file \"{path}\": {e}"))?;
    if !meta.is_file() {
        return Err(format!("SP2-0310: \"{path}\" is not a regular file"));
    }
    if meta.len() > COMMAND_SCRIPT_MAX_BYTES {
        return Err(format!(
            "script file is {} bytes, exceeds the 1 MiB limit",
            meta.len()
        ));
    }
    std::fs::read_to_string(&canon)
        .map_err(|e| format!("SP2-0310: unable to read file \"{path}\": {e}"))
}

// ── Item #1A — MViews, Synonyms, DB Links — T1A ──────────────────────────────

#[tauri::command]
pub async fn mview_details(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "mview.details",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn mview_refresh(
    app: AppHandle,
    owner: String,
    name: String,
    method: String,
    env: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "mview.refresh",
        json!({ "owner": owner, "name": name, "method": method, "env": env }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn synonym_details(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "synonym.details",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn objects_list_dblinks(
    app: AppHandle,
    owner: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "objects.list.dblinks",
        json!({ "owner": owner }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn object_ddl_dblink(
    app: AppHandle,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "object.ddl.dblink",
        json!({ "name": name }),
    )
    .await?;
    Ok(res)
}

// ── Item #1B — Directories, Queues — T1B.2 / T1B.3 ───────────────────────────

#[tauri::command]
pub async fn objects_list_directories(
    app: AppHandle,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "objects.list.directories", json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn directory_details(
    app: AppHandle,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "directory.details", json!({ "name": name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn objects_list_queues(
    app: AppHandle,
    owner: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "objects.list.queues", json!({ "owner": owner })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn queue_details(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "queue.details", json!({ "owner": owner, "name": name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn queue_ddl(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "queue.ddl", json!({ "owner": owner, "name": name })).await?;
    Ok(res)
}

// ── Item #1B T1B.1 — Scheduler Jobs ──────────────────────────────────────────

#[tauri::command]
pub async fn objects_list_scheduler_jobs(
    app: AppHandle,
    owner: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "objects.list.scheduler_jobs", json!({ "owner": owner })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_details(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.job.details", json!({ "owner": owner, "name": name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn legacy_job_details(
    app: AppHandle,
    job_id: i64,
    owner: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.job.details.legacy", json!({ "jobId": job_id, "owner": owner })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_ddl(
    app: AppHandle,
    owner: String,
    name: String,
    legacy: Option<bool>,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.job.ddl", json!({ "owner": owner, "name": name, "legacy": legacy })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_program_details(
    app: AppHandle,
    owner: String,
    program_name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.program.details", json!({ "owner": owner, "programName": program_name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_schedule_details(
    app: AppHandle,
    owner: String,
    schedule_name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.schedule.details", json!({ "owner": owner, "scheduleName": schedule_name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_priv_check(
    app: AppHandle,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.job.priv_check", json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_run(
    app: AppHandle,
    owner: String,
    name: String,
    confirmed_prod_run: Option<bool>,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "scheduler.job.run",
        json!({ "owner": owner, "name": name, "confirmedProdRun": confirmed_prod_run }),
    ).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_enable(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "scheduler.job.enable", json!({ "owner": owner, "name": name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn scheduler_job_disable(
    app: AppHandle,
    owner: String,
    name: String,
    confirmed_prod_disable: Option<bool>,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "scheduler.job.disable",
        json!({ "owner": owner, "name": name, "confirmedProdDisable": confirmed_prod_disable }),
    ).await?;
    Ok(res)
}

#[tauri::command]
pub async fn dbms_job_run(
    app: AppHandle,
    job_id: i64,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "dbms_job.run", json!({ "jobId": job_id })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn dbms_job_broken(
    app: AppHandle,
    job_id: i64,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "dbms_job.broken", json!({ "jobId": job_id })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn dbms_job_unbroken(
    app: AppHandle,
    job_id: i64,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "dbms_job.unbroken", json!({ "jobId": job_id })).await?;
    Ok(res)
}

// ── Item #1C T1C.1+T1C.2 — Users + Sessions ──────────────────────────────────

#[tauri::command]
pub async fn user_details(
    app: AppHandle,
    username: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "user.details", json!({ "username": username })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn user_profile_details(
    app: AppHandle,
    profile: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "user.profile.details", json!({ "profile": profile })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn user_quotas(
    app: AppHandle,
    username: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "user.quotas", json!({ "username": username })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn sessions_list_all(
    app: AppHandle,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "sessions.list.all", json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn session_sql_preview(
    app: AppHandle,
    sql_id: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "session.sql.preview", json!({ "sqlId": sql_id })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn session_priv_check(
    app: AppHandle,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "session.priv.check", json!({})).await?;
    Ok(res)
}

// ── Item #1C T1C.3+T1C.4 — Session Kill + Privileges ─────────────────────────

#[tauri::command]
pub async fn session_kill(
    app: AppHandle,
    sid: i64,
    serial: i64,
    confirmed_prod_kill: Option<bool>,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "session.kill",
        json!({ "sid": sid, "serial": serial, "confirmedProdKill": confirmed_prod_kill }),
    )
    .await?;
    Ok(res)
}

#[tauri::command]
pub async fn privileges_list(
    app: AppHandle,
    schema: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "privileges.list", json!({ "schema": schema })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn sessions_blocking_chain(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "sessions.blocking.chain", json!({})).await?;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Returns (entry_json_line, hmac) for use as the next prevHash.
    fn make_entry(key: &[u8], prev_hash: &str, ts: &str, sql: &str) -> (String, String) {
        let body = serde_json::json!({
            "connectionId": "c1",
            "elapsedMs": 5u64,
            "env": "dev",
            "errorCode": null,
            "errorMessage": null,
            "host": "localhost",
            "origin": "user_typed",
            "originDetail": null,
            "rowCount": 1u64,
            "source": "user",
            "sql": sql,
            "success": true,
            "ts": ts,
            "username": "test",
        });
        let body_str = body.to_string();
        let hmac = crate::audit::chain::compute_hmac(key, prev_hash, &body_str);
        let mut entry = body.as_object().unwrap().clone();
        entry.insert("prevHash".to_string(), Value::String(prev_hash.to_string()));
        entry.insert("hmac".to_string(), Value::String(hmac.clone()));
        (Value::Object(entry).to_string(), hmac)
    }

    fn legacy_entry(ts: &str, sql: &str) -> String {
        serde_json::json!({ "ts": ts, "sql": sql, "success": true }).to_string()
    }

    #[test]
    fn verify_nonexistent_path_returns_empty_ok() {
        let path = std::path::Path::new("/no/such/audit/file.jsonl");
        let result = verify_chain_file(path, &[0u8; 32]);
        assert!(result.ok);
        assert_eq!(result.checked, 0);
        assert_eq!(result.skipped_legacy, 0);
        assert_eq!(result.sub_chains, 0);
        assert!(result.broken_at.is_none());
    }

    #[test]
    fn verify_empty_file_returns_ok() {
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f).unwrap();
        let result = verify_chain_file(f.path(), &[0u8; 32]);
        assert!(result.ok);
        assert_eq!(result.checked, 0);
    }

    #[test]
    fn verify_single_valid_entry() {
        let key = vec![1u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line, _) = make_entry(&key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT 1 FROM DUAL");
        writeln!(f, "{line}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok, "expected ok");
        assert_eq!(result.checked, 1);
        assert_eq!(result.skipped_legacy, 0);
        assert_eq!(result.sub_chains, 1);
        assert!(result.broken_at.is_none());
    }

    #[test]
    fn verify_two_linked_entries() {
        let key = vec![2u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line1, hmac1) = make_entry(&key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT 1 FROM DUAL");
        let (line2, _) = make_entry(&key, &hmac1, "2026-05-11T10:00:01.000Z", "SELECT 2 FROM DUAL");
        writeln!(f, "{line1}").unwrap();
        writeln!(f, "{line2}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok, "expected ok");
        assert_eq!(result.checked, 2);
        assert_eq!(result.sub_chains, 1);
    }

    #[test]
    fn verify_legacy_entry_skipped() {
        let key = vec![3u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, "{}", legacy_entry("2026-05-11T10:00:00.000Z", "SELECT 1 FROM DUAL")).unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok, "legacy-only file should be ok");
        assert_eq!(result.skipped_legacy, 1);
        assert_eq!(result.checked, 0);
        assert_eq!(result.sub_chains, 0);
    }

    #[test]
    fn verify_mixed_legacy_and_chained() {
        let key = vec![4u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, "{}", legacy_entry("2026-05-11T09:59:00.000Z", "SELECT OLD FROM DUAL")).unwrap();
        let (line, _) = make_entry(&key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT NEW FROM DUAL");
        writeln!(f, "{line}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok);
        assert_eq!(result.skipped_legacy, 1);
        assert_eq!(result.checked, 1);
        assert_eq!(result.sub_chains, 1);
    }

    #[test]
    fn verify_tampered_body_detected() {
        let key = vec![5u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line, _) = make_entry(&key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT 1 FROM DUAL");
        let mut obj: serde_json::Map<String, Value> =
            serde_json::from_str::<Value>(&line).unwrap().as_object().unwrap().clone();
        obj.insert("sql".to_string(), Value::String("DROP TABLE employees".to_string()));
        let tampered = Value::Object(obj).to_string();
        writeln!(f, "{tampered}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(!result.ok, "tampered body must fail");
        assert_eq!(result.broken_at.as_ref().unwrap().reason, "hmac_mismatch");
    }

    #[test]
    fn verify_prev_hash_mismatch_detected() {
        let key = vec![6u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line1, _hmac1) = make_entry(&key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT 1");
        let (line2, _) = make_entry(&key, "deadbeef", "2026-05-11T10:00:01.000Z", "SELECT 2");
        writeln!(f, "{line1}").unwrap();
        writeln!(f, "{line2}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(!result.ok, "wrong prevHash must fail");
        assert_eq!(result.broken_at.as_ref().unwrap().reason, "prev_hash_mismatch");
        assert_eq!(result.broken_at.as_ref().unwrap().index, 1);
    }

    #[test]
    fn verify_two_sub_chains_ok() {
        let key = vec![7u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line1, _) = make_entry(&key, "genesis", "2026-05-11T08:00:00.000Z", "SELECT 1");
        let (line2, _) = make_entry(&key, "genesis", "2026-05-11T09:00:00.000Z", "SELECT 2");
        writeln!(f, "{line1}").unwrap();
        writeln!(f, "{line2}").unwrap();
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok, "two sub-chains must still be ok");
        assert_eq!(result.sub_chains, 2);
        assert_eq!(result.checked, 2);
    }

    #[test]
    fn verify_long_chain_ok() {
        let key = vec![8u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let mut prev = "genesis".to_string();
        for i in 0..50 {
            let ts = format!("2026-05-11T10:{:02}:00.000Z", i);
            let sql = format!("SELECT {i} FROM DUAL");
            let (line, hmac) = make_entry(&key, &prev, &ts, &sql);
            writeln!(f, "{line}").unwrap();
            prev = hmac;
        }
        let result = verify_chain_file(f.path(), &key);
        assert!(result.ok);
        assert_eq!(result.checked, 50);
        assert_eq!(result.sub_chains, 1);
    }

    #[test]
    fn verify_wrong_key_detects_hmac_mismatch() {
        let write_key = vec![9u8; 32];
        let verify_key = vec![10u8; 32];
        let mut f = NamedTempFile::new().unwrap();
        let (line, _) = make_entry(&write_key, "genesis", "2026-05-11T10:00:00.000Z", "SELECT 1");
        writeln!(f, "{line}").unwrap();
        let result = verify_chain_file(f.path(), &verify_key);
        assert!(!result.ok, "wrong verify key must fail");
        assert_eq!(result.broken_at.as_ref().unwrap().reason, "hmac_mismatch");
    }

    #[tokio::test]
    async fn rate_limit_blocks_second_immediate_call() {
        let rl = VerifyChainRateLimit {
            last_call: tokio::sync::Mutex::new(None),
        };
        {
            let mut last = rl.last_call.lock().await;
            assert!(last.is_none());
            *last = Some(std::time::Instant::now());
        }
        {
            let last = rl.last_call.lock().await;
            let elapsed = last.unwrap().elapsed();
            assert!(
                elapsed < VERIFY_MIN_INTERVAL,
                "elapsed {elapsed:?} should be less than {VERIFY_MIN_INTERVAL:?}"
            );
        }
    }

    #[tokio::test]
    async fn rate_limit_allows_after_expiry() {
        let rl = VerifyChainRateLimit {
            last_call: tokio::sync::Mutex::new(None),
        };
        {
            let mut last = rl.last_call.lock().await;
            *last = Some(
                std::time::Instant::now()
                    .checked_sub(std::time::Duration::from_secs(61))
                    .unwrap(),
            );
        }
        let last = rl.last_call.lock().await;
        let elapsed = last.unwrap().elapsed();
        assert!(
            elapsed >= VERIFY_MIN_INTERVAL,
            "elapsed {elapsed:?} should be >= {VERIFY_MIN_INTERVAL:?}"
        );
    }
}
