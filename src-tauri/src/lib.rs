mod commands;
mod persistence;
mod sidecar;

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;
use tokio::sync::Mutex;

use crate::persistence::connections::ConnectionService;
use crate::sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .menu(|app| {
            let about = SubmenuBuilder::new(app, "Veesker")
                .about(Some(
                    AboutMetadataBuilder::new()
                        .name(Some("Veesker"))
                        .comments(Some("Oracle 23ai Vector Search Studio"))
                        .build(),
                ))
                .separator()
                .quit()
                .build()?;

            let file = SubmenuBuilder::new(app, "File")
                .item(&MenuItemBuilder::with_id("new_connection", "New Connection").accelerator("CmdOrCtrl+N").build(app)?)
                .separator()
                .close_window()
                .build()?;

            let edit = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            MenuBuilder::new(app).items(&[&about, &file, &edit]).build()
        })
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app data dir");
            let db_path = app_data.join("veesker.db");
            let wallets_root = app_data.join("wallets");
            let svc = ConnectionService::open(&db_path, wallets_root)
                .expect("open connection store");
            app.manage(svc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection_test,
            commands::connection_list,
            commands::connection_get,
            commands::connection_save,
            commands::connection_delete,
            commands::wallet_inspect,
            commands::workspace_open,
            commands::workspace_close,
            commands::schema_list,
            commands::objects_list,
            commands::table_describe,
            commands::table_count_rows,
            commands::table_related,
            commands::query_execute,
            commands::query_cancel,
            commands::history_list,
            commands::history_save,
            commands::history_clear,
            commands::compile_errors_get,
            commands::object_ddl_get,
            commands::object_dataflow_get,
            commands::objects_list_plsql,
            commands::objects_search,
            commands::schema_kind_counts,
            commands::vector_search,
            commands::vector_tables_in_schema,
            commands::vector_index_list,
            commands::vector_index_create,
            commands::vector_index_drop,
            commands::ai_chat,
            commands::embed_count_pending,
            commands::embed_batch,
            commands::ai_key_save,
            commands::ai_key_get,
            commands::connection_commit,
            commands::connection_rollback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
