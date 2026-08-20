// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

mod audit;
mod commands;
mod crypto;
mod persistence;
mod pii;
mod sidecar;
mod terminal;
mod tray;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::Mutex;

use crate::commands::{ActiveSessionEnv, AirGapState, AuditChainState, PsdpmState, VerifyChainRateLimit};
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .menu(|app| {
            let about_item = MenuItemBuilder::with_id("open_about", "About Veesker").build(app)?;
            let help_item = MenuItemBuilder::with_id("open_help", "Help")
                .accelerator("F1")
                .build(app)?;
            let plugins_item =
                MenuItemBuilder::with_id("open_plugins", "Plugins & License…").build(app)?;

            let about = SubmenuBuilder::new(app, "Veesker")
                .item(&about_item)
                .separator()
                .item(&plugins_item)
                .item(&help_item)
                .separator()
                .quit()
                .build()?;

            let file = SubmenuBuilder::new(app, "File")
                .item(
                    &MenuItemBuilder::with_id("new_connection", "New Connection")
                        .accelerator("CmdOrCtrl+N")
                        .build(app)?,
                )
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
        .manage(terminal::new_store())
        .manage(SidecarState(Mutex::new(None)))
        .manage(TrayHandle(std::sync::Mutex::new(None)))
        .manage(ActiveConnection(tokio::sync::Mutex::new(None)))
        .manage(ActiveSessionEnv(tokio::sync::Mutex::new(None)))
        .manage(AirGapState(tokio::sync::Mutex::new(false)))
        // L2.1 PSDPM (PL/SQL Developer Parity Mode) — initially off; flipped
        // to the active connection's psdpm_mode at workspace_open time.
        .manage(PsdpmState(tokio::sync::Mutex::new(false)))
        // Single global mutex serializes audit chain writes.
        // Acceptable while audit is sequential (1 statement at a time per
        // active session). Multi-connection parallel execution may require
        // per-connection chains — tracked for Item #5 (multi-conn).
        .manage(AuditChainState(tokio::sync::Mutex::new(
            "genesis".to_string(),
        )))
        .manage(VerifyChainRateLimit {
            last_call: tokio::sync::Mutex::new(None),
        })
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app data dir");
            let db_path = app_data.join("veesker.db");
            let wallets_root = app_data.join("wallets");
            let svc =
                ConnectionService::open(&db_path, wallets_root).expect("open connection store");
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
                            "quit" => {
                                let _ = crate::sidecar::call_raw(
                                    &app_clone,
                                    "debug.stop",
                                    serde_json::json!({}),
                                )
                                .await;
                                let _ = crate::sidecar::call_raw(
                                    &app_clone,
                                    "workspace.close",
                                    serde_json::json!({}),
                                )
                                .await;
                                app_clone.exit(0);
                            }
                            "open_app" => {
                                if let Some(win) = app_clone.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                            id if id.starts_with("connect_") => {
                                if let Some(win) = app_clone.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                                let conn_id = id.strip_prefix("connect_").unwrap_or("").to_string();
                                let _ = app_clone.emit("tray-open-connection", &conn_id);
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
                                let _ = app_clone.emit("tray-disconnect", ());
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
                        .message("The app will keep running in the background.")
                        .title("Close Veesker?")
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Minimize to Tray".into(),
                            "Quit".into(),
                        ))
                        .show(move |minimize| {
                            if minimize {
                                if let Some(win) = app2.get_webview_window("main") {
                                    let _ = win.hide();
                                }
                            } else {
                                let app3 = app2.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = crate::sidecar::call_raw(
                                        &app3,
                                        "debug.stop",
                                        serde_json::json!({}),
                                    )
                                    .await;
                                    let _ = crate::sidecar::call_raw(
                                        &app3,
                                        "workspace.close",
                                        serde_json::json!({}),
                                    )
                                    .await;
                                    app3.exit(0);
                                });
                            }
                        });
                }
            });

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "open_about" => {
                    let _ = app.emit("open-about", ());
                }
                "open_help" => {
                    let _ = app.emit("open-help", ());
                }
                "open_plugins" => {
                    let _ = app.emit("open-plugins", ());
                }
                "new_connection" => {
                    let _ = app.emit("menu-new-connection", ());
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection_test,
            commands::connection_list,
            commands::connection_get,
            commands::connection_save,
            commands::connection_delete,
            commands::connection_sandbox_oracle_check,
            commands::wallet_inspect,
            commands::workspace_open,
            commands::workspace_close,
            commands::psdpm_active,
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
            commands::command_history_load,
            commands::command_history_append,
            commands::command_history_clear_inaccessible,
            commands::command_script_read,
            commands::audit_recent,
            commands::audit_verify_chain,
            commands::compile_errors_get,
            commands::object_ddl_get,
            commands::object_dataflow_get,
            commands::vision_graph,
            commands::objects_list_plsql,
            commands::objects_search,
            commands::schema_kind_counts,
            commands::vector_search,
            commands::vector_tables_in_schema,
            commands::vector_index_list,
            commands::vector_index_create,
            commands::vector_index_drop,
            commands::ai_chat,
            commands::ai_suggest_endpoint,
            commands::embed_count_pending,
            commands::embed_batch,
            commands::ai_key_save,
            commands::ai_key_get,
            commands::connection_commit,
            commands::connection_rollback,
            commands::connection_tx_state,
            commands::tx_keep_open_record,
            commands::tx_keep_open_clear,
            commands::tx_modal_audit,
            commands::driver_mode,
            commands::explain_plan_get,
            commands::proc_describe,
            commands::proc_execute,
            commands::flow_trace_proc,
            commands::flow_trace_sql,
            commands::chart_configure,
            commands::chart_reset,
            commands::debug_open,
            commands::debug_get_source,
            commands::debug_start,
            commands::debug_stop,
            commands::debug_step_into,
            commands::debug_step_over,
            commands::debug_step_out,
            commands::debug_continue,
            commands::debug_set_breakpoint,
            commands::debug_remove_breakpoint,
            commands::debug_get_values,
            commands::debug_get_call_stack,
            commands::debug_run,
            commands::ords_detect,
            commands::ords_modules_list,
            commands::ords_module_get,
            commands::ords_enable_schema,
            commands::ords_module_export_sql,
            commands::ords_roles_list,
            commands::ords_generate_sql,
            commands::ords_apply,
            commands::ords_test_http,
            commands::ords_clients_list,
            commands::ords_clients_create,
            commands::ords_clients_revoke,
            commands::apex_detect,
            commands::apex_workspaces_list,
            commands::apex_applications_list,
            commands::apex_pages_list,
            commands::dml_preview,
            commands::unsafe_dml_confirm,
            commands::ddl_confirm,
            commands::ddl_unlock,
            commands::audit_ddl_event,
            commands::perf_stats,
            commands::object_version_capture,
            commands::object_version_list,
            commands::object_version_diff,
            commands::object_version_load,
            commands::object_version_label,
            commands::object_version_set_remote,
            commands::object_version_push,
            commands::object_version_get_remote,
            commands::auth_token_get,
            commands::auth_token_set,
            commands::auth_token_clear,
            commands::cloud_api_get,
            commands::cloud_api_post,
            commands::sandbox_ensure_keypair,
            commands::sandbox_publish,
            commands::sandbox_republish,
            commands::sandbox_pull,
            commands::sandbox_list,
            commands::sandbox_grant,
            commands::sandbox_revoke,
            commands::sandbox_delete,
            commands::sandbox_open,
            commands::sandbox_query,
            commands::sandbox_close,
            commands::sandbox_list_cached,
            commands::sandbox_leave,
            commands::sandbox_mark_seen,
            commands::sandbox_list_last_seen,
            commands::sandbox_list_schema_tables,
            commands::sandbox_compute_fk_closure,
            commands::sandbox_discover_plsql,
            commands::sandbox_build_dry_run,
            commands::sandbox_build,
            commands::session_self,
            commands::ai_approval_resolve,
            commands::confirm_rollback_tx,
            commands::mview_details,
            commands::mview_refresh,
            commands::synonym_details,
            commands::objects_list_dblinks,
            commands::object_ddl_dblink,
            commands::objects_list_directories,
            commands::directory_details,
            commands::objects_list_queues,
            commands::queue_details,
            commands::queue_ddl,
            commands::objects_list_scheduler_jobs,
            commands::scheduler_job_details,
            commands::legacy_job_details,
            commands::scheduler_job_ddl,
            commands::scheduler_program_details,
            commands::scheduler_schedule_details,
            commands::scheduler_job_priv_check,
            commands::scheduler_job_run,
            commands::scheduler_job_enable,
            commands::scheduler_job_disable,
            commands::dbms_job_run,
            commands::dbms_job_broken,
            commands::dbms_job_unbroken,
            commands::user_details,
            commands::user_profile_details,
            commands::user_quotas,
            commands::sessions_list_all,
            commands::session_sql_preview,
            commands::session_priv_check,
            commands::session_kill,
            commands::privileges_list,
            commands::sessions_blocking_chain,
            terminal::terminal_create,
            terminal::terminal_confirm_session,
            terminal::terminal_revoke_session,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
