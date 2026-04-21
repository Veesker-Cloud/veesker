# Connection Persistence MVP2 — Spec

> Phase 2 of Veesker. Builds on `2026-04-20-connection-manager-mvp1.md`. Adds saved connections so the user stops retyping credentials every session.

## Goal

Save Oracle connection profiles (everything except the password) to a local SQLite file, store passwords in the OS keychain, and let the user list, create, edit, delete, and test them from a saved-connections landing page.

## In scope

- A `connections` table in a local SQLite database under Tauri's app data dir
- Password storage in the OS keychain (macOS Keychain on this milestone; `keyring` crate gives Linux/Windows for free later)
- Tauri commands: `connection_list`, `connection_get`, `connection_save`, `connection_delete`. `connection_test` from MVP1 is unchanged
- A landing page (`/`) that lists saved connections with edit/delete actions and a "+ New connection" button
- A reusable connection form used by `/connections/new` and `/connections/[id]/edit`, with **Test**, **Save**, **Cancel**

## Out of scope (later phases)

- Wallet-based auth (Phase 2 — Wallet support; will add an `auth_type` column via migration)
- An "active connection" concept / status bar (arrives with the schema browser in Phase 3)
- Search/filter, tags/colors, import/export, sync between machines
- Connection pooling

## Architecture

```
┌──────────────────┐         ┌──────────────────────┐         ┌──────────────┐
│ Svelte routes    │  invoke │ Tauri commands       │  calls  │ store.rs     │
│  /               │ ──────▶ │  connection_list     │ ──────▶ │  rusqlite    │
│  /connections/   │         │  connection_get      │         │  CRUD        │
│   new, [id]/edit │         │  connection_save     │         └──────┬───────┘
└──────────────────┘         │  connection_delete   │                │
                             │  connection_test     │ ──┐            ▼
                             └──────────────────────┘   │     veesker.db (SQLite)
                                                        │
                                                        │     ┌────────────────┐
                                                        └───▶ │ keyring crate  │
                                                              │ → OS Keychain  │
                                                              └────────────────┘
                                                        (existing sidecar pipeline
                                                         from MVP1 unchanged)
```

- All persistence happens in the Tauri Rust process. The sidecar is unaware of saved connections — it still receives one-shot `connection.test` calls with explicit creds.
- The Svelte frontend never touches SQLite or keychain directly; it only invokes Tauri commands.

## Data model

```sql
CREATE TABLE IF NOT EXISTS connections (
  id           TEXT PRIMARY KEY,    -- uuid v4
  name         TEXT NOT NULL UNIQUE,
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  username     TEXT NOT NULL,
  created_at   TEXT NOT NULL,       -- ISO 8601 UTC
  updated_at   TEXT NOT NULL
);
```

Single up-migration runs unconditionally on app start (idempotent `IF NOT EXISTS`). A simple `schema_version` table is **not** added in this phase — Phase 2 (Wallet) introduces the migration framework when it actually needs the second migration.

**Keychain mapping:** `service = "veesker"`, `account = "connection:{uuid}"`. The uuid (not the user-visible name) keys the keychain entry so renames don't break the link and deletes don't leak.

## Tauri command surface

```rust
// All return Result<T, ConnectionError>; ConnectionError serialises as
// { code: i32, message: String } so the frontend can pattern-match.

#[derive(Serialize)]
struct ConnectionMeta {     // safe to render in lists — no secret
  id: String, name: String,
  host: String, port: u16, service_name: String, username: String,
  created_at: String, updated_at: String,
}

#[derive(Serialize)]
struct ConnectionFull {     // includes password for the edit form
  meta: ConnectionMeta,
  password: String,         // empty string if keychain entry missing
  password_missing: bool,   // true ⇒ UI shows "Re-enter password" banner
}

#[derive(Deserialize)]
struct ConnectionInput {
  id: Option<String>,       // None ⇒ create, Some ⇒ update
  name: String, host: String, port: u16, service_name: String,
  username: String, password: String,
}

connection_list() -> Vec<ConnectionMeta>
connection_get(id: String) -> ConnectionFull
connection_save(input: ConnectionInput) -> ConnectionMeta
connection_delete(id: String) -> ()
```

`connection_save`:
- Validates `name` is non-empty and unique (case-insensitive). Returns `ConnectionError { code: 409, ... }` on duplicate.
- On create: generates uuid, sets `created_at = updated_at = now()`. Inserts row. Writes password to keychain (`set_password`).
- On update: bumps `updated_at`. Updates row by id. Overwrites keychain entry. If the row's `id` is unknown returns `404`.

`connection_delete`:
- Removes the row, then attempts to delete the keychain entry. Keychain deletion failure is logged but not propagated (the row is already gone — the entry is now an orphan we'll clean up if we ever see a stale id).

## Frontend routes

```
/                            ← landing
  • Header: brand
  • Empty state: "No saved connections yet" + big "+ New connection" CTA
  • Populated state: list of cards
       ┌─────────────────────────────────────────────────┐
       │ Production Lab                          [edit] [del] │
       │ pdbadmin@oracle-prod:1521/FREEPDB1                  │
       └─────────────────────────────────────────────────┘
  • Floating "+ New connection" button (visible in both states)

/connections/new             ← create form
/connections/[id]/edit       ← edit form (pre-filled via connection_get)
```

Both form routes render the same `<ConnectionForm>` component with: name (new field — required, unique), host, port, service name, username, password. Buttons: **Test** (calls existing `connection_test`, doesn't save) · **Save** (creates or updates, then redirects to `/`) · **Cancel** (back to `/`).

Delete uses `confirm("Delete \"{name}\"?")` — native dialog is fine for MVP2.

## Error handling

| Failure                              | Surface                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| Duplicate name on save               | Inline error under name field: "Name already in use"       |
| Keychain entry missing on edit       | Banner above form: "Password not found — please re-enter"  |
| `connection_get` for unknown id      | Redirect to `/` with toast: "Connection not found"         |
| SQLite open/migration failure        | Fatal: log to stderr, app shows blocking error screen      |
| Keychain write/read failure (other)  | Toast with the OS error message, form stays open           |

## Tech decisions

- **Storage:** `rusqlite` (not `tauri-plugin-sql`). Keeps all SQL in Rust where it can be unit-tested with an in-memory DB; frontend only sees typed commands.
- **DB connection:** single connection wrapped in `tokio::sync::Mutex`, held in a `tauri::State`. Connections are short-lived enough that one mutex is fine.
- **Keychain:** `keyring = "3"`. Native macOS Keychain on this build, automatic Linux/Windows support when we cross-compile.
- **UUIDs:** reuse `uuid` crate already added in MVP1 for the JSON-RPC id.
- **Time:** `chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }` for ISO 8601 timestamps.

## Test coverage

- `store` Rust unit tests (in-memory SQLite): create, list ordering, get-by-id, update bumps `updated_at`, delete removes row, duplicate-name fails.
- `secrets` Rust integration test (real keychain, `#[ignore]` by default to keep CI green without keychain access): set → get → delete round trip.
- `commands` are thin wrappers — covered by the manual smoke test, no separate Rust test.
- Manual UI smoke (Phase verification):
  1. Launch app → empty state shows.
  2. New connection with valid Oracle creds → save → returns to list with one card.
  3. Edit it → password is pre-filled → change port → save → list updates.
  4. Test from edit form against real Oracle → green status.
  5. Delete with confirm → list empty again.
  6. Quit and relaunch app → state survives.
  7. Open Keychain Access → entry `veesker / connection:<uuid>` visible while record exists, gone after delete.

## Success criteria

1. Saved connections survive app quit/relaunch.
2. Passwords are visible in macOS Keychain Access (proof they're not in plaintext on disk).
3. SQLite file under `app_data_dir()` contains no password column.
4. The flow create → edit → test → save → delete works end-to-end with no console errors.

## Manual test target

Same as MVP1: local Oracle 23ai Free container (`oracle23ai`, password from `ORACLE_PWD`).
