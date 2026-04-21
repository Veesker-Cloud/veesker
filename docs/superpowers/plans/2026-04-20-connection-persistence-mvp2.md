# Connection Persistence MVP2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Oracle connection profiles to a local SQLite file, store passwords in the OS keychain, and ship a saved-connections landing page that lists, creates, edits, deletes, and tests them.

**Architecture:** All persistence in the Tauri Rust process. New `persistence` module: `store.rs` does SQLite CRUD (TDD with in-memory DB), `secrets.rs` wraps `keyring`, `connections.rs` composes them and is what the Tauri commands call through a `tauri::State`. Frontend gets a typed `connections.ts` wrapper, a reusable `ConnectionForm` component, and three SvelteKit routes (`/`, `/connections/new`, `/connections/[id]/edit`).

**Tech Stack:** rusqlite 0.32 (bundled), keyring 3, chrono 0.4, existing tauri + svelte 5 stack from MVP1.

**Spec:** `docs/superpowers/specs/2026-04-20-connection-persistence-mvp2-design.md`

---

## File Structure

```
src-tauri/
├── Cargo.toml                              # MODIFY: + rusqlite, keyring, chrono
├── src/
│   ├── lib.rs                              # MODIFY: setup ConnectionService in State, register 4 commands
│   ├── commands.rs                         # MODIFY: append 4 new commands (list/get/save/delete)
│   ├── persistence/                        # NEW MODULE
│   │   ├── mod.rs                          # public re-exports
│   │   ├── store.rs                        # SQLite CRUD + #[cfg(test)] unit tests
│   │   ├── secrets.rs                      # keyring wrapper + ignored integration test
│   │   └── connections.rs                  # ConnectionService (composes store + secrets) + types
│   └── sidecar.rs                          # unchanged

src/
├── lib/
│   ├── connection.ts                       # unchanged (one-shot connection.test wrapper)
│   ├── connections.ts                      # NEW: typed invoke wrappers for CRUD
│   └── ConnectionForm.svelte               # NEW: reusable form (used by new + edit)
└── routes/
    ├── +page.svelte                        # MODIFY: replace with landing list
    └── connections/
        ├── new/
        │   └── +page.svelte                # NEW: create
        └── [id]/
            └── edit/
                └── +page.svelte            # NEW: edit
```

---

## Task 1: Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Append the three new deps**

In `src-tauri/Cargo.toml`, in the `[dependencies]` section, add:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
keyring = "3"
chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }
```

Final `[dependencies]` block should be:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-shell = "2"
tokio = { version = "1", features = ["rt", "sync", "io-util", "macros"] }
uuid = { version = "1", features = ["v4"] }
rusqlite = { version = "0.32", features = ["bundled"] }
keyring = "3"
chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }
```

- [ ] **Step 2: Verify cargo fetches and the workspace still builds**

Run: `cd src-tauri && cargo check`
Expected: PASS (one pre-existing dead-code warning on `RpcError.data` is fine — ignore it).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add rusqlite, keyring, chrono for connection persistence"
```

---

## Task 2: SQLite store (TDD)

**Files:**
- Create: `src-tauri/src/persistence/mod.rs`
- Create: `src-tauri/src/persistence/store.rs`

**What this module owns:** schema initialisation and CRUD against a `rusqlite::Connection`. No keychain, no Tauri types — just plain Rust structs so it's trivially unit-testable with an in-memory database.

- [ ] **Step 1: Create the module entry**

Create `src-tauri/src/persistence/mod.rs`:

```rust
pub mod store;
```

- [ ] **Step 2: Write the failing tests for store**

Create `src-tauri/src/persistence/store.rs`:

```rust
use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug)]
pub enum StoreError {
    NotFound,
    Conflict(String),
    Sqlite(rusqlite::Error),
}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

pub fn init_db(_conn: &Connection) -> Result<(), StoreError> {
    unimplemented!()
}

pub fn create(_conn: &Connection, _row: &ConnectionRow) -> Result<(), StoreError> {
    unimplemented!()
}

pub fn list(_conn: &Connection) -> Result<Vec<ConnectionRow>, StoreError> {
    unimplemented!()
}

pub fn get(_conn: &Connection, _id: &str) -> Result<Option<ConnectionRow>, StoreError> {
    unimplemented!()
}

pub fn update(_conn: &Connection, _row: &ConnectionRow) -> Result<(), StoreError> {
    unimplemented!()
}

pub fn delete(_conn: &Connection, _id: &str) -> Result<(), StoreError> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    fn sample(id: &str, name: &str) -> ConnectionRow {
        ConnectionRow {
            id: id.into(),
            name: name.into(),
            host: "localhost".into(),
            port: 1521,
            service_name: "FREEPDB1".into(),
            username: "pdbadmin".into(),
            created_at: "2026-04-20T00:00:00Z".into(),
            updated_at: "2026-04-20T00:00:00Z".into(),
        }
    }

    #[test]
    fn init_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        init_db(&c).unwrap(); // second call must not fail
    }

    #[test]
    fn create_then_list_returns_one() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Alpha");
    }

    #[test]
    fn list_orders_by_name_case_insensitive() {
        let c = fresh();
        create(&c, &sample("a", "zeta")).unwrap();
        create(&c, &sample("b", "Alpha")).unwrap();
        create(&c, &sample("c", "mike")).unwrap();
        let names: Vec<_> = list(&c).unwrap().into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["Alpha", "mike", "zeta"]);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let c = fresh();
        assert!(get(&c, "missing").unwrap().is_none());
    }

    #[test]
    fn get_returns_row_for_known_id() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let row = get(&c, "a").unwrap().unwrap();
        assert_eq!(row.host, "localhost");
        assert_eq!(row.port, 1521);
    }

    #[test]
    fn create_with_duplicate_name_returns_conflict() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let err = create(&c, &sample("b", "Alpha")).unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[test]
    fn create_with_duplicate_name_case_insensitive_returns_conflict() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let err = create(&c, &sample("b", "alpha")).unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let mut row = get(&c, "a").unwrap().unwrap();
        row.port = 1599;
        row.updated_at = "2026-05-01T00:00:00Z".into();
        update(&c, &row).unwrap();
        let after = get(&c, "a").unwrap().unwrap();
        assert_eq!(after.port, 1599);
        assert_eq!(after.updated_at, "2026-05-01T00:00:00Z");
    }

    #[test]
    fn update_unknown_id_returns_not_found() {
        let c = fresh();
        let err = update(&c, &sample("ghost", "Ghost")).unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }

    #[test]
    fn delete_removes_row() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        delete(&c, "a").unwrap();
        assert!(get(&c, "a").unwrap().is_none());
    }

    #[test]
    fn delete_unknown_id_returns_not_found() {
        let c = fresh();
        let err = delete(&c, "ghost").unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }
}
```

- [ ] **Step 3: Wire the module into the crate so tests compile**

Edit `src-tauri/src/lib.rs`. Add `mod persistence;` near the top:

```rust
mod commands;
mod persistence;
mod sidecar;
```

(Keep the rest of `lib.rs` exactly as-is for now — commands and setup come in Task 5.)

- [ ] **Step 4: Run the tests — they must all fail with `unimplemented!()`**

Run: `cd src-tauri && cargo test --lib persistence::store`
Expected: every test panics with "not implemented".

- [ ] **Step 5: Implement the module**

Replace the body of `src-tauri/src/persistence/store.rs` with:

```rust
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug)]
pub enum StoreError {
    NotFound,
    Conflict(String),
    Sqlite(rusqlite::Error),
}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS connections (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL,
    service_name TEXT NOT NULL,
    username     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_name_unique
    ON connections (LOWER(name));
"#;

pub fn init_db(conn: &Connection) -> Result<(), StoreError> {
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

pub fn create(conn: &Connection, row: &ConnectionRow) -> Result<(), StoreError> {
    let res = conn.execute(
        "INSERT INTO connections \
         (id, name, host, port, service_name, username, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.id, row.name, row.host, row.port,
            row.service_name, row.username, row.created_at, row.updated_at
        ],
    );
    match res {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(StoreError::Conflict(format!(
                "name '{}' already in use",
                row.name
            )))
        }
        Err(e) => Err(StoreError::Sqlite(e)),
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionRow> {
    Ok(ConnectionRow {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)? as u16,
        service_name: row.get(4)?,
        username: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<ConnectionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, service_name, username, created_at, updated_at \
         FROM connections ORDER BY LOWER(name)",
    )?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<ConnectionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, service_name, username, created_at, updated_at \
         FROM connections WHERE id = ?",
    )?;
    let row = stmt.query_row(params![id], map_row).optional()?;
    Ok(row)
}

pub fn update(conn: &Connection, row: &ConnectionRow) -> Result<(), StoreError> {
    let res = conn.execute(
        "UPDATE connections SET \
         name = ?, host = ?, port = ?, service_name = ?, \
         username = ?, updated_at = ? WHERE id = ?",
        params![
            row.name, row.host, row.port, row.service_name,
            row.username, row.updated_at, row.id
        ],
    );
    match res {
        Ok(0) => Err(StoreError::NotFound),
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(StoreError::Conflict(format!(
                "name '{}' already in use",
                row.name
            )))
        }
        Err(e) => Err(StoreError::Sqlite(e)),
    }
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), StoreError> {
    let n = conn.execute("DELETE FROM connections WHERE id = ?", params![id])?;
    if n == 0 {
        Err(StoreError::NotFound)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    fn sample(id: &str, name: &str) -> ConnectionRow {
        ConnectionRow {
            id: id.into(),
            name: name.into(),
            host: "localhost".into(),
            port: 1521,
            service_name: "FREEPDB1".into(),
            username: "pdbadmin".into(),
            created_at: "2026-04-20T00:00:00Z".into(),
            updated_at: "2026-04-20T00:00:00Z".into(),
        }
    }

    #[test]
    fn init_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        init_db(&c).unwrap();
    }

    #[test]
    fn create_then_list_returns_one() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Alpha");
    }

    #[test]
    fn list_orders_by_name_case_insensitive() {
        let c = fresh();
        create(&c, &sample("a", "zeta")).unwrap();
        create(&c, &sample("b", "Alpha")).unwrap();
        create(&c, &sample("c", "mike")).unwrap();
        let names: Vec<_> = list(&c).unwrap().into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["Alpha", "mike", "zeta"]);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let c = fresh();
        assert!(get(&c, "missing").unwrap().is_none());
    }

    #[test]
    fn get_returns_row_for_known_id() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let row = get(&c, "a").unwrap().unwrap();
        assert_eq!(row.host, "localhost");
        assert_eq!(row.port, 1521);
    }

    #[test]
    fn create_with_duplicate_name_returns_conflict() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let err = create(&c, &sample("b", "Alpha")).unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[test]
    fn create_with_duplicate_name_case_insensitive_returns_conflict() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let err = create(&c, &sample("b", "alpha")).unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let mut row = get(&c, "a").unwrap().unwrap();
        row.port = 1599;
        row.updated_at = "2026-05-01T00:00:00Z".into();
        update(&c, &row).unwrap();
        let after = get(&c, "a").unwrap().unwrap();
        assert_eq!(after.port, 1599);
        assert_eq!(after.updated_at, "2026-05-01T00:00:00Z");
    }

    #[test]
    fn update_unknown_id_returns_not_found() {
        let c = fresh();
        let err = update(&c, &sample("ghost", "Ghost")).unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }

    #[test]
    fn delete_removes_row() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        delete(&c, "a").unwrap();
        assert!(get(&c, "a").unwrap().is_none());
    }

    #[test]
    fn delete_unknown_id_returns_not_found() {
        let c = fresh();
        let err = delete(&c, "ghost").unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }
}
```

- [ ] **Step 6: Run the tests — they must all pass**

Run: `cd src-tauri && cargo test --lib persistence::store`
Expected: 11 passed, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/persistence/ src-tauri/src/lib.rs
git commit -m "feat(persistence): SQLite store for connections with CRUD + tests"
```

---

## Task 3: Keychain wrapper

**Files:**
- Create: `src-tauri/src/persistence/secrets.rs`
- Modify: `src-tauri/src/persistence/mod.rs`

**What this module owns:** the mapping from a connection uuid to a keychain entry, plus `set_password` / `get_password` / `delete_password`. The actual keychain call is unit-untestable in CI, so we ship a single `#[ignore]`-by-default integration test that the developer can run locally with `cargo test -- --ignored`.

- [ ] **Step 1: Re-export the new module**

Edit `src-tauri/src/persistence/mod.rs` to:

```rust
pub mod secrets;
pub mod store;
```

- [ ] **Step 2: Implement secrets**

Create `src-tauri/src/persistence/secrets.rs`:

```rust
use keyring::Entry;

const SERVICE: &str = "veesker";

fn account(id: &str) -> String {
    format!("connection:{id}")
}

fn entry(id: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, &account(id))
}

pub fn set_password(id: &str, password: &str) -> keyring::Result<()> {
    entry(id)?.set_password(password)
}

pub fn get_password(id: &str) -> keyring::Result<String> {
    entry(id)?.get_password()
}

/// Returns Ok(()) even when the entry is already absent — deletion is
/// idempotent because `delete` is called on cleanup paths and we never
/// want a missing entry to abort a flow.
pub fn delete_password(id: &str) -> keyring::Result<()> {
    match entry(id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

/// True when the keychain reports `NoEntry`. Used by the read path to
/// surface "password missing" without bubbling up an error.
pub fn is_missing(err: &keyring::Error) -> bool {
    matches!(err, keyring::Error::NoEntry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "touches the real OS keychain — run with `cargo test -- --ignored`"]
    fn round_trip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2").unwrap();
        assert_eq!(get_password(&id).unwrap(), "hunter2");
        delete_password(&id).unwrap();
        let err = get_password(&id).unwrap_err();
        assert!(is_missing(&err));
        // Idempotent delete
        delete_password(&id).unwrap();
    }
}
```

- [ ] **Step 3: Compile**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 4: Run the unit tests (skips the ignored one)**

Run: `cd src-tauri && cargo test --lib persistence`
Expected: 11 store tests pass, 0 failed, 1 ignored.

- [ ] **Step 5: Run the ignored keychain test once locally to verify the wrapper works**

Run: `cd src-tauri && cargo test --lib persistence::secrets -- --ignored`
Expected: 1 passed. (macOS will pop a Keychain auth dialog the first time — approve it.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/persistence/secrets.rs src-tauri/src/persistence/mod.rs
git commit -m "feat(persistence): keyring wrapper for password storage"
```

---

## Task 4: ConnectionService — combine store + secrets + types

**Files:**
- Create: `src-tauri/src/persistence/connections.rs`
- Modify: `src-tauri/src/persistence/mod.rs`

**What this module owns:** the user-facing types (`ConnectionMeta`, `ConnectionFull`, `ConnectionInput`, `ConnectionError`), the unified error code mapping, and the `ConnectionService` that holds a `Mutex<rusqlite::Connection>` and orchestrates store + secrets.

- [ ] **Step 1: Re-export the module**

Edit `src-tauri/src/persistence/mod.rs` to:

```rust
pub mod connections;
pub mod secrets;
pub mod store;
```

- [ ] **Step 2: Implement the service**

Create `src-tauri/src/persistence/connections.rs`:

```rust
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::Connection as SqliteConnection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{secrets, store};
use store::{ConnectionRow, StoreError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMeta {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ConnectionRow> for ConnectionMeta {
    fn from(r: ConnectionRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            host: r.host,
            port: r.port,
            service_name: r.service_name,
            username: r.username,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFull {
    pub meta: ConnectionMeta,
    pub password: String,
    pub password_missing: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionError {
    pub code: i32,
    pub message: String,
}

impl ConnectionError {
    fn not_found() -> Self { Self { code: 404, message: "connection not found".into() } }
    fn conflict(msg: impl Into<String>) -> Self { Self { code: 409, message: msg.into() } }
    fn invalid(msg: impl Into<String>) -> Self { Self { code: 400, message: msg.into() } }
    fn internal(msg: impl Into<String>) -> Self { Self { code: 500, message: msg.into() } }
}

impl From<StoreError> for ConnectionError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::NotFound => ConnectionError::not_found(),
            StoreError::Conflict(m) => ConnectionError::conflict(m),
            StoreError::Sqlite(e) => ConnectionError::internal(format!("sqlite: {e}")),
        }
    }
}

impl From<keyring::Error> for ConnectionError {
    fn from(e: keyring::Error) -> Self {
        ConnectionError::internal(format!("keyring: {e}"))
    }
}

pub struct ConnectionService {
    conn: Mutex<SqliteConnection>,
}

impl ConnectionService {
    pub fn open(db_path: &PathBuf) -> Result<Self, ConnectionError> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| ConnectionError::internal(format!("mkdir {dir:?}: {e}")))?;
        }
        let conn = SqliteConnection::open(db_path)
            .map_err(|e| ConnectionError::internal(format!("open {db_path:?}: {e}")))?;
        store::init_db(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SqliteConnection>, ConnectionError> {
        self.conn
            .lock()
            .map_err(|_| ConnectionError::internal("db mutex poisoned"))
    }

    pub fn list(&self) -> Result<Vec<ConnectionMeta>, ConnectionError> {
        let conn = self.lock()?;
        let rows = store::list(&conn)?;
        Ok(rows.into_iter().map(ConnectionMeta::from).collect())
    }

    pub fn get(&self, id: &str) -> Result<ConnectionFull, ConnectionError> {
        let row = {
            let conn = self.lock()?;
            store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
        };
        let id_for_secret = row.id.clone();
        let meta = ConnectionMeta::from(row);
        match secrets::get_password(&id_for_secret) {
            Ok(password) => Ok(ConnectionFull { meta, password, password_missing: false }),
            Err(e) if secrets::is_missing(&e) => Ok(ConnectionFull {
                meta,
                password: String::new(),
                password_missing: true,
            }),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, input: ConnectionInput) -> Result<ConnectionMeta, ConnectionError> {
        if input.name.trim().is_empty() {
            return Err(ConnectionError::invalid("name is required"));
        }
        if input.host.trim().is_empty() {
            return Err(ConnectionError::invalid("host is required"));
        }
        if input.username.trim().is_empty() {
            return Err(ConnectionError::invalid("username is required"));
        }
        if input.password.is_empty() {
            return Err(ConnectionError::invalid("password is required"));
        }
        let now = Utc::now().to_rfc3339();
        let row = match input.id.as_deref() {
            None => ConnectionRow {
                id: Uuid::new_v4().to_string(),
                name: input.name.clone(),
                host: input.host.clone(),
                port: input.port,
                service_name: input.service_name.clone(),
                username: input.username.clone(),
                created_at: now.clone(),
                updated_at: now,
            },
            Some(id) => {
                let existing = {
                    let conn = self.lock()?;
                    store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
                };
                ConnectionRow {
                    id: existing.id,
                    name: input.name.clone(),
                    host: input.host.clone(),
                    port: input.port,
                    service_name: input.service_name.clone(),
                    username: input.username.clone(),
                    created_at: existing.created_at,
                    updated_at: now,
                }
            }
        };
        {
            let conn = self.lock()?;
            if input.id.is_some() {
                store::update(&conn, &row)?;
            } else {
                store::create(&conn, &row)?;
            }
        }
        secrets::set_password(&row.id, &input.password)?;
        Ok(ConnectionMeta::from(row))
    }

    pub fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        {
            let conn = self.lock()?;
            store::delete(&conn, id)?;
        }
        // Best-effort: row is already gone; orphan keychain entries get
        // cleaned up by delete_password being idempotent on next attempt.
        if let Err(e) = secrets::delete_password(id) {
            eprintln!("[connections] keychain delete failed for {id}: {e}");
        }
        Ok(())
    }
}
```

- [ ] **Step 3: Compile**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 4: Re-run all tests to ensure nothing regressed**

Run: `cd src-tauri && cargo test --lib persistence`
Expected: 11 passed, 1 ignored.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/connections.rs src-tauri/src/persistence/mod.rs
git commit -m "feat(persistence): ConnectionService composing store + keychain"
```

---

## Task 5: Tauri commands + State setup

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Append the four new commands**

Append to `src-tauri/src/commands.rs` (keep all existing content above untouched):

```rust
use crate::persistence::connections::{
    ConnectionError, ConnectionFull, ConnectionInput, ConnectionMeta, ConnectionService,
};

#[tauri::command]
pub async fn connection_list(
    app: AppHandle,
) -> Result<Vec<ConnectionMeta>, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.list()
}

#[tauri::command]
pub async fn connection_get(
    app: AppHandle,
    id: String,
) -> Result<ConnectionFull, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.get(&id)
}

#[tauri::command]
pub async fn connection_save(
    app: AppHandle,
    input: ConnectionInput,
) -> Result<ConnectionMeta, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.save(input)
}

#[tauri::command]
pub async fn connection_delete(
    app: AppHandle,
    id: String,
) -> Result<(), ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.delete(&id)
}
```

- [ ] **Step 2: Wire State + register commands in `lib.rs`**

Replace `src-tauri/src/lib.rs` with:

```rust
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
            let svc = ConnectionService::open(&db_path)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Compile**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 4: Build (catches macro errors that `check` misses)**

Run: `cd src-tauri && cargo build`
Expected: PASS, the dev-profile binary is rebuilt.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): connection CRUD commands + ConnectionService state"
```

---

## Task 6: Frontend typed wrappers

**Files:**
- Create: `src/lib/connections.ts`

- [ ] **Step 1: Write the wrapper**

Create `src/lib/connections.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type ConnectionMeta = {
  id: string;
  name: string;
  host: string;
  port: number;
  serviceName: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionFull = {
  meta: ConnectionMeta;
  password: string;
  passwordMissing: boolean;
};

export type ConnectionInput = {
  id?: string;
  name: string;
  host: string;
  port: number;
  serviceName: string;
  username: string;
  password: string;
};

export type ConnectionError = { code: number; message: string };

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ConnectionError };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as ConnectionError };
  }
}

export const listConnections = () => call<ConnectionMeta[]>("connection_list");
export const getConnection = (id: string) => call<ConnectionFull>("connection_get", { id });
export const saveConnection = (input: ConnectionInput) =>
  call<ConnectionMeta>("connection_save", { input });
export const deleteConnection = (id: string) => call<void>("connection_delete", { id });
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/connections.ts
git commit -m "feat(ui): typed wrappers for connection CRUD commands"
```

---

## Task 7: Reusable `<ConnectionForm>` component

**Files:**
- Create: `src/lib/ConnectionForm.svelte`

**What this component owns:** rendering the seven inputs (name + host + port + service + username + password) and exposing three callbacks (`onTest`, `onSave`, `onCancel`). It does NOT call Tauri directly — the routes do that and pass results in via props. This keeps the component pure-UI and testable by visual inspection.

- [ ] **Step 1: Write the component**

Create `src/lib/ConnectionForm.svelte`:

```svelte
<script lang="ts">
  import type { ConnectionInput } from "$lib/connections";
  import { testConnection } from "$lib/connection";

  type TestState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; serverVersion: string; elapsedMs: number }
    | { kind: "err"; message: string };

  type SaveState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "err"; message: string };

  let {
    initial,
    submitLabel = "Save",
    passwordMissing = false,
    onSave,
    onCancel,
  }: {
    initial: ConnectionInput;
    submitLabel?: string;
    passwordMissing?: boolean;
    onSave: (input: ConnectionInput) => Promise<{ ok: true } | { ok: false; message: string }>;
    onCancel: () => void;
  } = $props();

  let values = $state<ConnectionInput>({ ...initial });
  let testState = $state<TestState>({ kind: "idle" });
  let saveState = $state<SaveState>({ kind: "idle" });

  async function onTest() {
    testState = { kind: "running" };
    const res = await testConnection({
      host: values.host,
      port: values.port,
      serviceName: values.serviceName,
      username: values.username,
      password: values.password,
    });
    testState = res.ok
      ? { kind: "ok", serverVersion: res.data.serverVersion, elapsedMs: res.data.elapsedMs }
      : { kind: "err", message: res.error.message };
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    saveState = { kind: "running" };
    const res = await onSave({ ...values });
    saveState = res.ok ? { kind: "idle" } : { kind: "err", message: res.message };
  }
</script>

<form onsubmit={onSubmit}>
  {#if passwordMissing}
    <div class="banner warn">
      Password not found in keychain — please re-enter to save.
    </div>
  {/if}

  <label>
    Name
    <input type="text" bind:value={values.name} required autocomplete="off" />
  </label>

  <label>
    Host
    <input type="text" bind:value={values.host} required />
  </label>

  <div class="row">
    <label class="port">
      Port
      <input type="number" bind:value={values.port} min="1" max="65535" required />
    </label>
    <label class="service">
      Service name
      <input type="text" bind:value={values.serviceName} required />
    </label>
  </div>

  <label>
    Username
    <input type="text" bind:value={values.username} autocomplete="off" required />
  </label>

  <label>
    Password
    <input type="password" bind:value={values.password} autocomplete="off" required />
  </label>

  <div class="actions">
    <button type="button" class="ghost" onclick={onTest} disabled={testState.kind === "running"}>
      {testState.kind === "running" ? "Testing…" : "Test"}
    </button>
    <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
    <button type="submit" disabled={saveState.kind === "running"}>
      {saveState.kind === "running" ? "Saving…" : submitLabel}
    </button>
  </div>

  {#if testState.kind === "ok"}
    <div class="status ok">
      <strong>Connected.</strong>
      <span>{testState.serverVersion}</span>
      <span class="meta">{testState.elapsedMs} ms</span>
    </div>
  {:else if testState.kind === "err"}
    <div class="status err">
      <strong>Test failed.</strong>
      <span>{testState.message}</span>
    </div>
  {/if}

  {#if saveState.kind === "err"}
    <div class="status err">
      <strong>Save failed.</strong>
      <span>{saveState.message}</span>
    </div>
  {/if}
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  input {
    font-family: "Inter", sans-serif;
    font-size: 14px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: #1a1612;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
  }
  input:focus {
    outline: none;
    border-color: #b33e1f;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  button {
    flex: 1;
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #f6f1e8;
    background: #1a1612;
    border: none;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    cursor: pointer;
  }
  button.ghost {
    color: #1a1612;
    background: transparent;
    border: 1px solid rgba(26, 22, 18, 0.2);
  }
  button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  button:hover:not(:disabled) {
    background: #b33e1f;
    color: #f6f1e8;
    border-color: #b33e1f;
  }
  .banner {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-family: "Inter", sans-serif;
    font-size: 13px;
  }
  .banner.warn {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .status {
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .status.ok {
    background: rgba(46, 125, 50, 0.08);
    color: #1b5e20;
    border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ConnectionForm.svelte
git commit -m "feat(ui): reusable ConnectionForm component"
```

---

## Task 8: Landing page — saved connections list

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Replace `+page.svelte` with the list view**

Replace the entire contents of `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import {
    listConnections,
    deleteConnection,
    type ConnectionMeta,
  } from "$lib/connections";

  let connections = $state<ConnectionMeta[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function refresh() {
    loading = true;
    const res = await listConnections();
    if (res.ok) {
      connections = res.data;
      error = null;
    } else {
      error = res.error.message;
    }
    loading = false;
  }

  onMount(refresh);

  async function onDelete(c: ConnectionMeta) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await deleteConnection(c.id);
    if (!res.ok) {
      alert(`Delete failed: ${res.error.message}`);
      return;
    }
    await refresh();
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <div class="brand">
      <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="4" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="14" r="2.8" fill="#B33E1F" />
        <circle cx="24" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
      </svg>
      <h1>veesker</h1>
    </div>
    <p class="tagline">connections</p>
  </header>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <div class="status err">
      <strong>Failed to load.</strong>
      <span>{error}</span>
    </div>
  {:else if connections.length === 0}
    <div class="empty">
      <p>No saved connections yet.</p>
      <button onclick={() => goto("/connections/new")}>+ New connection</button>
    </div>
  {:else}
    <ul class="list">
      {#each connections as c (c.id)}
        <li>
          <div class="info">
            <strong>{c.name}</strong>
            <span class="meta">{c.username}@{c.host}:{c.port}/{c.serviceName}</span>
          </div>
          <div class="actions">
            <button class="ghost" onclick={() => goto(`/connections/${c.id}/edit`)}>Edit</button>
            <button class="ghost danger" onclick={() => onDelete(c)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
    <button class="primary" onclick={() => goto("/connections/new")}>+ New connection</button>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 40px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    color: rgba(26, 22, 18, 0.6);
    font-style: italic;
    margin: 0;
  }
  .muted {
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.1);
    border-radius: 8px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .info strong {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 16px;
  }
  .meta {
    font-size: 12px;
    color: rgba(26, 22, 18, 0.55);
    font-family: "JetBrains Mono", "SF Mono", monospace;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    padding: 0.55rem 0.9rem;
    cursor: pointer;
  }
  button.ghost {
    background: transparent;
    color: #1a1612;
    border: 1px solid rgba(26, 22, 18, 0.2);
  }
  button.ghost.danger:hover {
    background: #b33e1f;
    color: #f6f1e8;
    border-color: #b33e1f;
  }
  button.primary {
    align-self: flex-start;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.85rem 1.25rem;
  }
  button.primary:hover {
    background: #b33e1f;
  }
  .empty button {
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.85rem 1.25rem;
  }
  .empty button:hover {
    background: #b33e1f;
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(ui): saved connections landing page"
```

---

## Task 9: Create route — `/connections/new`

**Files:**
- Create: `src/routes/connections/new/+page.svelte`

- [ ] **Step 1: Write the route**

Create `src/routes/connections/new/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import ConnectionForm from "$lib/ConnectionForm.svelte";
  import { saveConnection, type ConnectionInput } from "$lib/connections";

  const initial: ConnectionInput = {
    name: "",
    host: "localhost",
    port: 1521,
    serviceName: "FREEPDB1",
    username: "",
    password: "",
  };

  async function onSave(input: ConnectionInput) {
    const res = await saveConnection(input);
    if (!res.ok) return { ok: false as const, message: res.error.message };
    await goto("/");
    return { ok: true as const };
  }

  function onCancel() {
    void goto("/");
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <h1>New connection</h1>
  </header>
  <ConnectionForm {initial} submitLabel="Save" {onSave} {onCancel} />
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 28px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/connections/new/+page.svelte
git commit -m "feat(ui): /connections/new route"
```

---

## Task 10: Edit route — `/connections/[id]/edit`

**Files:**
- Create: `src/routes/connections/[id]/edit/+page.svelte`

- [ ] **Step 1: Write the route**

Create `src/routes/connections/[id]/edit/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import ConnectionForm from "$lib/ConnectionForm.svelte";
  import {
    getConnection,
    saveConnection,
    type ConnectionInput,
  } from "$lib/connections";

  let initial = $state<ConnectionInput | null>(null);
  let passwordMissing = $state(false);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    const id = page.params.id!;
    const res = await getConnection(id);
    if (!res.ok) {
      loadError = res.error.message;
      return;
    }
    const { meta, password, passwordMissing: missing } = res.data;
    initial = {
      id: meta.id,
      name: meta.name,
      host: meta.host,
      port: meta.port,
      serviceName: meta.serviceName,
      username: meta.username,
      password,
    };
    passwordMissing = missing;
  });

  async function onSave(input: ConnectionInput) {
    const res = await saveConnection(input);
    if (!res.ok) return { ok: false as const, message: res.error.message };
    await goto("/");
    return { ok: true as const };
  }

  function onCancel() {
    void goto("/");
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <h1>Edit connection</h1>
  </header>

  {#if loadError}
    <div class="status err">
      <strong>Failed to load.</strong>
      <span>{loadError}</span>
      <button onclick={() => goto("/")}>Back to list</button>
    </div>
  {:else if initial}
    <ConnectionForm {initial} submitLabel="Save" {passwordMissing} {onSave} {onCancel} />
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 28px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .muted {
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/connections/[id]/edit/+page.svelte
git commit -m "feat(ui): /connections/[id]/edit route"
```

---

## Task 11: Configure pre-rendering for the dynamic edit route

SvelteKit's `adapter-static` with a `fallback: index.html` handles dynamic routes via SPA fallback at runtime, but the build will fail if it tries to pre-render `[id]/edit` because the id is unknown at build time. We mark that route as not pre-renderable.

**Files:**
- Create: `src/routes/connections/[id]/edit/+page.ts`

- [ ] **Step 1: Disable pre-render for the dynamic route**

Create `src/routes/connections/[id]/edit/+page.ts`:

```ts
export const prerender = false;
```

- [ ] **Step 2: Run a frontend production build to confirm no SSR/prerender errors**

Run: `bun run build`
Expected: build succeeds; output written to `build/`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/connections/[id]/edit/+page.ts
git commit -m "build: disable prerender on dynamic edit route"
```

---

## Task 12: End-to-end smoke + tag

**Files:** none (manual verification)

- [ ] **Step 1: Build the sidecar binary** (unchanged from MVP1, but rerun in case)

```bash
cd /Users/geraldoviana/Documents/veesker
./scripts/build-sidecar.sh
```
Expected: `src-tauri/binaries/veesker-sidecar-<triple>` exists and is up to date.

- [ ] **Step 2: Make sure the test Oracle container is up**

```bash
docker start oracle23ai
docker inspect oracle23ai --format '{{.State.Health.Status}}'
```
Wait until output is `healthy`.

- [ ] **Step 3: Launch the app**

```bash
bun run tauri dev
```

- [ ] **Step 4: Empty state check**

Expected: landing page shows "No saved connections yet" + a single CTA button. (If a previous run created connections, that's fine — proceed to Step 5 anyway.)

- [ ] **Step 5: Create flow**

Click **+ New connection**. Fill:
- Name: `Local 23ai Free`
- Host: `localhost`
- Port: `1521`
- Service name: `FREEPDB1`
- Username: `pdbadmin`
- Password: `OracleCurso2026!`

Click **Test** → green "Connected" with version banner.
Click **Save** → returns to `/` with one card visible.

- [ ] **Step 6: Edit flow**

Click **Edit** on the card. Form opens with everything pre-filled including the password (proof the keychain round-trip works). Change Port to `1522`, click **Save** → list shows the updated meta. Click **Edit** again, change port back to `1521`, click **Save**.

- [ ] **Step 7: Persistence check**

Quit the app (⌘Q). Relaunch with `bun run tauri dev`. Expected: the connection card is still there.

- [ ] **Step 8: Keychain proof**

Open **Keychain Access** → Login keychain → search "veesker". Expected: one entry, account `connection:<uuid>` matching the connection's id.

Verify the SQLite file does NOT contain the password:
```bash
sqlite3 "$HOME/Library/Application Support/com.veesker.app/veesker.db" '.schema connections'
sqlite3 "$HOME/Library/Application Support/com.veesker.app/veesker.db" 'SELECT * FROM connections'
```
(If the bundle id differs, find the file with `find ~/Library/Application\ Support -name veesker.db`.)

Expected: schema has no `password` column; row has no password value.

- [ ] **Step 9: Delete flow**

Click **Delete** on the card → native confirm → list shows empty state again. Re-check Keychain Access — entry should be gone.

- [ ] **Step 10: Tag the milestone**

```bash
git tag -a v0.0.3-persistence-mvp2 -m "Connection Persistence MVP2: SQLite store + keychain + CRUD UI"
```
(Do not push without explicit user consent.)

---

## Self-review checklist

- ✅ **Spec coverage:** Task 2 (store), Task 3 (secrets), Task 4 (service composition), Task 5 (commands + state), Task 6/7 (frontend wrappers + form), Task 8 (landing list), Task 9/10 (new + edit routes), Task 11 (build config), Task 12 (success criteria 1-4 verified).
- ✅ **No placeholders:** every Rust/TS/Svelte step contains the literal code; every shell step gives the exact command and expected output.
- ✅ **Type consistency:** `ConnectionMeta` / `ConnectionFull` / `ConnectionInput` field names match across `connections.rs` (Rust, camelCase via serde rename), `connections.ts` (TS), and the Svelte form props.
- ✅ **TDD where it pays:** SQLite CRUD has 11 unit tests; keychain has one ignored integration test (touches OS); commands and UI are thin wrappers covered by the smoke test.
- ✅ **Frequent commits:** 12 commits, one per task.
