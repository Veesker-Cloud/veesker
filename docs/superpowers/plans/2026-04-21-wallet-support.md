# Wallet Support (Phase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Oracle Autonomous Database (mTLS wallet) auth as a peer of basic auth in Veesker's connection store and UI.

**Architecture:** Discriminated `auth_type` column + `connect_alias` added to `connections` (SQLite table recreated to allow `host/port/service_name` to become NULLable). Wallet zip is extracted into `appDataDir/wallets/{id}/`. Wallet password stored in macOS Keychain under `connection:{id}:wallet`. New `wallet_inspect` Tauri command parses `tnsnames.ora` aliases for the form's dropdown. Sidecar handler accepts a discriminated union and constructs the right `oracledb.getConnection` call. `ConnectionForm.svelte` gains an auth-type radio that swaps field sets.

**Tech Stack:** Rust (rusqlite, keyring, serde, zip 2.x), Tauri 2 (`tauri-plugin-dialog` for file picker), TypeScript/Svelte 5, node-oracledb 6.x Thin mode.

**Reference spec:** [docs/superpowers/specs/2026-04-21-wallet-support-design.md](../specs/2026-04-21-wallet-support-design.md)

**Smoke caveat:** The user has no real wallet to test against. The sidecar wallet path will be exercised end-to-end up to Oracle's TLS handshake, but a successful Autonomous DB connection cannot be verified in this phase.

---

## File map

**New (Rust):**
- `src-tauri/src/persistence/tnsnames.rs` — alias parser
- `src-tauri/src/persistence/wallet.rs` — zip validation + extraction + filesystem ops

**Modified (Rust):**
- `src-tauri/Cargo.toml` — add `zip = "2"`, `tauri-plugin-dialog = "2"`
- `src-tauri/src/persistence/mod.rs` — declare new modules
- `src-tauri/src/persistence/store.rs` — schema change + migration + `auth_type`/`connect_alias` on `ConnectionRow`
- `src-tauri/src/persistence/secrets.rs` — `wallet_account()` + paired wallet-password fns
- `src-tauri/src/persistence/connections.rs` — discriminated `ConnectionInput`, wallet branch in `save`/`get`/`delete`, new `WalletInfo` type, `app_data_dir` argument
- `src-tauri/src/commands.rs` — add `wallet_inspect` command
- `src-tauri/src/lib.rs` — register dialog plugin, register `wallet_inspect`, pass `app_data_dir` to `ConnectionService::open`

**New (frontend):**
- *(none — uses existing routes)*

**Modified (frontend):**
- `package.json` — add `@tauri-apps/plugin-dialog`
- `src/lib/connections.ts` — discriminated types + `walletInspect`
- `src/lib/connection.ts` — `testConnection` accepts the new union
- `src/lib/ConnectionForm.svelte` — auth-type radio, wallet drop zone, alias dropdown, conditional fields
- `src/routes/+page.svelte` — wallet badge + meta-line variant
- `src/routes/connections/new/+page.svelte` — initial state for both auth types
- `src/routes/connections/[id]/edit/+page.svelte` — hydrate wallet meta + walletPasswordMissing

---

## Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add zip and dialog plugin to Cargo.toml**

Append to the `[dependencies]` section of `src-tauri/Cargo.toml`:

```toml
zip = "2"
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: compiles successfully (will pull `zip` and `tauri-plugin-dialog` crates).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add zip and tauri-plugin-dialog for wallet support"
```

---

## Task 2: tnsnames.ora parser

**Files:**
- Create: `src-tauri/src/persistence/tnsnames.rs`
- Modify: `src-tauri/src/persistence/mod.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/persistence/tnsnames.rs`:

```rust
pub fn parse_aliases(content: &str) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTONOMOUS_SAMPLE: &str = "\
mydb_high = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=high.adb)))
mydb_medium = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=medium.adb)))
mydb_low=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=low.adb)))
";

    #[test]
    fn parses_three_aliases_in_file_order() {
        let aliases = parse_aliases(AUTONOMOUS_SAMPLE);
        assert_eq!(aliases, vec!["mydb_high", "mydb_medium", "mydb_low"]);
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        let input = "\
# this is a comment
\n\
alpha = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))

# another comment
beta=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))
";
        assert_eq!(parse_aliases(input), vec!["alpha", "beta"]);
    }

    #[test]
    fn ignores_indented_continuation_lines() {
        let input = "\
mydb_high = (DESCRIPTION=
    (ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=h))
    (CONNECT_DATA=(SERVICE_NAME=s)))
mydb_low = (DESCRIPTION=(ADDRESS=))
";
        assert_eq!(parse_aliases(input), vec!["mydb_high", "mydb_low"]);
    }

    #[test]
    fn returns_empty_for_garbage_input() {
        assert!(parse_aliases("").is_empty());
        assert!(parse_aliases("not a tnsnames file at all").is_empty());
        assert!(parse_aliases("==== broken =====").is_empty());
    }

    #[test]
    fn preserves_alias_casing() {
        let input = "MyDB_HIGH = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))\n";
        assert_eq!(parse_aliases(input), vec!["MyDB_HIGH"]);
    }
}
```

Add module declaration to `src-tauri/src/persistence/mod.rs`:

```rust
pub mod connections;
pub mod secrets;
pub mod store;
pub mod tnsnames;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib persistence::tnsnames`
Expected: 5 tests fail with assertion errors (parser returns empty).

- [ ] **Step 3: Implement parser**

Replace `parse_aliases` in `src-tauri/src/persistence/tnsnames.rs`:

```rust
pub fn parse_aliases(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in content.lines() {
        // skip indented (continuation) lines
        if raw.starts_with([' ', '\t']) {
            continue;
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // top-level alias is "NAME = (DESCRIPTION..." — match up to '='
        let Some(eq_idx) = line.find('=') else { continue; };
        let alias = line[..eq_idx].trim();
        if alias.is_empty() {
            continue;
        }
        // alias must be all alphanumeric/underscore (Oracle identifier rules)
        if !alias.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        // value must start with '(' to qualify as a TNS entry
        let rest = line[eq_idx + 1..].trim_start();
        if !rest.starts_with('(') {
            continue;
        }
        out.push(alias.to_string());
    }
    out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib persistence::tnsnames`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/tnsnames.rs src-tauri/src/persistence/mod.rs
git commit -m "feat: tnsnames.ora alias parser"
```

---

## Task 3: Wallet zip module

**Files:**
- Create: `src-tauri/src/persistence/wallet.rs`
- Modify: `src-tauri/src/persistence/mod.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/persistence/wallet.rs`:

```rust
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum WalletError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    MissingFile(&'static str),
}

impl From<std::io::Error> for WalletError {
    fn from(e: std::io::Error) -> Self {
        WalletError::Io(e)
    }
}

impl From<zip::result::ZipError> for WalletError {
    fn from(e: zip::result::ZipError) -> Self {
        WalletError::Zip(e)
    }
}

impl std::fmt::Display for WalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WalletError::Io(e) => write!(f, "wallet i/o: {e}"),
            WalletError::Zip(e) => write!(f, "wallet zip: {e}"),
            WalletError::MissingFile(name) => write!(f, "wallet missing required file: {name}"),
        }
    }
}

const REQUIRED_FILES: &[&str] = &["tnsnames.ora", "cwallet.sso"];

pub fn read_tnsnames_from_zip(zip_path: &Path) -> Result<String, WalletError> {
    Err(WalletError::MissingFile("tnsnames.ora"))
}

pub fn extract_to(zip_path: &Path, dest_dir: &Path) -> Result<(), WalletError> {
    Err(WalletError::MissingFile("cwallet.sso"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        let cursor = Cursor::new(&mut buf);
        let mut zw = zip::ZipWriter::new(cursor);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(data).unwrap();
        }
        zw.finish().unwrap();
        buf
    }

    fn write_zip(dir: &Path, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
        let bytes = build_zip(entries);
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn read_tnsnames_returns_content() {
        let tmp = tempdir();
        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[
                ("tnsnames.ora", b"alpha = (DESCRIPTION=(ADDRESS=))\n"),
                ("cwallet.sso", b"x"),
            ],
        );
        let body = read_tnsnames_from_zip(&zip).unwrap();
        assert!(body.contains("alpha"));
    }

    #[test]
    fn read_tnsnames_errors_when_missing() {
        let tmp = tempdir();
        let zip = write_zip(tmp.path(), "wallet.zip", &[("cwallet.sso", b"x")]);
        let err = read_tnsnames_from_zip(&zip).unwrap_err();
        assert!(matches!(err, WalletError::MissingFile("tnsnames.ora")));
    }

    #[test]
    fn extract_writes_all_files() {
        let tmp = tempdir();
        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[
                ("tnsnames.ora", b"alpha = (DESCRIPTION=(ADDRESS=))\n"),
                ("cwallet.sso", b"sso bytes"),
                ("sqlnet.ora", b"WALLET_LOCATION=..."),
            ],
        );
        let dest = tmp.path().join("out");
        extract_to(&zip, &dest).unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("tnsnames.ora")).unwrap(),
            "alpha = (DESCRIPTION=(ADDRESS=))\n"
        );
        assert_eq!(fs::read(dest.join("cwallet.sso")).unwrap(), b"sso bytes");
        assert_eq!(fs::read(dest.join("sqlnet.ora")).unwrap(), b"WALLET_LOCATION=...");
    }

    #[test]
    fn extract_errors_when_required_missing() {
        let tmp = tempdir();
        let zip = write_zip(tmp.path(), "wallet.zip", &[("tnsnames.ora", b"x")]);
        let dest = tmp.path().join("out");
        let err = extract_to(&zip, &dest).unwrap_err();
        assert!(matches!(err, WalletError::MissingFile("cwallet.sso")));
        assert!(!dest.exists(), "extract must not leave partial dest on failure");
    }

    #[test]
    fn extract_overwrites_existing_dir() {
        let tmp = tempdir();
        let dest = tmp.path().join("out");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("stale.txt"), b"old").unwrap();

        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[("tnsnames.ora", b"a"), ("cwallet.sso", b"b")],
        );
        extract_to(&zip, &dest).unwrap();
        assert!(!dest.join("stale.txt").exists(), "stale files must be removed");
        assert!(dest.join("tnsnames.ora").exists());
    }

    fn tempdir() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }
}
```

Add `tempfile` to dev-deps. Append to `src-tauri/Cargo.toml`:

```toml

[dev-dependencies]
tempfile = "3"
```

Add module to `src-tauri/src/persistence/mod.rs`:

```rust
pub mod connections;
pub mod secrets;
pub mod store;
pub mod tnsnames;
pub mod wallet;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib persistence::wallet`
Expected: 5 tests fail (stub returns errors).

- [ ] **Step 3: Implement wallet module**

Replace `src-tauri/src/persistence/wallet.rs` body (keep the error type + tests, replace the two function bodies):

```rust
use std::fs;
use std::io::Read;
use std::path::Path;

pub fn read_tnsnames_from_zip(zip_path: &Path) -> Result<String, WalletError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive
        .by_name("tnsnames.ora")
        .map_err(|_| WalletError::MissingFile("tnsnames.ora"))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)?;
    Ok(s)
}

pub fn extract_to(zip_path: &Path, dest_dir: &Path) -> Result<(), WalletError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    // validate required files BEFORE touching the destination
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();
    for required in REQUIRED_FILES {
        if !names.iter().any(|n| n == *required) {
            return Err(WalletError::MissingFile(required));
        }
    }

    // wipe and recreate destination
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir)?;
    }
    fs::create_dir_all(dest_dir)?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        // refuse path traversal — only flat file names
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            continue;
        }
        let out_path = dest_dir.join(&name);
        let mut out = fs::File::create(&out_path)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}
```

Adjust the imports at the top of `wallet.rs` — remove unused `Write`, `PathBuf`, `Cursor`. Final imports stay only what's needed by the impl + tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib persistence::wallet`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/persistence/wallet.rs src-tauri/src/persistence/mod.rs
git commit -m "feat: wallet zip extraction with required-file validation"
```

---

## Task 4: Schema migration in store.rs

**Files:**
- Modify: `src-tauri/src/persistence/store.rs`

- [ ] **Step 1: Write failing migration tests**

Append to the `#[cfg(test)] mod tests` block in `src-tauri/src/persistence/store.rs`:

```rust
    #[test]
    fn migration_adds_columns_to_legacy_schema() {
        let c = Connection::open_in_memory().unwrap();
        // Recreate the MVP2 schema by hand (no auth_type, no connect_alias)
        c.execute_batch(
            "CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                service_name TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX connections_name_unique ON connections (LOWER(name));
            INSERT INTO connections VALUES
                ('legacy-1', 'Legacy', 'localhost', 1521, 'FREEPDB1', 'admin', '2026-04-20T00:00:00Z', '2026-04-20T00:00:00Z');",
        )
        .unwrap();

        init_db(&c).unwrap();

        let cols: Vec<String> = c
            .prepare("PRAGMA table_info(connections)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(cols.contains(&"auth_type".to_string()));
        assert!(cols.contains(&"connect_alias".to_string()));

        // existing data preserved as 'basic'
        let row = get(&c, "legacy-1").unwrap().unwrap();
        assert_eq!(row.auth_type, AuthType::Basic);
        assert_eq!(row.host.as_deref(), Some("localhost"));
        assert_eq!(row.connect_alias, None);
    }

    #[test]
    fn migration_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        init_db(&c).unwrap();
        init_db(&c).unwrap();
    }

    #[test]
    fn create_wallet_row_then_get() {
        let c = fresh();
        let row = ConnectionRow {
            id: "w1".into(),
            name: "Wallet One".into(),
            auth_type: AuthType::Wallet,
            host: None,
            port: None,
            service_name: None,
            connect_alias: Some("mydb_high".into()),
            username: "admin".into(),
            created_at: "2026-04-21T00:00:00Z".into(),
            updated_at: "2026-04-21T00:00:00Z".into(),
        };
        create(&c, &row).unwrap();
        let got = get(&c, "w1").unwrap().unwrap();
        assert_eq!(got.auth_type, AuthType::Wallet);
        assert_eq!(got.connect_alias.as_deref(), Some("mydb_high"));
        assert!(got.host.is_none());
        assert!(got.port.is_none());
    }
```

Also update the `sample()` helper in the same test module to populate the new fields:

```rust
    fn sample(id: &str, name: &str) -> ConnectionRow {
        ConnectionRow {
            id: id.into(),
            name: name.into(),
            auth_type: AuthType::Basic,
            host: Some("localhost".into()),
            port: Some(1521),
            service_name: Some("FREEPDB1".into()),
            connect_alias: None,
            username: "pdbadmin".into(),
            created_at: "2026-04-20T00:00:00Z".into(),
            updated_at: "2026-04-20T00:00:00Z".into(),
        }
    }
```

And update the `get_returns_row_for_known_id` test to read from `Option`:

```rust
    #[test]
    fn get_returns_row_for_known_id() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let row = get(&c, "a").unwrap().unwrap();
        assert_eq!(row.host.as_deref(), Some("localhost"));
        assert_eq!(row.port, Some(1521));
    }
```

And `update_changes_fields_and_bumps_updated_at`:

```rust
    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let c = fresh();
        create(&c, &sample("a", "Alpha")).unwrap();
        let mut row = get(&c, "a").unwrap().unwrap();
        row.port = Some(1599);
        row.updated_at = "2026-05-01T00:00:00Z".into();
        update(&c, &row).unwrap();
        let after = get(&c, "a").unwrap().unwrap();
        assert_eq!(after.port, Some(1599));
        assert_eq!(after.updated_at, "2026-05-01T00:00:00Z");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib persistence::store`
Expected: compilation errors — `AuthType` doesn't exist; `host`/`port`/`service_name` are `String`/`u16` not `Option`.

- [ ] **Step 3: Replace store.rs implementation**

Overwrite `src-tauri/src/persistence/store.rs` with:

```rust
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    Basic,
    Wallet,
}

impl AuthType {
    fn as_db_str(&self) -> &'static str {
        match self {
            AuthType::Basic => "basic",
            AuthType::Wallet => "wallet",
        }
    }
    fn from_db_str(s: &str) -> rusqlite::Result<Self> {
        match s {
            "basic" => Ok(AuthType::Basic),
            "wallet" => Ok(AuthType::Wallet),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown auth_type: {other}").into(),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub auth_type: AuthType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub service_name: Option<String>,
    pub connect_alias: Option<String>,
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

const CREATE_CURRENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS connections (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    auth_type     TEXT NOT NULL DEFAULT 'basic'
                    CHECK (auth_type IN ('basic', 'wallet')),
    host          TEXT,
    port          INTEGER,
    service_name  TEXT,
    connect_alias TEXT,
    username      TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_name_unique
    ON connections (LOWER(name));
"#;

const MIGRATE_LEGACY_TO_CURRENT: &str = r#"
BEGIN;
CREATE TABLE connections_new (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    auth_type     TEXT NOT NULL DEFAULT 'basic'
                    CHECK (auth_type IN ('basic', 'wallet')),
    host          TEXT,
    port          INTEGER,
    service_name  TEXT,
    connect_alias TEXT,
    username      TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
INSERT INTO connections_new
    (id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at)
    SELECT id, name, 'basic', host, port, service_name, NULL, username, created_at, updated_at
    FROM connections;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
DROP INDEX IF EXISTS connections_name_unique;
CREATE UNIQUE INDEX connections_name_unique ON connections (LOWER(name));
COMMIT;
"#;

fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(names.iter().any(|n| n == column))
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    let mut stmt =
        conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")?;
    Ok(stmt.exists(params![table])?)
}

pub fn init_db(conn: &Connection) -> Result<(), StoreError> {
    if table_exists(conn, "connections")? && !has_column(conn, "connections", "auth_type")? {
        conn.execute_batch(MIGRATE_LEGACY_TO_CURRENT)?;
    } else {
        conn.execute_batch(CREATE_CURRENT_SCHEMA)?;
    }
    Ok(())
}

pub fn create(conn: &Connection, row: &ConnectionRow) -> Result<(), StoreError> {
    let res = conn.execute(
        "INSERT INTO connections \
         (id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.id,
            row.name,
            row.auth_type.as_db_str(),
            row.host,
            row.port,
            row.service_name,
            row.connect_alias,
            row.username,
            row.created_at,
            row.updated_at
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
    let auth: String = row.get(2)?;
    Ok(ConnectionRow {
        id: row.get(0)?,
        name: row.get(1)?,
        auth_type: AuthType::from_db_str(&auth)?,
        host: row.get(3)?,
        port: row.get::<_, Option<i64>>(4)?.map(|n| n as u16),
        service_name: row.get(5)?,
        connect_alias: row.get(6)?,
        username: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<ConnectionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at \
         FROM connections ORDER BY LOWER(name)",
    )?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<ConnectionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at \
         FROM connections WHERE id = ?",
    )?;
    let row = stmt.query_row(params![id], map_row).optional()?;
    Ok(row)
}

pub fn update(conn: &Connection, row: &ConnectionRow) -> Result<(), StoreError> {
    let res = conn.execute(
        "UPDATE connections SET \
         name = ?, auth_type = ?, host = ?, port = ?, service_name = ?, \
         connect_alias = ?, username = ?, updated_at = ? WHERE id = ?",
        params![
            row.name,
            row.auth_type.as_db_str(),
            row.host,
            row.port,
            row.service_name,
            row.connect_alias,
            row.username,
            row.updated_at,
            row.id
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
```

Keep the existing `#[cfg(test)] mod tests` block from the original file but with the test updates from Step 1 applied.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib persistence::store`
Expected: all store tests pass (legacy + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/store.rs
git commit -m "feat: schema migration with auth_type and connect_alias"
```

---

## Task 5: Wallet password helpers in secrets.rs

**Files:**
- Modify: `src-tauri/src/persistence/secrets.rs`

- [ ] **Step 1: Implement wallet-password fns**

Replace `src-tauri/src/persistence/secrets.rs`:

```rust
use keyring::Entry;

const SERVICE: &str = "veesker";

fn user_account(id: &str) -> String {
    format!("connection:{id}")
}

fn wallet_account(id: &str) -> String {
    format!("connection:{id}:wallet")
}

fn entry(account: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, account)
}

pub fn set_password(id: &str, password: &str) -> keyring::Result<()> {
    entry(&user_account(id))?.set_password(password)
}

pub fn get_password(id: &str) -> keyring::Result<String> {
    entry(&user_account(id))?.get_password()
}

pub fn delete_password(id: &str) -> keyring::Result<()> {
    delete_account(&user_account(id))
}

pub fn set_wallet_password(id: &str, password: &str) -> keyring::Result<()> {
    entry(&wallet_account(id))?.set_password(password)
}

pub fn get_wallet_password(id: &str) -> keyring::Result<String> {
    entry(&wallet_account(id))?.get_password()
}

pub fn delete_wallet_password(id: &str) -> keyring::Result<()> {
    delete_account(&wallet_account(id))
}

fn delete_account(account: &str) -> keyring::Result<()> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

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
        delete_password(&id).unwrap();
    }

    #[test]
    #[ignore = "touches the real OS keychain — run with `cargo test -- --ignored`"]
    fn wallet_round_trip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_wallet_password(&id, "wpass").unwrap();
        assert_eq!(get_wallet_password(&id).unwrap(), "wpass");
        delete_wallet_password(&id).unwrap();
        assert!(is_missing(&get_wallet_password(&id).unwrap_err()));
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles. (Tests stay `#[ignore]` since they touch the real keychain.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/persistence/secrets.rs
git commit -m "feat: wallet password helpers in secrets module"
```

---

## Task 6: ConnectionService — discriminated input + wallet branch

**Files:**
- Modify: `src-tauri/src/persistence/connections.rs`

- [ ] **Step 1: Replace connections.rs**

Overwrite `src-tauri/src/persistence/connections.rs`:

```rust
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::Connection as SqliteConnection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{secrets, store, tnsnames, wallet};
use store::{AuthType, ConnectionRow, StoreError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "authType")]
pub enum ConnectionMeta {
    #[serde(rename = "basic")]
    Basic {
        id: String,
        name: String,
        host: String,
        port: u16,
        service_name: String,
        username: String,
        created_at: String,
        updated_at: String,
    },
    #[serde(rename = "wallet")]
    Wallet {
        id: String,
        name: String,
        connect_alias: String,
        username: String,
        created_at: String,
        updated_at: String,
    },
}

impl TryFrom<ConnectionRow> for ConnectionMeta {
    type Error = ConnectionError;
    fn try_from(r: ConnectionRow) -> Result<Self, ConnectionError> {
        match r.auth_type {
            AuthType::Basic => Ok(ConnectionMeta::Basic {
                id: r.id,
                name: r.name,
                host: r.host.ok_or_else(|| ConnectionError::internal("basic row missing host"))?,
                port: r.port.ok_or_else(|| ConnectionError::internal("basic row missing port"))?,
                service_name: r
                    .service_name
                    .ok_or_else(|| ConnectionError::internal("basic row missing service_name"))?,
                username: r.username,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }),
            AuthType::Wallet => Ok(ConnectionMeta::Wallet {
                id: r.id,
                name: r.name,
                connect_alias: r
                    .connect_alias
                    .ok_or_else(|| ConnectionError::internal("wallet row missing connect_alias"))?,
                username: r.username,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFull {
    pub meta: ConnectionMeta,
    pub password: String,
    pub password_missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wallet_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wallet_password_missing: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
pub enum ConnectionInput {
    #[serde(rename = "basic")]
    Basic {
        id: Option<String>,
        name: String,
        host: String,
        port: u16,
        service_name: String,
        username: String,
        password: String,
    },
    #[serde(rename = "wallet")]
    Wallet {
        id: Option<String>,
        name: String,
        wallet_zip_path: Option<String>,
        wallet_password: String,
        connect_alias: String,
        username: String,
        password: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletInfo {
    pub aliases: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionError {
    pub code: i32,
    pub message: String,
}

impl ConnectionError {
    fn not_found() -> Self {
        Self { code: 404, message: "connection not found".into() }
    }
    fn conflict(msg: impl Into<String>) -> Self {
        Self { code: 409, message: msg.into() }
    }
    fn invalid(msg: impl Into<String>) -> Self {
        Self { code: 400, message: msg.into() }
    }
    pub(crate) fn internal(msg: impl Into<String>) -> Self {
        Self { code: 500, message: msg.into() }
    }
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

impl From<wallet::WalletError> for ConnectionError {
    fn from(e: wallet::WalletError) -> Self {
        match e {
            wallet::WalletError::MissingFile(name) => {
                ConnectionError::invalid(format!("wallet missing required file: {name}"))
            }
            other => ConnectionError::invalid(format!("wallet: {other}")),
        }
    }
}

pub struct ConnectionService {
    conn: Mutex<SqliteConnection>,
    wallets_root: PathBuf,
}

impl ConnectionService {
    pub fn open(db_path: &Path, wallets_root: PathBuf) -> Result<Self, ConnectionError> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| ConnectionError::internal(format!("mkdir {dir:?}: {e}")))?;
        }
        std::fs::create_dir_all(&wallets_root)
            .map_err(|e| ConnectionError::internal(format!("mkdir {wallets_root:?}: {e}")))?;
        let conn = SqliteConnection::open(db_path)
            .map_err(|e| ConnectionError::internal(format!("open {db_path:?}: {e}")))?;
        store::init_db(&conn)?;
        Ok(Self { conn: Mutex::new(conn), wallets_root })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SqliteConnection>, ConnectionError> {
        self.conn
            .lock()
            .map_err(|_| ConnectionError::internal("db mutex poisoned"))
    }

    fn wallet_dir(&self, id: &str) -> PathBuf {
        self.wallets_root.join(id)
    }

    pub fn list(&self) -> Result<Vec<ConnectionMeta>, ConnectionError> {
        let conn = self.lock()?;
        let rows = store::list(&conn)?;
        rows.into_iter().map(ConnectionMeta::try_from).collect()
    }

    pub fn get(&self, id: &str) -> Result<ConnectionFull, ConnectionError> {
        let row = {
            let conn = self.lock()?;
            store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
        };
        let id_for_secret = row.id.clone();
        let auth = row.auth_type.clone();
        let meta = ConnectionMeta::try_from(row)?;

        let (password, password_missing) = match secrets::get_password(&id_for_secret) {
            Ok(p) => (p, false),
            Err(e) if secrets::is_missing(&e) => (String::new(), true),
            Err(e) => return Err(e.into()),
        };

        let (wallet_password, wallet_password_missing) = match auth {
            AuthType::Basic => (None, None),
            AuthType::Wallet => match secrets::get_wallet_password(&id_for_secret) {
                Ok(p) => (Some(p), Some(false)),
                Err(e) if secrets::is_missing(&e) => (Some(String::new()), Some(true)),
                Err(e) => return Err(e.into()),
            },
        };

        Ok(ConnectionFull {
            meta,
            password,
            password_missing,
            wallet_password,
            wallet_password_missing,
        })
    }

    pub fn save(&self, input: ConnectionInput) -> Result<ConnectionMeta, ConnectionError> {
        let now = Utc::now().to_rfc3339();
        match input {
            ConnectionInput::Basic { id, name, host, port, service_name, username, password } => {
                if name.trim().is_empty() {
                    return Err(ConnectionError::invalid("name is required"));
                }
                if host.trim().is_empty() {
                    return Err(ConnectionError::invalid("host is required"));
                }
                if username.trim().is_empty() {
                    return Err(ConnectionError::invalid("username is required"));
                }
                if password.is_empty() {
                    return Err(ConnectionError::invalid("password is required"));
                }
                let row = self.assemble_basic_row(id.as_deref(), name, host, port, service_name, username, &now)?;
                self.persist_row(&row, id.is_some())?;
                secrets::set_password(&row.id, &password)?;
                ConnectionMeta::try_from(row)
            }
            ConnectionInput::Wallet { id, name, wallet_zip_path, wallet_password, connect_alias, username, password } => {
                if name.trim().is_empty() {
                    return Err(ConnectionError::invalid("name is required"));
                }
                if username.trim().is_empty() {
                    return Err(ConnectionError::invalid("username is required"));
                }
                if password.is_empty() {
                    return Err(ConnectionError::invalid("password is required"));
                }
                if wallet_password.is_empty() {
                    return Err(ConnectionError::invalid("wallet password is required"));
                }
                if connect_alias.trim().is_empty() {
                    return Err(ConnectionError::invalid("connect alias is required"));
                }
                let row = self.assemble_wallet_row(id.as_deref(), name, connect_alias.clone(), username, &now)?;

                // wallet directory: extract on create, or replace if zip provided on edit
                let wallet_dir = self.wallet_dir(&row.id);
                if let Some(zip_path) = wallet_zip_path.as_deref() {
                    let zip = Path::new(zip_path);
                    let body = wallet::read_tnsnames_from_zip(zip)?;
                    let aliases = tnsnames::parse_aliases(&body);
                    if !aliases.iter().any(|a| a.eq_ignore_ascii_case(&connect_alias)) {
                        return Err(ConnectionError::invalid(format!(
                            "alias '{connect_alias}' not found in wallet's tnsnames.ora"
                        )));
                    }
                    wallet::extract_to(zip, &wallet_dir)?;
                } else {
                    if id.is_none() {
                        return Err(ConnectionError::invalid("wallet zip is required for new wallet connections"));
                    }
                    if !wallet_dir.exists() {
                        return Err(ConnectionError::invalid("wallet directory missing — please re-upload the wallet zip"));
                    }
                    // validate alias against existing wallet on disk
                    let body = std::fs::read_to_string(wallet_dir.join("tnsnames.ora"))
                        .map_err(|e| ConnectionError::invalid(format!("read tnsnames.ora: {e}")))?;
                    let aliases = tnsnames::parse_aliases(&body);
                    if !aliases.iter().any(|a| a.eq_ignore_ascii_case(&connect_alias)) {
                        return Err(ConnectionError::invalid(format!(
                            "alias '{connect_alias}' not found in saved tnsnames.ora"
                        )));
                    }
                }

                self.persist_row(&row, id.is_some())?;
                secrets::set_password(&row.id, &password)?;
                secrets::set_wallet_password(&row.id, &wallet_password)?;
                ConnectionMeta::try_from(row)
            }
        }
    }

    fn assemble_basic_row(
        &self,
        id: Option<&str>,
        name: String,
        host: String,
        port: u16,
        service_name: String,
        username: String,
        now: &str,
    ) -> Result<ConnectionRow, ConnectionError> {
        match id {
            None => Ok(ConnectionRow {
                id: Uuid::new_v4().to_string(),
                name,
                auth_type: AuthType::Basic,
                host: Some(host),
                port: Some(port),
                service_name: Some(service_name),
                connect_alias: None,
                username,
                created_at: now.into(),
                updated_at: now.into(),
            }),
            Some(id) => {
                let existing = {
                    let conn = self.lock()?;
                    store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
                };
                if existing.auth_type != AuthType::Basic {
                    return Err(ConnectionError::invalid(
                        "cannot change auth type — delete and recreate the connection",
                    ));
                }
                Ok(ConnectionRow {
                    id: existing.id,
                    name,
                    auth_type: AuthType::Basic,
                    host: Some(host),
                    port: Some(port),
                    service_name: Some(service_name),
                    connect_alias: None,
                    username,
                    created_at: existing.created_at,
                    updated_at: now.into(),
                })
            }
        }
    }

    fn assemble_wallet_row(
        &self,
        id: Option<&str>,
        name: String,
        connect_alias: String,
        username: String,
        now: &str,
    ) -> Result<ConnectionRow, ConnectionError> {
        match id {
            None => Ok(ConnectionRow {
                id: Uuid::new_v4().to_string(),
                name,
                auth_type: AuthType::Wallet,
                host: None,
                port: None,
                service_name: None,
                connect_alias: Some(connect_alias),
                username,
                created_at: now.into(),
                updated_at: now.into(),
            }),
            Some(id) => {
                let existing = {
                    let conn = self.lock()?;
                    store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
                };
                if existing.auth_type != AuthType::Wallet {
                    return Err(ConnectionError::invalid(
                        "cannot change auth type — delete and recreate the connection",
                    ));
                }
                Ok(ConnectionRow {
                    id: existing.id,
                    name,
                    auth_type: AuthType::Wallet,
                    host: None,
                    port: None,
                    service_name: None,
                    connect_alias: Some(connect_alias),
                    username,
                    created_at: existing.created_at,
                    updated_at: now.into(),
                })
            }
        }
    }

    fn persist_row(&self, row: &ConnectionRow, is_update: bool) -> Result<(), ConnectionError> {
        let conn = self.lock()?;
        if is_update {
            store::update(&conn, row)?;
        } else {
            store::create(&conn, row)?;
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        // capture auth_type before delete so we know whether to clean wallet
        let row = {
            let conn = self.lock()?;
            store::get(&conn, id)?
        };
        {
            let conn = self.lock()?;
            store::delete(&conn, id)?;
        }
        if let Err(e) = secrets::delete_password(id) {
            eprintln!("[connections] keychain delete failed for {id}: {e}");
        }
        if let Some(r) = row {
            if r.auth_type == AuthType::Wallet {
                if let Err(e) = secrets::delete_wallet_password(id) {
                    eprintln!("[connections] wallet keychain delete failed for {id}: {e}");
                }
                let dir = self.wallet_dir(id);
                if dir.exists() {
                    if let Err(e) = std::fs::remove_dir_all(&dir) {
                        eprintln!("[connections] wallet dir delete failed for {dir:?}: {e}");
                    }
                }
            }
        }
        Ok(())
    }

    pub fn inspect_wallet(&self, zip_path: &str) -> Result<WalletInfo, ConnectionError> {
        let body = wallet::read_tnsnames_from_zip(Path::new(zip_path))?;
        Ok(WalletInfo { aliases: tnsnames::parse_aliases(&body) })
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles. Existing callers in `commands.rs` and `lib.rs` will be updated in Tasks 7–8.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/persistence/connections.rs
git commit -m "feat: discriminated ConnectionInput with wallet branch"
```

---

## Task 7: Wire wallet_inspect command + update lib.rs

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add wallet_inspect command**

Replace the imports + the `connection_*` block at the bottom of `src-tauri/src/commands.rs`:

```rust
use crate::persistence::connections::{
    ConnectionError, ConnectionFull, ConnectionInput, ConnectionMeta, ConnectionService, WalletInfo,
};

#[tauri::command]
pub async fn connection_list(app: AppHandle) -> Result<Vec<ConnectionMeta>, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.list()
}

#[tauri::command]
pub async fn connection_get(app: AppHandle, id: String) -> Result<ConnectionFull, ConnectionError> {
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
pub async fn connection_delete(app: AppHandle, id: String) -> Result<(), ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.delete(&id)
}

#[tauri::command]
pub async fn wallet_inspect(
    app: AppHandle,
    zip_path: String,
) -> Result<WalletInfo, ConnectionError> {
    let svc = app.state::<ConnectionService>();
    svc.inspect_wallet(&zip_path)
}
```

- [ ] **Step 2: Update connection_test to accept the discriminated config**

Replace the top half of `src-tauri/src/commands.rs` (everything up to the `connection_list` block):

```rust
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri::Manager;

use crate::sidecar::{ensure, SidecarState};

#[derive(Debug, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
pub enum ConnectionConfig {
    #[serde(rename = "basic")]
    Basic {
        host: String,
        port: u16,
        service_name: String,
        username: String,
        password: String,
    },
    #[serde(rename = "wallet")]
    Wallet {
        wallet_dir: String,
        wallet_password: String,
        connect_alias: String,
        username: String,
        password: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestOk {
    pub server_version: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestErr {
    pub code: i32,
    pub message: String,
}

fn config_to_params(config: ConnectionConfig) -> Value {
    match config {
        ConnectionConfig::Basic { host, port, service_name, username, password } => json!({
            "authType": "basic",
            "host": host,
            "port": port,
            "serviceName": service_name,
            "username": username,
            "password": password,
        }),
        ConnectionConfig::Wallet { wallet_dir, wallet_password, connect_alias, username, password } => json!({
            "authType": "wallet",
            "walletDir": wallet_dir,
            "walletPassword": wallet_password,
            "connectAlias": connect_alias,
            "username": username,
            "password": password,
        }),
    }
}

#[tauri::command]
pub async fn connection_test(
    app: AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionTestOk, ConnectionTestErr> {
    if let Err(err) = ensure(&app).await {
        return Err(ConnectionTestErr { code: -32003, message: err });
    }

    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");

    let result = sidecar
        .call("connection.test", config_to_params(config))
        .await
        .map_err(|err| ConnectionTestErr { code: err.code, message: err.message })?;

    let server_version = result
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("Oracle (unknown)")
        .to_string();
    let elapsed_ms = result.get("elapsedMs").and_then(|v| v.as_u64()).unwrap_or(0);

    Ok(ConnectionTestOk { server_version, elapsed_ms })
}
```

- [ ] **Step 3: Update lib.rs — register dialog plugin, register wallet_inspect, pass wallets root**

Replace `src-tauri/src/lib.rs`:

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
        .plugin(tauri_plugin_dialog::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verify build**

Run: `cd src-tauri && cargo build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: wallet_inspect command and discriminated connection_test"
```

---

## Task 8: Sidecar oracle.ts — wallet branch

**Files:**
- Modify: `sidecar/src/oracle.ts`

- [ ] **Step 1: Replace oracle.ts**

Overwrite `sidecar/src/oracle.ts`:

```typescript
import oracledb from "oracledb";

export type ConnectionTestParams =
  | {
      authType: "basic";
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
    }
  | {
      authType: "wallet";
      walletDir: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
    };

export type ConnectionTestResult = {
  ok: true;
  serverVersion: string;
  elapsedMs: number;
};

export async function connectionTest(
  params: ConnectionTestParams
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const conn =
    params.authType === "basic"
      ? await oracledb.getConnection({
          user: params.username,
          password: params.password,
          connectString: `${params.host}:${params.port}/${params.serviceName}`,
        })
      : await oracledb.getConnection({
          user: params.username,
          password: params.password,
          connectString: params.connectAlias,
          configDir: params.walletDir,
          walletLocation: params.walletDir,
          walletPassword: params.walletPassword,
        });
  try {
    const result = await conn.execute<{ V: string }>(
      "SELECT BANNER_FULL AS V FROM V$VERSION WHERE ROWNUM = 1",
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const banner = result.rows?.[0]?.V ?? "Oracle (version unavailable)";
    return {
      ok: true,
      serverVersion: banner,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await conn.close();
  }
}
```

- [ ] **Step 2: Build the sidecar**

Run: `cd /Users/geraldoviana/Documents/veesker && ./scripts/build-sidecar.sh`
Expected: produces `src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin` (or platform-equivalent), exit 0.

- [ ] **Step 3: Smoke test the basic path still works (no regression)**

In one terminal: `docker start oracle23ai` (assuming the container exists from MVP1 work).

In a second terminal:

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"connection.test","params":{"authType":"basic","host":"localhost","port":1521,"serviceName":"FREEPDB1","username":"pdbadmin","password":"<your-password>"}}' \
  | ./src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin
```

Expected: JSON-RPC response with `"serverVersion":"Oracle ...","elapsedMs":<number>`.

If you don't have the Oracle container running, skip this step and validate the basic path through the GUI in Task 14's smoke.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/oracle.ts src-tauri/binaries/
git commit -m "feat: sidecar wallet auth branch"
```

---

## Task 9: Frontend types + walletInspect API

**Files:**
- Modify: `package.json`
- Modify: `src/lib/connections.ts`
- Modify: `src/lib/connection.ts`

- [ ] **Step 1: Install plugin-dialog JS package**

Run: `cd /Users/geraldoviana/Documents/veesker && bun add @tauri-apps/plugin-dialog`
Expected: `package.json` updated, `bun.lock` updated.

- [ ] **Step 2: Replace src/lib/connections.ts**

Overwrite `src/lib/connections.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export type ConnectionMeta =
  | {
      authType: "basic";
      id: string;
      name: string;
      host: string;
      port: number;
      serviceName: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    }
  | {
      authType: "wallet";
      id: string;
      name: string;
      connectAlias: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    };

export type ConnectionFull = {
  meta: ConnectionMeta;
  password: string;
  passwordMissing: boolean;
  walletPassword?: string;
  walletPasswordMissing?: boolean;
};

export type ConnectionInput =
  | {
      authType: "basic";
      id?: string;
      name: string;
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
    }
  | {
      authType: "wallet";
      id?: string;
      name: string;
      walletZipPath?: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
    };

export type WalletInfo = { aliases: string[] };

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
export const walletInspect = (zipPath: string) =>
  call<WalletInfo>("wallet_inspect", { zipPath });
```

- [ ] **Step 3: Update src/lib/connection.ts to accept the discriminated config**

Overwrite `src/lib/connection.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export type ConnectionConfig =
  | {
      authType: "basic";
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
    }
  | {
      authType: "wallet";
      walletDir: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
    };

export type ConnectionTestOk = {
  serverVersion: string;
  elapsedMs: number;
};

export type ConnectionTestErr = {
  code: number;
  message: string;
};

export type ConnectionTestResult =
  | { ok: true; data: ConnectionTestOk }
  | { ok: false; error: ConnectionTestErr };

export async function testConnection(
  config: ConnectionConfig
): Promise<ConnectionTestResult> {
  try {
    const data = await invoke<ConnectionTestOk>("connection_test", { config });
    return { ok: true, data };
  } catch (err) {
    const error = err as ConnectionTestErr;
    return { ok: false, error };
  }
}
```

- [ ] **Step 4: Type-check**

Run: `bun run check`
Expected: no errors. Existing `ConnectionForm.svelte` and routes will produce errors at this point because the API surface changed — those are addressed in Tasks 10–12. **For now you can pass `--watch`-style intent: this step is a checkpoint; defer the green light to Task 12.**

If you want it green at this step, comment out the body of `ConnectionForm.svelte` temporarily — but it's simpler to proceed straight into Task 10.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/lib/connections.ts src/lib/connection.ts
git commit -m "feat: discriminated frontend types + walletInspect"
```

---

## Task 10: ConnectionForm — auth-type radio + wallet fields

**Files:**
- Modify: `src/lib/ConnectionForm.svelte`

- [ ] **Step 1: Replace ConnectionForm.svelte**

Overwrite `src/lib/ConnectionForm.svelte`:

```svelte
<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    walletInspect,
    type ConnectionInput,
  } from "$lib/connections";
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

  type WalletPick =
    | { kind: "none" }
    | { kind: "loading"; path: string }
    | { kind: "ready"; path: string; aliases: string[] }
    | { kind: "err"; path: string; message: string };

  let {
    initial,
    submitLabel = "Save",
    passwordMissing = false,
    walletPasswordMissing = false,
    isEdit = false,
    onSave,
    onCancel,
  }: {
    initial: ConnectionInput;
    submitLabel?: string;
    passwordMissing?: boolean;
    walletPasswordMissing?: boolean;
    isEdit?: boolean;
    onSave: (input: ConnectionInput) => Promise<{ ok: true } | { ok: false; message: string }>;
    onCancel: () => void;
  } = $props();

  // shared
  let authType = $state<"basic" | "wallet">(initial.authType);
  let id = $state<string | undefined>(initial.id);
  let name = $state(initial.name);
  let username = $state(initial.username);
  let password = $state(initial.password);

  // basic-only
  let host = $state(initial.authType === "basic" ? initial.host : "localhost");
  let port = $state(initial.authType === "basic" ? initial.port : 1521);
  let serviceName = $state(initial.authType === "basic" ? initial.serviceName : "FREEPDB1");

  // wallet-only
  let walletPassword = $state(initial.authType === "wallet" ? initial.walletPassword : "");
  let connectAlias = $state(initial.authType === "wallet" ? initial.connectAlias : "");
  let walletPick = $state<WalletPick>(
    initial.authType === "wallet" && isEdit
      ? { kind: "ready", path: "(saved)", aliases: [initial.connectAlias] }
      : { kind: "none" }
  );

  let testState = $state<TestState>({ kind: "idle" });
  let saveState = $state<SaveState>({ kind: "idle" });

  async function pickWalletZip() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Wallet zip", extensions: ["zip"] }],
    });
    if (typeof selected !== "string") return;
    walletPick = { kind: "loading", path: selected };
    const res = await walletInspect(selected);
    if (!res.ok) {
      walletPick = { kind: "err", path: selected, message: res.error.message };
      return;
    }
    walletPick = { kind: "ready", path: selected, aliases: res.data.aliases };
    if (!res.data.aliases.includes(connectAlias)) {
      connectAlias = res.data.aliases[0] ?? "";
    }
  }

  function buildInput(): ConnectionInput {
    if (authType === "basic") {
      return { authType: "basic", id, name, host, port, serviceName, username, password };
    }
    return {
      authType: "wallet",
      id,
      name,
      walletZipPath: walletPick.kind === "ready" && walletPick.path !== "(saved)" ? walletPick.path : undefined,
      walletPassword,
      connectAlias,
      username,
      password,
    };
  }

  async function onTest() {
    testState = { kind: "running" };
    if (authType === "basic") {
      const res = await testConnection({
        authType: "basic",
        host,
        port,
        serviceName,
        username,
        password,
      });
      testState = res.ok
        ? { kind: "ok", serverVersion: res.data.serverVersion, elapsedMs: res.data.elapsedMs }
        : { kind: "err", message: res.error.message };
      return;
    }
    if (walletPick.kind !== "ready" || walletPick.path === "(saved)") {
      testState = { kind: "err", message: "Re-upload the wallet zip to test (we need its on-disk location)." };
      return;
    }
    // For wallet test, we send the zip path as walletDir — sidecar requires the EXTRACTED dir.
    // For an unsaved/replacement wallet, we don't have an extracted dir yet, so testing is only
    // available after Save. Show that constraint.
    testState = {
      kind: "err",
      message: "Save the connection first, then click Test (wallet must be extracted to disk).",
    };
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    saveState = { kind: "running" };
    const res = await onSave(buildInput());
    saveState = res.ok ? { kind: "idle" } : { kind: "err", message: res.message };
  }
</script>

<form onsubmit={onSubmit}>
  {#if !isEdit}
    <div class="auth-toggle">
      <label class="radio">
        <input type="radio" bind:group={authType} value="basic" />
        Basic (host/port/service)
      </label>
      <label class="radio">
        <input type="radio" bind:group={authType} value="wallet" />
        Wallet (Autonomous DB / mTLS)
      </label>
    </div>
  {:else}
    <div class="auth-fixed">Auth: <strong>{authType === "basic" ? "Basic" : "Wallet (mTLS)"}</strong></div>
  {/if}

  {#if passwordMissing}
    <div class="banner warn">User password not in keychain — re-enter to save.</div>
  {/if}
  {#if walletPasswordMissing}
    <div class="banner warn">Wallet password not in keychain — re-enter to save.</div>
  {/if}

  <label>
    Name
    <input type="text" bind:value={name} required autocomplete="off" />
  </label>

  {#if authType === "basic"}
    <label>
      Host
      <input type="text" bind:value={host} required />
    </label>
    <div class="row">
      <label class="port">
        Port
        <input type="number" bind:value={port} min="1" max="65535" required />
      </label>
      <label class="service">
        Service name
        <input type="text" bind:value={serviceName} required />
      </label>
    </div>
  {:else}
    <div class="wallet-pick">
      <span class="wallet-label">Wallet</span>
      {#if walletPick.kind === "none"}
        <button type="button" class="ghost" onclick={pickWalletZip}>Choose wallet .zip…</button>
      {:else if walletPick.kind === "loading"}
        <span class="muted">Reading {walletPick.path}…</span>
      {:else if walletPick.kind === "ready"}
        <div class="wallet-row">
          <span class="path-mono">{walletPick.path}</span>
          <button type="button" class="ghost" onclick={pickWalletZip}>{walletPick.path === "(saved)" ? "Replace wallet…" : "Choose another…"}</button>
        </div>
      {:else}
        <div class="wallet-row">
          <span class="err">{walletPick.message}</span>
          <button type="button" class="ghost" onclick={pickWalletZip}>Try again…</button>
        </div>
      {/if}
    </div>

    <label>
      Connect alias
      <select bind:value={connectAlias} disabled={walletPick.kind !== "ready"} required>
        {#if walletPick.kind === "ready"}
          {#each walletPick.aliases as alias}
            <option value={alias}>{alias}</option>
          {/each}
        {:else}
          <option value="">Choose a wallet first…</option>
        {/if}
      </select>
    </label>

    <label>
      Wallet password
      <input type="password" bind:value={walletPassword} autocomplete="off" required />
    </label>
  {/if}

  <label>
    Username
    <input type="text" bind:value={username} autocomplete="off" required />
  </label>
  <label>
    Password
    <input type="password" bind:value={password} autocomplete="off" required />
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
  form { display: flex; flex-direction: column; gap: 1rem; }
  label {
    display: flex; flex-direction: column; gap: 0.35rem;
    font-family: "Inter", sans-serif; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  input, select {
    font-family: "Inter", sans-serif; font-size: 14px; font-weight: 400;
    text-transform: none; letter-spacing: normal;
    color: #1a1612; background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 6px; padding: 0.6rem 0.75rem;
  }
  input:focus, select:focus { outline: none; border-color: #b33e1f; }
  .row { display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; }
  .auth-toggle, .auth-fixed {
    display: flex; flex-direction: row; gap: 1rem;
    padding: 0.75rem 1rem; background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.1); border-radius: 6px;
    font-family: "Inter", sans-serif; font-size: 13px; color: #1a1612;
    text-transform: none; letter-spacing: normal; font-weight: 400;
  }
  .radio { flex-direction: row; align-items: center; gap: 0.4rem;
    text-transform: none; letter-spacing: normal; font-weight: 400; font-size: 13px;
    color: #1a1612;
  }
  .radio input { margin: 0; }
  .wallet-pick { display: flex; flex-direction: column; gap: 0.5rem;
    padding: 0.75rem 1rem; background: #fff;
    border: 1px dashed rgba(26, 22, 18, 0.25); border-radius: 6px;
  }
  .wallet-label {
    font-family: "Inter", sans-serif; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  .wallet-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .path-mono {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 12px; color: rgba(26, 22, 18, 0.7);
    word-break: break-all;
  }
  .muted { color: rgba(26, 22, 18, 0.55); font-size: 13px; }
  .err { color: #7a2a14; font-size: 13px; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  button {
    flex: 1; font-family: "Space Grotesk", sans-serif; font-size: 14px;
    font-weight: 500; letter-spacing: 0.04em; color: #f6f1e8;
    background: #1a1612; border: none; border-radius: 6px;
    padding: 0.85rem 1rem; cursor: pointer;
  }
  button.ghost { color: #1a1612; background: transparent;
    border: 1px solid rgba(26, 22, 18, 0.2);
  }
  button:disabled { opacity: 0.5; cursor: progress; }
  button:hover:not(:disabled) {
    background: #b33e1f; color: #f6f1e8; border-color: #b33e1f;
  }
  .banner { padding: 0.75rem 1rem; border-radius: 6px;
    font-family: "Inter", sans-serif; font-size: 13px;
  }
  .banner.warn { background: rgba(179, 62, 31, 0.08);
    color: #7a2a14; border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .status { font-family: "Inter", sans-serif; font-size: 13px;
    line-height: 1.5; padding: 0.85rem 1rem; border-radius: 6px;
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .status.ok { background: rgba(46, 125, 50, 0.08);
    color: #1b5e20; border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err { background: rgba(179, 62, 31, 0.08);
    color: #7a2a14; border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta { font-size: 11px; opacity: 0.6; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ConnectionForm.svelte
git commit -m "feat: ConnectionForm with auth-type radio and wallet branch"
```

---

## Task 11: New connection route — initial state for both types

**Files:**
- Modify: `src/routes/connections/new/+page.svelte`

- [ ] **Step 1: Replace new/+page.svelte**

Overwrite `src/routes/connections/new/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import ConnectionForm from "$lib/ConnectionForm.svelte";
  import { saveConnection, type ConnectionInput } from "$lib/connections";

  const initial: ConnectionInput = {
    authType: "basic",
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
  <header><h1>New connection</h1></header>
  <ConnectionForm {initial} submitLabel="Save" {onSave} {onCancel} />
</main>

<style>
  :global(body) {
    margin: 0; background: #f6f1e8; color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px; margin: 0 auto; padding: 4rem 2rem;
    display: flex; flex-direction: column; gap: 2rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif; font-weight: 500;
    font-size: 28px; letter-spacing: 0.02em; margin: 0; line-height: 1;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/connections/new/+page.svelte
git commit -m "feat: new-connection page seeds both auth types via initial state"
```

---

## Task 12: Edit route — hydrate wallet meta + walletPasswordMissing

**Files:**
- Modify: `src/routes/connections/[id]/edit/+page.svelte`

- [ ] **Step 1: Replace edit/+page.svelte**

Overwrite `src/routes/connections/[id]/edit/+page.svelte`:

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
  let walletPasswordMissing = $state(false);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    const id = page.params.id!;
    const res = await getConnection(id);
    if (!res.ok) {
      loadError = res.error.message;
      return;
    }
    const { meta, password, passwordMissing: pmiss, walletPassword, walletPasswordMissing: wmiss } = res.data;
    if (meta.authType === "basic") {
      initial = {
        authType: "basic",
        id: meta.id,
        name: meta.name,
        host: meta.host,
        port: meta.port,
        serviceName: meta.serviceName,
        username: meta.username,
        password,
      };
    } else {
      initial = {
        authType: "wallet",
        id: meta.id,
        name: meta.name,
        walletPassword: walletPassword ?? "",
        connectAlias: meta.connectAlias,
        username: meta.username,
        password,
      };
      walletPasswordMissing = wmiss ?? false;
    }
    passwordMissing = pmiss;
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
  <header><h1>Edit connection</h1></header>

  {#if loadError}
    <div class="status err">
      <strong>Failed to load.</strong>
      <span>{loadError}</span>
      <button onclick={() => goto("/")}>Back to list</button>
    </div>
  {:else if initial}
    <ConnectionForm
      {initial}
      submitLabel="Save"
      {passwordMissing}
      {walletPasswordMissing}
      isEdit={true}
      {onSave}
      {onCancel}
    />
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0; background: #f6f1e8; color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px; margin: 0 auto; padding: 4rem 2rem;
    display: flex; flex-direction: column; gap: 2rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif; font-weight: 500;
    font-size: 28px; letter-spacing: 0.02em; margin: 0; line-height: 1;
  }
  .muted { color: rgba(26, 22, 18, 0.5); font-size: 13px; }
  .status.err {
    background: rgba(179, 62, 31, 0.08); color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem; border-radius: 6px;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors. (May surface 1 pre-existing warning from MVP2 about `$state(initial)` capture — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/connections/\[id\]/edit/+page.svelte
git commit -m "feat: edit page hydrates wallet meta and walletPasswordMissing"
```

---

## Task 13: Landing list — wallet badge + meta variant

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Update the list rendering**

In `src/routes/+page.svelte`, replace the `{#each connections as c (c.id)}` block (currently around lines 81–92) with:

```svelte
      {#each connections as c (c.id)}
        <li>
          <div class="info">
            <div class="title-row">
              <strong>{c.name}</strong>
              {#if c.authType === "wallet"}
                <span class="badge">wallet</span>
              {/if}
            </div>
            {#if c.authType === "basic"}
              <span class="meta">{c.username}@{c.host}:{c.port}/{c.serviceName}</span>
            {:else}
              <span class="meta">{c.username}@{c.connectAlias}</span>
            {/if}
          </div>
          <div class="actions">
            <button class="ghost" onclick={() => goto(`/connections/${c.id}/edit`)}>Edit</button>
            <button class="ghost danger" onclick={() => onDelete(c)}>Delete</button>
          </div>
        </li>
      {/each}
```

In the same file, add to the `<style>` block (anywhere inside it):

```css
  .title-row { display: flex; align-items: center; gap: 0.5rem; }
  .badge {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
  }
```

- [ ] **Step 2: Type-check + build**

Run: `bun run check && bun run build`
Expected: 0 errors, build succeeds (adapter-static produces `build/`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: wallet badge and connect-alias meta on landing list"
```

---

## Task 14: End-to-end smoke

**Files:** none (manual verification)

- [ ] **Step 1: Build everything**

Run, in order:
```bash
cd /Users/geraldoviana/Documents/veesker
./scripts/build-sidecar.sh
cd src-tauri && cargo test --lib
```
Expected: sidecar binary present in `src-tauri/binaries/`; all Rust unit tests pass (parser, wallet zip, store including migration).

- [ ] **Step 2: Smoke the basic regression — create + test + edit + delete**

Run: `bun run tauri dev`

1. Open the app, click **+ New connection**, fill the basic form against your local Oracle 23ai container, click **Test** → expect green banner.
2. Save → return to landing list, see the connection.
3. Click **Edit**, change `Name`, save, verify the change in the list.
4. Click **Delete**, confirm prompt, verify it disappears.

Expected: existing MVP2 behavior is unchanged; no regression.

- [ ] **Step 3: Migration check on existing user data**

If your dev `appDataDir` already has a `veesker.db` from MVP2:

```bash
sqlite3 ~/Library/Application\ Support/dev.veesker.app/veesker.db "PRAGMA table_info(connections);"
```

Expected: output includes `auth_type` and `connect_alias` columns. Existing rows still show `'basic'` in `auth_type`.

- [ ] **Step 4: Smoke the wallet path (partial — no real wallet)**

Build a fabricated wallet zip for the form to chew on:

```bash
cd /tmp
mkdir -p fake-wallet
cat > fake-wallet/tnsnames.ora <<'EOF'
fakedb_high = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.fake.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=high.fakedb)))
fakedb_medium = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.fake.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=medium.fakedb)))
fakedb_low = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.fake.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=low.fakedb)))
EOF
echo "fake sso bytes" > fake-wallet/cwallet.sso
cd fake-wallet && zip /tmp/fake-wallet.zip tnsnames.ora cwallet.sso && cd -
```

In the running app:
1. Click **+ New connection**, choose **Wallet** radio.
2. Click **Choose wallet .zip…** and pick `/tmp/fake-wallet.zip`.
3. Verify the alias dropdown populates with `fakedb_high`, `fakedb_medium`, `fakedb_low`.
4. Pick `fakedb_high`, fill `wallet password = test123`, `username = admin`, `password = secret`, `name = Fake Wallet`, click **Save**.
5. Verify it appears in the landing list with the `wallet` badge and meta `admin@fakedb_high`.

- [ ] **Step 5: Verify on-disk state**

```bash
APP_DIR=~/Library/Application\ Support/dev.veesker.app
ls -la "$APP_DIR/wallets/"     # should show one directory named with the connection's UUID
sqlite3 "$APP_DIR/veesker.db" "SELECT id, name, auth_type, connect_alias FROM connections;"
security find-generic-password -s veesker -a "connection:<uuid>" -w
security find-generic-password -s veesker -a "connection:<uuid>:wallet" -w
```

Expected: wallet directory contains `tnsnames.ora` + `cwallet.sso`; DB row shows `auth_type='wallet'`, `connect_alias='fakedb_high'`; both keychain entries return their stored passwords.

- [ ] **Step 6: Edit the wallet connection without re-uploading**

In the app: click **Edit** on the fake wallet connection. The form should show:
- Auth: Wallet (mTLS) (locked)
- Wallet path: `(saved)` with a **Replace wallet…** button
- Alias dropdown pre-selected to `fakedb_high` (from the saved wallet's tnsnames)

Change the `Name`, click **Save**, return to list, verify the rename.

- [ ] **Step 7: Test sidecar wallet path receives the right payload**

Click **Test** on the fake-wallet connection (after save). Expect a sidecar error like `ORA-12154` or TLS handshake failure (the wallet is fake — it can't reach a real ADB). The error message means the pipeline reached `oracledb.getConnection` with the wallet config — which is the most we can verify without a real wallet.

- [ ] **Step 8: Delete the wallet connection — full cleanup**

Click **Delete** on the fake wallet entry, confirm. Then verify:

```bash
ls -la "$APP_DIR/wallets/"     # empty
security find-generic-password -s veesker -a "connection:<uuid>" -w 2>&1 || echo "gone"
security find-generic-password -s veesker -a "connection:<uuid>:wallet" -w 2>&1 || echo "gone"
sqlite3 "$APP_DIR/veesker.db" "SELECT count(*) FROM connections WHERE id='<uuid>';"  # 0
```

Expected: wallet dir empty, both keychain entries gone, DB row gone.

- [ ] **Step 9: Tag the milestone (no commit)**

```bash
cd /Users/geraldoviana/Documents/veesker
git tag v0.0.4-wallet-mvp
```

(Do not push. Tag is local only, matches MVP1/MVP2 pattern.)

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| `auth_type` + `connect_alias` columns | Task 4 |
| Migration via table recreate | Task 4 |
| Wallet zip → `appDataDir/wallets/{id}/` | Task 6 (`save` wallet branch) + Task 7 (lib.rs wallets root) |
| Required-file validation (`tnsnames.ora`, `cwallet.sso`) | Task 3 |
| Wallet password keychain `connection:{id}:wallet` | Task 5 + Task 6 |
| `wallet_inspect` command | Task 6 (`inspect_wallet`) + Task 7 (command) |
| Discriminated `ConnectionInput` | Task 6 |
| `wallet_password_missing` flag | Task 6 (`get`) |
| `tnsnames.ora` parser | Task 2 |
| Sidecar discriminated union | Task 8 |
| Auth-type radio in form | Task 10 |
| Wallet drop zone + alias dropdown | Task 10 |
| Wallet badge in landing list | Task 13 |
| Edit cannot change auth type | Task 6 (`assemble_*` checks) + Task 10 (radio hidden when `isEdit`) |
| Delete cleanup (dir + 2 keychain entries) | Task 6 (`delete`) |
| `INVALID_WALLET` / `WALLET_MISSING` / `INVALID_ALIAS` errors | Task 6 |
| Smoke (partial — no real wallet) | Task 14 |

All spec requirements have a task.
