# Tray Icon — Design Spec

**Date:** 2026-04-23  
**Status:** Approved

---

## Overview

Add a system tray icon to Veesker that acts as a quick launcher, connection status indicator, and shortcut hub — similar to Docker Desktop's tray behavior.

---

## Architecture

The sidecar (Bun/TypeScript) is the source of truth for connection state. When any connection changes state, the sidecar emits a `connection.state_changed` JSON-RPC event over stdout. The Rust layer (`lib.rs` / `tray.rs`) listens, updates the tray icon and rebuilds the context menu. The frontend is not involved in tray state management — this keeps the tray functional even when the window is hidden.

```
Sidecar (Bun) ── connection.state_changed ──▶ Rust ── updates ──▶ Tray icon + menu
Rust ── Tauri event ──▶ Frontend (only when window is open)
```

### Files changed

| File | Change |
|---|---|
| `sidecar/src/oracle.ts` | Emit `connection.state_changed` on connect/disconnect |
| `src-tauri/src/lib.rs` | Create tray in `setup()`, route sidecar events to tray |
| `src-tauri/src/tray.rs` | New module: tray icon state machine and menu builder |
| `src-tauri/Cargo.toml` | Add `tray-icon` feature to Tauri dependency |
| `src-tauri/icons/` | Add 4 tray PNG variants derived from existing `32x32.png` |

---

## Tray Icon States

Global state = worst state across all connections.

| State | Icon file | Indicator | Trigger |
|---|---|---|---|
| Idle | `tray-idle.png` | No overlay | No connections active |
| Connecting | `tray-connecting.png` | Blue dot | Any connection in progress |
| Connected | `tray-connected.png` | Orange dot | ≥1 connection active, none errored |
| Error | `tray-error.png` | Red dot | Any connection errored |

Icon base: existing `src-tauri/icons/32x32.png` (sheep). Four PNG variants add a 10px colored dot in the lower-right corner.

---

## Context Menu (right-click)

```
CONNECTIONS
  ● PROD_DB          [Disconnect]
  ○ DEV_DB           [Connect]
─────────────────────────────────
ACTIONS
  Nova Query
  Schema Browser
─────────────────────────────────
  Abrir Veesker
  Sair
```

- Section headers are disabled labels (not clickable)
- "Connect" / "Disconnect" sends a command to the sidecar
- "Nova Query" and "Schema Browser" open the window focused on those views
- "Abrir Veesker" brings the window to focus (or opens if hidden)
- "Sair" quits immediately without a dialog
- If no connections are saved: show a single disabled item "Nenhuma conexão cadastrada"

---

## Sidecar Protocol

New outbound event emitted by the sidecar:

```json
{
  "method": "connection.state_changed",
  "params": {
    "connections": [
      { "name": "PROD_DB", "state": "connected" },
      { "name": "DEV_DB",  "state": "idle" }
    ]
  }
}
```

States: `idle` | `connecting` | `connected` | `error`

---

## Close Window Behavior

The Tauri `close-requested` window event is intercepted. Instead of quitting, a native dialog is shown:

> **Fechar o Veesker?**  
> O app continuará rodando em segundo plano.  
> [ Encerrar ]  [ **Minimizar para o Tray** ]

"Minimizar para o Tray" is the default action (Enter key). Clicking it hides the window; the tray remains active. "Encerrar" quits the app and removes the tray icon.

---

## Edge Cases

| Situation | Behavior |
|---|---|
| Double-click tray icon | Show/focus the main window |
| Window already open, click "Abrir Veesker" | Bring window to foreground |
| Sidecar crash | Icon switches to error state |
| "Sair" in tray menu | App quits immediately, no dialog |
| Connect via tray menu | Sends command to sidecar; icon animates to connecting |

---

## Out of Scope

- Native toast notifications (can be added later)
- Animated "pulsing" icon during connecting (static blue icon instead)
- Windows autostart on login
