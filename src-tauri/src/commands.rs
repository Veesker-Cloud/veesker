use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri::Manager;

use crate::sidecar::{ensure, SidecarState};

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

#[tauri::command]
pub async fn connection_list(app: AppHandle) -> Result<Vec<ConnectionMeta>, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.list()
}

#[tauri::command]
pub async fn connection_get(
    app: AppHandle,
    id: String,
) -> Result<ConnectionFull, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.get(&id)
}

#[tauri::command]
pub async fn connection_save(
    app: AppHandle,
    input: ConnectionInput,
) -> Result<ConnectionMeta, ConnectionError> {
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
    let svc = app.state::<ConnectionService>();
    svc.inspect_wallet(&zip_path)
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

async fn call_sidecar(app: &AppHandle, method: &str, params: Value) -> Result<Value, ConnectionTestErr> {
    if let Err(err) = ensure(app).await {
        return Err(ConnectionTestErr { code: -32003, message: err });
    }
    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");
    sidecar.call(method, params).await.map_err(|e| ConnectionTestErr {
        code: e.code,
        message: e.message,
    })
}

fn map_err(e: ConnectionError) -> ConnectionTestErr {
    ConnectionTestErr { code: e.code, message: e.message }
}

#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    connection_id: String,
) -> Result<WorkspaceInfo, ConnectionTestErr> {
    let params = {
        let svc = app.state::<ConnectionService>();
        svc.sidecar_params(&connection_id).map_err(map_err)?
    };
    let res = call_sidecar(&app, "workspace.open", params).await?;
    let server_version = res
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("Oracle (unknown)")
        .to_string();
    let current_schema = res
        .get("currentSchema")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(WorkspaceInfo { server_version, current_schema })
}

#[tauri::command]
pub async fn workspace_close(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "workspace.close", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn schema_list(app: AppHandle) -> Result<Vec<SchemaRow>, ConnectionTestErr> {
    let res = call_sidecar(&app, "schema.list", json!({})).await?;
    let arr = res.get("schemas").and_then(|v| v.as_array()).cloned().unwrap_or_default();
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
    let arr = res.get("objects").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| Some(ObjectRef { name: v.get("name")?.as_str()?.to_string() }))
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: i64,
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn query_execute(
    app: AppHandle,
    sql: String,
) -> Result<QueryResult, ConnectionTestErr> {
    let res = call_sidecar(&app, "query.execute", json!({ "sql": sql })).await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode query.execute: {e}"),
    })
}
