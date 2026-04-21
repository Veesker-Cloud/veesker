mod commands;
mod persistence;
mod sidecar;

use tokio::sync::Mutex;

use crate::sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![commands::connection_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
