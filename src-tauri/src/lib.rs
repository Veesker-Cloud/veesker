mod commands;
mod persistence;
mod sidecar;
mod tray;

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::Mutex;

use crate::persistence::connections::ConnectionService;
use crate::sidecar::SidecarState;
use crate::tray::{ActiveConnection, TrayHandle, TrayState};

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
        .manage(TrayHandle(std::sync::Mutex::new(None)))
        .manage(ActiveConnection(tokio::sync::Mutex::new(None)))
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app data dir");
            let db_path = app_data.join("veesker.db");
            let wallets_root = app_data.join("wallets");
            let svc = ConnectionService::open(&db_path, wallets_root)
                .expect("open connection store");
            app.manage(svc);

            let base_icon = crate::tray::composite_icon(crate::tray::BASE_ICON, &TrayState::Idle);
            let initial_menu = crate::tray::build_tray_menu(app.handle(), None)?;

            let tray_icon = TrayIconBuilder::new()
                .icon(base_icon)
                .menu(&initial_menu)
                .tooltip("Veesker")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref().to_string();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        match id.as_str() {
                            "quit" => app_clone.exit(0),
                            "open_app" | "new_query" | "schema_browser" => {
                                if let Some(win) = app_clone.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                            id if id.starts_with("disconnect_") => {
                                let _ = crate::sidecar::call_raw(
                                    &app_clone,
                                    "workspace.close",
                                    serde_json::json!({}),
                                )
                                .await;
                                *app_clone.state::<ActiveConnection>().0.lock().await = None;
                                crate::tray::update_tray(&app_clone, TrayState::Idle).await;
                            }
                            _ => {}
                        }
                    });
                })
                .build(app.handle())?;

            *app.state::<TrayHandle>().0.lock().unwrap() = Some(tray_icon);

            let win = app.get_webview_window("main").expect("main window");
            let app_handle = app.handle().clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let app2 = app_handle.clone();
                    app_handle
                        .dialog()
                        .message("O app continuará rodando em segundo plano.")
                        .title("Fechar o Veesker?")
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Minimizar para o Tray".into(),
                            "Encerrar".into(),
                        ))
                        .show(move |minimize| {
                            if minimize {
                                if let Some(win) = app2.get_webview_window("main") {
                                    let _ = win.hide();
                                }
                            } else {
                                app2.exit(0);
                            }
                        });
                }
            });

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
            commands::explain_plan_get,
            commands::proc_describe,
            commands::proc_execute,
            commands::chart_configure,
            commands::chart_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
