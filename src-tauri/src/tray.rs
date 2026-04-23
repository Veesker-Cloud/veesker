use std::sync::Mutex;

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
        let states = vec![TrayState::Connected, TrayState::Error, TrayState::Connecting];
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
        for state in [TrayState::Idle, TrayState::Connecting, TrayState::Connected, TrayState::Error] {
            let _icon = composite_icon(base, &state);
        }
    }
}
