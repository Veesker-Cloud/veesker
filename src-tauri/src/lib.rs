mod commands;
mod persistence;
mod sidecar;

use tauri::Manager;
use tokio::sync::Mutex;

use crate::persistence::connections::ConnectionService;
use crate::sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .join("veesker.db");
            let svc = ConnectionService::open(&db_path).expect("open connection store");
            app.manage(svc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection_test,
            commands::connection_list,
            commands::connection_get,
            commands::connection_save,
            commands::connection_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
