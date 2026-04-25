use crate::persistence::connections::{ConnectionMeta, ConnectionService};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::{AppHandle, Manager};

// ── Public state types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrayState {
    Idle,
    Connecting,
    Connected,
    Error,
}

/// Tracks which connection is currently active (name shown in tray menu).
pub struct ActiveConnection(pub tokio::sync::Mutex<Option<String>>);

/// Keeps the TrayIcon alive; must be stored in managed state.
pub struct TrayHandle(pub Mutex<Option<tauri::tray::TrayIcon<tauri::Wry>>>);

/// Returns the most severe state from a list. Empty list → Idle.
/// Kept for future multi-window aggregation — covered by tests in this module.
#[allow(dead_code)]
pub fn worst_state(states: &[TrayState]) -> TrayState {
    states.iter().max().cloned().unwrap_or(TrayState::Idle)
}

/// Composites the base sheep PNG with a colored status dot for the given state.
/// Returns a Tauri Image ready for use as a tray icon.
pub fn composite_icon(base_png: &[u8], state: &TrayState) -> tauri::image::Image<'static> {
    let mut img = image::load_from_memory(base_png)
        .expect("base icon is valid PNG")
        .into_rgba8();
    let (w, h) = img.dimensions();

    let dot_color: Option<image::Rgba<u8>> = match state {
        TrayState::Idle => None,
        TrayState::Connecting => Some(image::Rgba([59, 130, 246, 255])),
        TrayState::Connected => Some(image::Rgba([249, 115, 22, 255])),
        TrayState::Error => Some(image::Rgba([239, 68, 68, 255])),
    };

    if let Some(color) = dot_color {
        // 8px circle at lower-right corner
        let cx = (w - 5) as f32;
        let cy = (h - 5) as f32;
        let r = 4.0f32;
        for y in (h.saturating_sub(12))..h {
            for x in (w.saturating_sub(12))..w {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                if dx * dx + dy * dy <= r * r {
                    img.put_pixel(x, y, color);
                }
            }
        }
    }

    let (width, height) = img.dimensions();
    let rgba_pixels = img.into_raw();
    tauri::image::Image::new_owned(rgba_pixels, width, height)
}

/// Builds the right-click context menu.
/// `active_name` is the display name of the currently connected connection, if any.
pub fn build_tray_menu(
    app: &AppHandle,
    active_name: Option<&str>,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let connections = app.state::<ConnectionService>().list().unwrap_or_default();

    let connections_label = MenuItemBuilder::with_id("connections_label", "CONNECTIONS")
        .enabled(false)
        .build(app)?;

    let mut conn_items: Vec<tauri::menu::MenuItem<tauri::Wry>> = Vec::new();

    if connections.is_empty() {
        let empty = MenuItemBuilder::with_id("no_connections", "No connections saved")
            .enabled(false)
            .build(app)?;
        conn_items.push(empty);
    } else {
        for meta in &connections {
            let (id, name) = match meta {
                ConnectionMeta::Basic { id, name, .. } => (id.as_str(), name.as_str()),
                ConnectionMeta::Wallet { id, name, .. } => (id.as_str(), name.as_str()),
            };
            let is_active = active_name.map(|n| n == name).unwrap_or(false);
            let (indicator, action_label, item_id) = if is_active {
                ("●", "Disconnect", format!("disconnect_{id}"))
            } else {
                ("○", "Open →", format!("connect_{id}"))
            };
            let label = format!("{indicator} {name}    {action_label}");
            let item = MenuItemBuilder::with_id(item_id, label).build(app)?;
            conn_items.push(item);
        }
    }

    let actions_label = MenuItemBuilder::with_id("actions_label", "ACTIONS")
        .enabled(false)
        .build(app)?;
    let new_query = MenuItemBuilder::with_id("new_query", "New Query").build(app)?;
    let schema_browser = MenuItemBuilder::with_id("schema_browser", "Schema Browser").build(app)?;
    let open_app = MenuItemBuilder::with_id("open_app", "Open Veesker").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let mut builder = MenuBuilder::new(app).item(&connections_label);
    for item in &conn_items {
        builder = builder.item(item);
    }
    builder
        .item(&sep1)
        .item(&actions_label)
        .item(&new_query)
        .item(&schema_browser)
        .item(&sep2)
        .item(&open_app)
        .item(&sep3)
        .item(&quit)
        .build()
}

pub const BASE_ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// Recomputes the tray icon and menu based on current state.
/// Call this after any connection state change.
pub async fn update_tray(app: &AppHandle, state: TrayState) {
    let active_name = app.state::<ActiveConnection>().0.lock().await.clone();

    let icon = composite_icon(BASE_ICON, &state);

    let menu = match build_tray_menu(app, active_name.as_deref()) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("tray: failed to build menu: {e}");
            return;
        }
    };

    let handle = app.state::<TrayHandle>();
    let guard = handle.0.lock().unwrap();
    if let Some(tray) = guard.as_ref() {
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_menu(Some(menu));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worst_state_empty_is_idle() {
        let states: Vec<TrayState> = vec![];
        assert_eq!(worst_state(&states), TrayState::Idle);
    }

    #[test]
    fn worst_state_error_wins() {
        let states = vec![
            TrayState::Connected,
            TrayState::Error,
            TrayState::Connecting,
        ];
        assert_eq!(worst_state(&states), TrayState::Error);
    }

    #[test]
    fn worst_state_connected_over_idle() {
        let states = vec![TrayState::Idle, TrayState::Connected];
        assert_eq!(worst_state(&states), TrayState::Connected);
    }

    #[test]
    fn composite_icon_does_not_panic_for_all_states() {
        let base = include_bytes!("../icons/32x32.png");
        for state in [
            TrayState::Idle,
            TrayState::Connecting,
            TrayState::Connected,
            TrayState::Error,
        ] {
            let _icon = composite_icon(base, &state);
        }
    }
}
