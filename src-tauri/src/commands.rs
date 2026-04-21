use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use tauri::Manager;

use crate::sidecar::{ensure, SidecarState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub password: String,
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

    let result = sidecar
        .call(
            "connection.test",
            json!({
                "host": config.host,
                "port": config.port,
                "serviceName": config.service_name,
                "username": config.username,
                "password": config.password,
            }),
        )
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
