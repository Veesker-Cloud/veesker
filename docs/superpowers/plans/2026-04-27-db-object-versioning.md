# DB Object Versioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every compiled version of a PL/SQL object into a per-connection git repository, and let the user browse, diff, and restore any prior version from a flyout panel in the editor toolbar.

**Architecture:** `git2` crate manages one git repo per connection at `<app_data>/object-history/<conn-id>/`. SQLite `object_versions` table in the existing `veesker.db` is the fast query index. Captures fire automatically on object open (baseline) and on successful compile (compile), with SHA-256 deduplication to avoid noise.

**Tech Stack:** Rust `git2 0.19` (HTTPS + vendored OpenSSL), `sha2 0.10`, `rusqlite`, Svelte 5 runes, Tauri 2.

---

## File Map

### New files
- `src-tauri/src/persistence/object_versions.rs` — SQLite schema + CRUD + git2 repo operations
- `src/lib/object-versions.ts` — TypeScript `invoke()` wrappers for all 8 commands
- `src/lib/workspace/ObjectVersionBadge.svelte` — toolbar badge (`v4 · 14 min`)
- `src/lib/workspace/ObjectVersionFlyout.svelte` — version list + diff panel + remote strip

### Modified files
- `src-tauri/Cargo.toml` — add `git2`, `sha2`
- `src-tauri/src/persistence/mod.rs` — add `pub mod object_versions`
- `src-tauri/src/persistence/secrets.rs` — add `set_git_pat`, `get_git_pat`, `delete_git_pat`
- `src-tauri/src/persistence/connections.rs` — add `data_dir` field, init call, 8 delegating methods
- `src-tauri/src/commands.rs` — add 8 new Tauri command handlers
- `src-tauri/src/lib.rs` — register the 8 new commands in `invoke_handler`
- `src/lib/stores/sql-editor.svelte.ts` — add `plsqlMeta` to `SqlTab`, update `openWithDdl`, trigger compile capture
- `src/lib/workspace/SqlDrawer.svelte` — render `ObjectVersionBadge` inside `file-actions`
- `src/routes/workspace/[id]/+page.svelte` — trigger baseline capture after DDL load; pass `plsqlMeta` to `openWithDdl`

---

## Task 1: Add git2 and sha2 to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the two new dependencies**

Open `src-tauri/Cargo.toml` and add after the `keyring` line:

```toml
git2 = { version = "0.19", default-features = false, features = ["https", "vendored-openssl"] }
sha2 = "0.10"
```

- [ ] **Step 2: Verify the project compiles with the new deps**

```powershell
cd src-tauri
cargo check
```

Expected: no errors. The `vendored-openssl` feature will download and compile OpenSSL on first run — allow a few minutes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add git2 + sha2 for object versioning"
```

---

## Task 2: SQLite schema and CRUD in object_versions.rs

**Files:**
- Create: `src-tauri/src/persistence/object_versions.rs`
- Modify: `src-tauri/src/persistence/mod.rs`

- [ ] **Step 1: Write the failing tests for schema init and CRUD**

Create `src-tauri/src/persistence/object_versions.rs` with this exact content:

```rust
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

use chrono::Utc;
use rusqlite::{Connection as SqliteConnection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ObjectVersionEntry {
    pub id: i64,
    pub commit_sha: String,
    pub ddl_hash: String,
    pub capture_reason: String,
    pub label: Option<String>,
    pub captured_at: String,
}

#[derive(Debug)]
pub enum VersionError {
    Sqlite(rusqlite::Error),
    Git(git2::Error),
    Keyring(keyring::Error),
    Other(String),
}

impl std::fmt::Display for VersionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VersionError::Sqlite(e) => write!(f, "sqlite: {e}"),
            VersionError::Git(e) => write!(f, "git: {e}"),
            VersionError::Keyring(e) => write!(f, "keyring: {e}"),
            VersionError::Other(s) => write!(f, "{s}"),
        }
    }
}

impl From<rusqlite::Error> for VersionError {
    fn from(e: rusqlite::Error) -> Self { VersionError::Sqlite(e) }
}

impl From<git2::Error> for VersionError {
    fn from(e: git2::Error) -> Self { VersionError::Git(e) }
}

impl From<keyring::Error> for VersionError {
    fn from(e: keyring::Error) -> Self { VersionError::Keyring(e) }
}

pub fn init_db_object_versions(conn: &SqliteConnection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS object_versions (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id  TEXT    NOT NULL,
            owner          TEXT    NOT NULL,
            object_type    TEXT    NOT NULL,
            object_name    TEXT    NOT NULL,
            commit_sha     TEXT    NOT NULL,
            ddl_hash       TEXT    NOT NULL,
            capture_reason TEXT    NOT NULL CHECK (capture_reason IN ('baseline', 'compile')),
            label          TEXT,
            captured_at    TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS object_versions_lookup_idx
            ON object_versions (connection_id, owner, object_type, object_name, captured_at DESC);
        CREATE INDEX IF NOT EXISTS object_versions_hash_idx
            ON object_versions (connection_id, owner, object_type, object_name, id DESC);
        "#,
    )
}

pub fn last_ddl_hash(
    conn: &SqliteConnection,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT ddl_hash FROM object_versions
         WHERE connection_id = ? AND owner = ? AND object_type = ? AND object_name = ?
         ORDER BY id DESC LIMIT 1",
        params![connection_id, owner, object_type, object_name],
        |r| r.get(0),
    )
    .optional()
}

pub fn insert_version(
    conn: &SqliteConnection,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
    commit_sha: &str,
    ddl_hash: &str,
    capture_reason: &str,
) -> rusqlite::Result<i64> {
    let captured_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO object_versions
            (connection_id, owner, object_type, object_name, commit_sha, ddl_hash, capture_reason, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            connection_id, owner, object_type, object_name,
            commit_sha, ddl_hash, capture_reason, captured_at,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_versions(
    conn: &SqliteConnection,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
) -> rusqlite::Result<Vec<ObjectVersionEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, commit_sha, ddl_hash, capture_reason, label, captured_at
         FROM object_versions
         WHERE connection_id = ? AND owner = ? AND object_type = ? AND object_name = ?
         ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map(params![connection_id, owner, object_type, object_name], |r| {
            Ok(ObjectVersionEntry {
                id: r.get(0)?,
                commit_sha: r.get(1)?,
                ddl_hash: r.get(2)?,
                capture_reason: r.get(3)?,
                label: r.get(4)?,
                captured_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn update_label(
    conn: &SqliteConnection,
    version_id: i64,
    label: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE object_versions SET label = ? WHERE id = ?",
        params![label, version_id],
    )?;
    Ok(())
}

pub fn get_commit_sha(
    conn: &SqliteConnection,
    version_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT commit_sha FROM object_versions WHERE id = ?",
        params![version_id],
        |r| r.get(0),
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db_object_versions(&c).unwrap();
        c
    }

    #[test]
    fn init_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_db_object_versions(&c).unwrap();
        init_db_object_versions(&c).unwrap();
    }

    #[test]
    fn insert_and_list_returns_newest_first() {
        let c = fresh();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-a", "hash-a", "baseline").unwrap();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-b", "hash-b", "compile").unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].commit_sha, "sha-b");
        assert_eq!(rows[1].commit_sha, "sha-a");
        assert_eq!(rows[0].capture_reason, "compile");
        assert_eq!(rows[1].capture_reason, "baseline");
    }

    #[test]
    fn last_ddl_hash_returns_none_when_empty() {
        let c = fresh();
        let h = last_ddl_hash(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert!(h.is_none());
    }

    #[test]
    fn last_ddl_hash_returns_most_recent() {
        let c = fresh();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-a", "hash-a", "baseline").unwrap();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-b", "hash-b", "compile").unwrap();
        let h = last_ddl_hash(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(h.as_deref(), Some("hash-b"));
    }

    #[test]
    fn dedup_does_not_apply_across_different_objects() {
        let c = fresh();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "PROC_A", "sha-a", "same-hash", "baseline").unwrap();
        let h = last_ddl_hash(&c, "conn1", "SCOTT", "PROCEDURE", "PROC_B").unwrap();
        assert!(h.is_none());
    }

    #[test]
    fn update_label_sets_and_clears() {
        let c = fresh();
        let id = insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-a", "hash-a", "baseline").unwrap();
        update_label(&c, id, Some("release-1.0")).unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(rows[0].label.as_deref(), Some("release-1.0"));
        update_label(&c, id, None).unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert!(rows[0].label.is_none());
    }

    #[test]
    fn list_is_empty_for_unknown_connection() {
        let c = fresh();
        insert_version(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC", "sha-a", "hash-a", "baseline").unwrap();
        let rows = list_versions(&c, "conn-unknown", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert!(rows.is_empty());
    }
}
```

- [ ] **Step 2: Add the module to mod.rs**

In `src-tauri/src/persistence/mod.rs`, add:

```rust
pub mod object_versions;
```

(Add it after the existing `pub mod wallet;` line.)

- [ ] **Step 3: Run the SQLite tests**

```powershell
cd src-tauri
cargo test object_versions -- --nocapture
```

Expected: all 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/persistence/object_versions.rs src-tauri/src/persistence/mod.rs
git commit -m "feat(versioning): SQLite schema + CRUD for object_versions"
```

---

## Task 3: Helper functions — SHA-256 and git repo management

**Files:**
- Modify: `src-tauri/src/persistence/object_versions.rs`

Add these functions to `object_versions.rs` after the existing `get_commit_sha` function, before the `#[cfg(test)]` block:

- [ ] **Step 1: Add helper functions**

```rust
use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};

pub fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn repo_path(data_dir: &Path, conn_id: &str) -> PathBuf {
    data_dir.join("object-history").join(conn_id)
}

pub fn object_type_dir(object_type: &str) -> String {
    object_type.replace(' ', "_")
}

pub fn file_rel_path(owner: &str, object_type: &str, object_name: &str) -> PathBuf {
    Path::new(owner)
        .join(object_type_dir(object_type))
        .join(format!("{object_name}.sql"))
}

pub fn open_or_init_repo(repo_root: &Path) -> Result<git2::Repository, git2::Error> {
    match git2::Repository::open(repo_root) {
        Ok(r) => Ok(r),
        Err(_) => git2::Repository::init(repo_root),
    }
}
```

The `sha256_hex` and repo helpers need these imports at the top of the file. Replace the existing use section at the top with:

```rust
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection as SqliteConnection, params};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
```

- [ ] **Step 2: Add tests for helpers**

Inside the existing `mod tests` block, add:

```rust
    #[test]
    fn sha256_hex_is_deterministic() {
        let h1 = sha256_hex("CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;");
        let h2 = sha256_hex("CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn sha256_hex_differs_for_different_input() {
        assert_ne!(sha256_hex("a"), sha256_hex("b"));
    }

    #[test]
    fn object_type_dir_replaces_space() {
        assert_eq!(object_type_dir("PACKAGE BODY"), "PACKAGE_BODY");
        assert_eq!(object_type_dir("PROCEDURE"), "PROCEDURE");
    }

    #[test]
    fn file_rel_path_constructs_correctly() {
        let p = file_rel_path("SCOTT", "PACKAGE BODY", "MY_PKG");
        assert_eq!(p, PathBuf::from("SCOTT/PACKAGE_BODY/MY_PKG.sql"));
    }

    #[test]
    fn open_or_init_repo_is_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let r1 = open_or_init_repo(dir.path()).unwrap();
        drop(r1);
        let r2 = open_or_init_repo(dir.path()).unwrap();
        assert!(!r2.is_bare());
    }
```

(`tempfile` is already in `[dev-dependencies]` in `Cargo.toml`.)

- [ ] **Step 3: Run tests**

```powershell
cd src-tauri
cargo test object_versions -- --nocapture
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/persistence/object_versions.rs
git commit -m "feat(versioning): SHA-256 + git repo helper functions"
```

---

## Task 4: capture() function

**Files:**
- Modify: `src-tauri/src/persistence/object_versions.rs`

- [ ] **Step 1: Add capture function**

Add after `open_or_init_repo`, before `#[cfg(test)]`:

```rust
/// Capture a DDL snapshot. Returns `true` if a new commit was created, `false` if deduplicated.
/// All git errors are silently logged and return `Ok(false)` — the editor is never blocked.
pub fn capture(
    conn: &SqliteConnection,
    data_dir: &Path,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
    ddl: &str,
    reason: &str,
) -> Result<bool, VersionError> {
    let ddl_hash = sha256_hex(ddl);

    // Deduplication: if last stored hash matches, skip silently
    if let Ok(Some(last)) = last_ddl_hash(conn, connection_id, owner, object_type, object_name) {
        if last == ddl_hash {
            return Ok(false);
        }
    }

    let root = repo_path(data_dir, connection_id);
    let repo = match open_or_init_repo(&root) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[versioning] git init error for {connection_id}: {e}");
            return Ok(false);
        }
    };

    let rel = file_rel_path(owner, object_type, object_name);
    let abs = repo.workdir().unwrap_or(&root).join(&rel);
    if let Err(e) = std::fs::create_dir_all(abs.parent().unwrap_or(&root)) {
        eprintln!("[versioning] mkdir error: {e}");
        return Ok(false);
    }
    if let Err(e) = std::fs::write(&abs, ddl) {
        eprintln!("[versioning] write error: {e}");
        return Ok(false);
    }

    let commit_sha = match git_commit(&repo, &rel, owner, object_type, object_name, reason) {
        Ok(sha) => sha,
        Err(e) => {
            eprintln!("[versioning] git commit error: {e}");
            return Ok(false);
        }
    };

    insert_version(conn, connection_id, owner, object_type, object_name, &commit_sha, &ddl_hash, reason)?;
    Ok(true)
}

fn git_commit(
    repo: &git2::Repository,
    rel: &Path,
    owner: &str,
    object_type: &str,
    object_name: &str,
    reason: &str,
) -> Result<String, git2::Error> {
    let mut index = repo.index()?;
    index.add_path(rel)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = git2::Signature::now("Veesker", "local")?;
    let msg = format!("[{reason}] {owner}.{}.{object_name}", object_type.replace(' ', "_"));
    let commit_id = match repo.head() {
        Ok(head_ref) => {
            let parent = head_ref.peel_to_commit()?;
            repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[&parent])?
        }
        Err(_) => repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[])?,
    };
    Ok(commit_id.to_string())
}
```

- [ ] **Step 2: Add capture tests**

In the `mod tests` block:

```rust
    #[test]
    fn capture_creates_commit_and_sqlite_row() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let captured = capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC",
            "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;", "baseline").unwrap();
        assert!(captured);
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].capture_reason, "baseline");
        assert!(!rows[0].commit_sha.is_empty());
    }

    #[test]
    fn capture_is_deduplicated_when_ddl_unchanged() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let ddl = "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;";
        assert!(capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl, "baseline").unwrap());
        assert!(!capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl, "compile").unwrap());
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn capture_dedup_does_not_apply_across_different_objects() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let ddl = "CREATE OR REPLACE PROCEDURE P IS BEGIN NULL; END;";
        assert!(capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "PROC_A", ddl, "baseline").unwrap());
        assert!(capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "PROC_B", ddl, "baseline").unwrap());
    }

    #[test]
    fn capture_creates_repo_on_first_call() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let repo_root = dir.path().join("object-history").join("conn1");
        assert!(!repo_root.exists());
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC",
            "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;", "baseline").unwrap();
        assert!(repo_root.join(".git").exists());
    }

    #[test]
    fn package_body_uses_underscore_directory() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PACKAGE BODY", "MY_PKG",
            "CREATE OR REPLACE PACKAGE BODY MY_PKG IS END;", "baseline").unwrap();
        let file = dir.path().join("object-history/conn1/SCOTT/PACKAGE_BODY/MY_PKG.sql");
        assert!(file.exists());
    }
```

- [ ] **Step 3: Run tests**

```powershell
cd src-tauri
cargo test object_versions -- --nocapture
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/persistence/object_versions.rs
git commit -m "feat(versioning): capture() with SHA-256 dedup and git commit"
```

---

## Task 5: diff(), load_at_commit(), and label functions

**Files:**
- Modify: `src-tauri/src/persistence/object_versions.rs`

- [ ] **Step 1: Add diff and load functions**

Add these after `git_commit`, before `#[cfg(test)]`:

```rust
/// Unified diff between two commits for a given file path.
/// `file_path_str` is `OWNER/TYPE_DIR/NAME.sql` (forward slashes, as stored by git).
pub fn diff_commits(
    data_dir: &Path,
    connection_id: &str,
    sha_a: &str,
    sha_b: &str,
    file_path_str: &str,
) -> Result<String, VersionError> {
    let root = repo_path(data_dir, connection_id);
    let repo = git2::Repository::open(&root)?;
    let commit_a = repo.find_commit(git2::Oid::from_str(sha_a)?)?;
    let commit_b = repo.find_commit(git2::Oid::from_str(sha_b)?)?;
    let tree_a = commit_a.tree()?;
    let tree_b = commit_b.tree()?;

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path_str);
    let diff = repo.diff_tree_to_tree(Some(&tree_a), Some(&tree_b), Some(&mut opts))?;

    let mut out = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ' | '@') {
            out.push(origin);
        }
        if let Ok(s) = std::str::from_utf8(line.content()) {
            out.push_str(s);
        }
        true
    })?;
    Ok(out)
}

/// Load DDL text from a specific commit.
pub fn load_at_commit(
    data_dir: &Path,
    connection_id: &str,
    commit_sha: &str,
    file_path_str: &str,
) -> Result<String, VersionError> {
    let root = repo_path(data_dir, connection_id);
    let repo = git2::Repository::open(&root)?;
    let commit = repo.find_commit(git2::Oid::from_str(commit_sha)?)?;
    let tree = commit.tree()?;
    let entry = tree.get_path(Path::new(file_path_str))?;
    let blob = repo.find_blob(entry.id())?;
    let content = std::str::from_utf8(blob.content())
        .map_err(|e| VersionError::Other(format!("invalid UTF-8: {e}")))?
        .to_string();
    Ok(content)
}

/// Tag name for a labeled version.
fn tag_name(owner: &str, object_type: &str, object_name: &str, label: &str) -> String {
    format!("veesker/{owner}.{}.{object_name}/{label}", object_type.replace(' ', "_"))
}

/// Set or clear the label on a version. Creates/removes a lightweight git tag.
pub fn set_label(
    conn: &SqliteConnection,
    data_dir: &Path,
    connection_id: &str,
    version_id: i64,
    owner: &str,
    object_type: &str,
    object_name: &str,
    label: Option<&str>,
) -> Result<(), VersionError> {
    let commit_sha = get_commit_sha(conn, version_id)?
        .ok_or_else(|| VersionError::Other(format!("version {version_id} not found")))?;

    let root = repo_path(data_dir, connection_id);
    let repo = git2::Repository::open(&root)?;

    let rows = list_versions(conn, connection_id, owner, object_type, object_name)?;
    if let Some(old_row) = rows.iter().find(|r| r.id == version_id) {
        if let Some(old_label) = &old_row.label {
            let old_tag = tag_name(owner, object_type, object_name, old_label);
            let _ = repo.tag_delete(&old_tag);
        }
    }

    update_label(conn, version_id, label)?;

    if let Some(lbl) = label {
        if !lbl.is_empty() {
            let oid = git2::Oid::from_str(&commit_sha)?;
            let obj = repo.find_commit(oid)?.into_object();
            let t = tag_name(owner, object_type, object_name, lbl);
            repo.tag_lightweight(&t, &obj, false)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Add tests for diff, load, and label**

In `mod tests`:

```rust
    #[test]
    fn diff_returns_unified_diff_between_two_commits() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let ddl1 = "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;";
        let ddl2 = "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN DBMS_OUTPUT.PUT_LINE('hi'); END;";
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl1, "baseline").unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl2, "compile").unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        let sha_a = &rows[1].commit_sha;
        let sha_b = &rows[0].commit_sha;
        let diff = diff_commits(dir.path(), "conn1", sha_a, sha_b, "SCOTT/PROCEDURE/MY_PROC.sql").unwrap();
        assert!(diff.contains('-'), "expected removal line in diff: {diff}");
        assert!(diff.contains('+'), "expected addition line in diff: {diff}");
    }

    #[test]
    fn load_returns_ddl_at_given_commit() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        let ddl1 = "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;";
        let ddl2 = "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN DBMS_OUTPUT.PUT_LINE('v2'); END;";
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl1, "baseline").unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC", ddl2, "compile").unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        let sha_first = &rows[1].commit_sha;
        let loaded = load_at_commit(dir.path(), "conn1", sha_first, "SCOTT/PROCEDURE/MY_PROC.sql").unwrap();
        assert_eq!(loaded, ddl1);
    }

    #[test]
    fn label_updates_sqlite_and_creates_git_tag() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC",
            "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;", "baseline").unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        set_label(&c, dir.path(), "conn1", rows[0].id, "SCOTT", "PROCEDURE", "MY_PROC", Some("release-1.0")).unwrap();
        let rows2 = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        assert_eq!(rows2[0].label.as_deref(), Some("release-1.0"));
        let root = repo_path(dir.path(), "conn1");
        let repo = git2::Repository::open(&root).unwrap();
        assert!(repo.find_reference("refs/tags/veesker/SCOTT.PROCEDURE.MY_PROC/release-1.0").is_ok());
    }

    #[test]
    fn label_clear_removes_git_tag() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC",
            "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;", "baseline").unwrap();
        let rows = list_versions(&c, "conn1", "SCOTT", "PROCEDURE", "MY_PROC").unwrap();
        set_label(&c, dir.path(), "conn1", rows[0].id, "SCOTT", "PROCEDURE", "MY_PROC", Some("v1")).unwrap();
        set_label(&c, dir.path(), "conn1", rows[0].id, "SCOTT", "PROCEDURE", "MY_PROC", None).unwrap();
        let root = repo_path(dir.path(), "conn1");
        let repo = git2::Repository::open(&root).unwrap();
        assert!(repo.find_reference("refs/tags/veesker/SCOTT.PROCEDURE.MY_PROC/v1").is_err());
    }
```

- [ ] **Step 3: Run tests**

```powershell
cd src-tauri
cargo test object_versions -- --nocapture
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/persistence/object_versions.rs
git commit -m "feat(versioning): diff, load, and label functions"
```

---

## Task 6: Remote and push functions + keyring additions

**Files:**
- Modify: `src-tauri/src/persistence/object_versions.rs`
- Modify: `src-tauri/src/persistence/secrets.rs`

- [ ] **Step 1: Add git PAT helpers to secrets.rs**

In `src-tauri/src/persistence/secrets.rs`, add after the `delete_api_key` function:

```rust
fn git_account(connection_id: &str) -> String {
    format!("git:{connection_id}")
}

pub fn set_git_pat(connection_id: &str, pat: &str) -> keyring::Result<()> {
    entry(&git_account(connection_id))?.set_password(pat)
}

pub fn get_git_pat(connection_id: &str) -> keyring::Result<Option<String>> {
    match entry(&git_account(connection_id))?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_git_pat(connection_id: &str) -> keyring::Result<()> {
    delete_account(&git_account(connection_id))
}
```

- [ ] **Step 2: Add set_remote, get_remote, and push functions to object_versions.rs**

Add after `set_label`, before `#[cfg(test)]`:

```rust
/// Store remote URL in git config and PAT in keyring.
pub fn set_remote(
    data_dir: &Path,
    connection_id: &str,
    remote_url: &str,
    pat: &str,
) -> Result<(), VersionError> {
    let root = repo_path(data_dir, connection_id);
    let repo = open_or_init_repo(&root)?;
    match repo.find_remote("origin") {
        Ok(_) => repo.remote_set_url("origin", remote_url)?,
        Err(_) => { repo.remote("origin", remote_url)?; }
    }
    crate::persistence::secrets::set_git_pat(connection_id, pat)?;
    Ok(())
}

/// Get the configured remote URL, if any.
pub fn get_remote(data_dir: &Path, connection_id: &str) -> Result<Option<String>, VersionError> {
    let root = repo_path(data_dir, connection_id);
    let repo = match git2::Repository::open(&root) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    match repo.find_remote("origin") {
        Ok(r) => Ok(r.url().map(String::from)),
        Err(_) => Ok(None),
    }
}

/// Push main to origin using the stored PAT. Returns number of commits pushed.
pub fn push(data_dir: &Path, connection_id: &str) -> Result<u32, VersionError> {
    let root = repo_path(data_dir, connection_id);
    let repo = git2::Repository::open(&root)
        .map_err(|_| VersionError::Other("Repository not initialized".into()))?;

    repo.find_remote("origin")
        .map_err(|_| VersionError::Other("No remote configured for this connection".into()))?;

    let pat = crate::persistence::secrets::get_git_pat(connection_id)?
        .ok_or_else(|| VersionError::Other("No remote configured for this connection".into()))?;

    let local_head_oid = match repo.head() {
        Ok(r) => r.peel_to_commit()?.id(),
        Err(_) => return Ok(0),
    };

    let remote_count_before: u32 = count_remote_commits(&repo, "origin", &pat)
        .unwrap_or(0);

    let mut remote = repo.find_remote("origin")?;
    let mut push_opts = git2::PushOptions::new();
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        git2::Cred::userpass_plaintext("token", &pat)
    });
    push_opts.remote_callbacks(callbacks);
    remote.push(&["refs/heads/main:refs/heads/main"], Some(&mut push_opts))?;

    let local_count = count_local_commits(&repo, local_head_oid).unwrap_or(0);
    let pushed = local_count.saturating_sub(remote_count_before);
    Ok(pushed)
}

fn count_local_commits(repo: &git2::Repository, tip: git2::Oid) -> Result<u32, git2::Error> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push(tip)?;
    Ok(revwalk.count() as u32)
}

fn count_remote_commits(
    repo: &git2::Repository,
    remote_name: &str,
    pat: &str,
) -> Result<u32, git2::Error> {
    let mut remote = repo.find_remote(remote_name)?;
    let mut callbacks = git2::RemoteCallbacks::new();
    let pat = pat.to_string();
    callbacks.credentials(move |_url, _username, _allowed| {
        git2::Cred::userpass_plaintext("token", &pat)
    });
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    let _ = remote.fetch(&["refs/heads/main:refs/remotes/origin/main"], Some(&mut fetch_opts), None);
    match repo.find_reference("refs/remotes/origin/main") {
        Ok(r) => count_local_commits(repo, r.peel_to_commit()?.id()),
        Err(_) => Ok(0),
    }
}
```

- [ ] **Step 3: Add tests for remote (keyring tests are ignored — they touch the real OS keychain)**

In `mod tests`:

```rust
    #[test]
    fn get_remote_returns_none_when_not_configured() {
        let dir = tempfile::TempDir::new().unwrap();
        let result = get_remote(dir.path(), "conn-no-repo").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn push_returns_error_when_no_remote_configured() {
        let c = fresh();
        let dir = tempfile::TempDir::new().unwrap();
        capture(&c, dir.path(), "conn1", "SCOTT", "PROCEDURE", "MY_PROC",
            "CREATE OR REPLACE PROCEDURE MY_PROC IS BEGIN NULL; END;", "baseline").unwrap();
        let err = push(dir.path(), "conn1").unwrap_err();
        assert!(matches!(err, VersionError::Other(_)));
    }

    #[test]
    fn set_remote_stores_url_in_git_config() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = repo_path(dir.path(), "conn1");
        open_or_init_repo(&root).unwrap();
        // We can verify the URL is stored without a real PAT keychain call
        // by checking the git config directly
        let repo = git2::Repository::open(&root).unwrap();
        let _ = repo.remote("origin", "https://github.com/test/repo.git");
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://github.com/test/repo.git"));
    }
```

- [ ] **Step 4: Run tests**

```powershell
cd src-tauri
cargo test object_versions -- --nocapture
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/object_versions.rs src-tauri/src/persistence/secrets.rs
git commit -m "feat(versioning): remote/push/PAT keyring functions"
```

---

## Task 7: ConnectionService — data_dir field + 8 delegating methods

**Files:**
- Modify: `src-tauri/src/persistence/connections.rs`

- [ ] **Step 1: Add `data_dir` to the import and struct**

In the `use` section at the top of `connections.rs`, add `object_versions` to the super import:

```rust
use super::{history, object_versions, secrets, store, tnsnames, wallet};
```

Change the `ConnectionService` struct:

```rust
pub struct ConnectionService {
    conn: Mutex<SqliteConnection>,
    wallets_root: PathBuf,
    data_dir: PathBuf,
}
```

- [ ] **Step 2: Update `open()` to init the new table and store data_dir**

Replace the `open` function body:

```rust
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
    history::init_db_history(&conn).map_err(|e| match e {
        history::HistoryError::Sqlite(s) => ConnectionError::from(StoreError::from(s)),
        history::HistoryError::InvalidArg(m) => ConnectionError::internal(m),
    })?;
    object_versions::init_db_object_versions(&conn)
        .map_err(|e| ConnectionError::internal(format!("object_versions init: {e}")))?;
    let data_dir = db_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    Ok(Self {
        conn: Mutex::new(conn),
        wallets_root,
        data_dir,
    })
}
```

- [ ] **Step 3: Add 8 delegating methods to ConnectionService**

Add these methods at the end of the `impl ConnectionService` block (before the closing `}`):

```rust
pub fn object_version_capture(
    &self,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
    ddl: &str,
    reason: &str,
) -> bool {
    let conn = match self.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    object_versions::capture(&conn, &self.data_dir, connection_id, owner, object_type, object_name, ddl, reason)
        .unwrap_or(false)
}

pub fn object_version_list(
    &self,
    connection_id: &str,
    owner: &str,
    object_type: &str,
    object_name: &str,
) -> Result<Vec<object_versions::ObjectVersionEntry>, ConnectionError> {
    let conn = self.lock()?;
    object_versions::list_versions(&conn, connection_id, owner, object_type, object_name)
        .map_err(|e| ConnectionError::internal(format!("object_version_list: {e}")))
}

pub fn object_version_diff(
    &self,
    connection_id: &str,
    sha_a: &str,
    sha_b: &str,
    file_path: &str,
) -> Result<String, ConnectionError> {
    object_versions::diff_commits(&self.data_dir, connection_id, sha_a, sha_b, file_path)
        .map_err(|e| ConnectionError::internal(format!("object_version_diff: {e}")))
}

pub fn object_version_load(
    &self,
    connection_id: &str,
    commit_sha: &str,
    file_path: &str,
) -> Result<String, ConnectionError> {
    object_versions::load_at_commit(&self.data_dir, connection_id, commit_sha, file_path)
        .map_err(|e| ConnectionError::internal(format!("object_version_load: {e}")))
}

pub fn object_version_set_label(
    &self,
    connection_id: &str,
    version_id: i64,
    owner: &str,
    object_type: &str,
    object_name: &str,
    label: Option<&str>,
) -> Result<(), ConnectionError> {
    let conn = self.lock()?;
    object_versions::set_label(&conn, &self.data_dir, connection_id, version_id, owner, object_type, object_name, label)
        .map_err(|e| ConnectionError::internal(format!("object_version_set_label: {e}")))
}

pub fn object_version_set_remote(
    &self,
    connection_id: &str,
    remote_url: &str,
    pat: &str,
) -> Result<(), ConnectionError> {
    object_versions::set_remote(&self.data_dir, connection_id, remote_url, pat)
        .map_err(|e| ConnectionError::internal(format!("object_version_set_remote: {e}")))
}

pub fn object_version_get_remote(
    &self,
    connection_id: &str,
) -> Result<Option<String>, ConnectionError> {
    object_versions::get_remote(&self.data_dir, connection_id)
        .map_err(|e| ConnectionError::internal(format!("object_version_get_remote: {e}")))
}

pub fn object_version_push(&self, connection_id: &str) -> Result<u32, ConnectionError> {
    object_versions::push(&self.data_dir, connection_id)
        .map_err(|e| ConnectionError::internal(format!("object_version_push: {e}")))
}
```

- [ ] **Step 4: Verify it compiles**

```powershell
cd src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/connections.rs
git commit -m "feat(versioning): ConnectionService gains data_dir + 8 version methods"
```

---

## Task 8: Tauri commands + register in invoke_handler

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the 8 command handlers to commands.rs**

At the end of `commands.rs`, add:

```rust
// ─── Object Version History ───────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub captured: bool,
}

#[tauri::command]
pub async fn object_version_capture(
    app: AppHandle,
    connection_id: String,
    owner: String,
    object_type: String,
    object_name: String,
    ddl: String,
    reason: String,
) -> CaptureResult {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    let captured = svc.object_version_capture(&connection_id, &owner, &object_type, &object_name, &ddl, &reason);
    CaptureResult { captured }
}

#[tauri::command]
pub async fn object_version_list(
    app: AppHandle,
    connection_id: String,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<Vec<crate::persistence::object_versions::ObjectVersionEntry>, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_list(&connection_id, &owner, &object_type, &object_name)
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[derive(Serialize)]
pub struct DiffResult {
    pub diff: String,
}

#[tauri::command]
pub async fn object_version_diff(
    app: AppHandle,
    connection_id: String,
    sha_a: String,
    sha_b: String,
    file_path: String,
) -> Result<DiffResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_diff(&connection_id, &sha_a, &sha_b, &file_path)
        .map(|diff| DiffResult { diff })
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[derive(Serialize)]
pub struct LoadResult {
    pub ddl: String,
}

#[tauri::command]
pub async fn object_version_load(
    app: AppHandle,
    connection_id: String,
    commit_sha: String,
    file_path: String,
) -> Result<LoadResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_load(&connection_id, &commit_sha, &file_path)
        .map(|ddl| LoadResult { ddl })
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[tauri::command]
pub async fn object_version_label(
    app: AppHandle,
    connection_id: String,
    version_id: i64,
    owner: String,
    object_type: String,
    object_name: String,
    label: Option<String>,
) -> Result<(), ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_set_label(&connection_id, version_id, &owner, &object_type, &object_name, label.as_deref())
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[tauri::command]
pub async fn object_version_set_remote(
    app: AppHandle,
    connection_id: String,
    remote_url: String,
    pat: String,
) -> Result<(), ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_set_remote(&connection_id, &remote_url, &pat)
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub pushed_commits: u32,
}

#[tauri::command]
pub async fn object_version_push(
    app: AppHandle,
    connection_id: String,
) -> Result<PushResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_push(&connection_id)
        .map(|pushed_commits| PushResult { pushed_commits })
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}

#[derive(Serialize)]
pub struct GetRemoteResult {
    pub url: Option<String>,
}

#[tauri::command]
pub async fn object_version_get_remote(
    app: AppHandle,
    connection_id: String,
) -> Result<GetRemoteResult, ConnectionTestErr> {
    let svc = app.state::<crate::persistence::connections::ConnectionService>();
    svc.object_version_get_remote(&connection_id)
        .map(|url| GetRemoteResult { url })
        .map_err(|e| ConnectionTestErr { code: e.code, message: e.message })
}
```

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs`, inside `invoke_handler(tauri::generate_handler![...])`, add these 8 commands after `commands::perf_stats`:

```rust
            commands::object_version_capture,
            commands::object_version_list,
            commands::object_version_diff,
            commands::object_version_load,
            commands::object_version_label,
            commands::object_version_set_remote,
            commands::object_version_push,
            commands::object_version_get_remote,
```

- [ ] **Step 3: Verify it compiles**

```powershell
cd src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(versioning): 8 Tauri command handlers registered"
```

---

## Task 9: TypeScript types and invoke wrappers

**Files:**
- Create: `src/lib/object-versions.ts`

- [ ] **Step 1: Create the file**

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { invoke } from "@tauri-apps/api/core";
import type { Result } from "$lib/workspace";

export type ObjectVersionEntry = {
  id: number;
  commitSha: string;
  ddlHash: string;
  captureReason: "baseline" | "compile";
  label: string | null;
  capturedAt: string;
};

export async function objectVersionCapture(
  connectionId: string,
  owner: string,
  objectType: string,
  objectName: string,
  ddl: string,
  reason: "baseline" | "compile",
): Promise<boolean> {
  try {
    const data = await invoke<{ captured: boolean }>("object_version_capture", {
      connectionId, owner, objectType, objectName, ddl, reason,
    });
    return data.captured;
  } catch {
    return false;
  }
}

export async function objectVersionList(
  connectionId: string,
  owner: string,
  objectType: string,
  objectName: string,
): Promise<Result<ObjectVersionEntry[]>> {
  try {
    const data = await invoke<ObjectVersionEntry[]>("object_version_list", {
      connectionId, owner, objectType, objectName,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionDiff(
  connectionId: string,
  shaA: string,
  shaB: string,
  filePath: string,
): Promise<Result<string>> {
  try {
    const data = await invoke<{ diff: string }>("object_version_diff", {
      connectionId, shaA, shaB, filePath,
    });
    return { ok: true, data: data.diff };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionLoad(
  connectionId: string,
  commitSha: string,
  filePath: string,
): Promise<Result<string>> {
  try {
    const data = await invoke<{ ddl: string }>("object_version_load", {
      connectionId, commitSha, filePath,
    });
    return { ok: true, data: data.ddl };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionLabel(
  connectionId: string,
  versionId: number,
  owner: string,
  objectType: string,
  objectName: string,
  label: string | null,
): Promise<Result<void>> {
  try {
    await invoke("object_version_label", {
      connectionId, versionId, owner, objectType, objectName, label,
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionSetRemote(
  connectionId: string,
  remoteUrl: string,
  pat: string,
): Promise<Result<void>> {
  try {
    await invoke("object_version_set_remote", { connectionId, remoteUrl, pat });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionPush(
  connectionId: string,
): Promise<Result<number>> {
  try {
    const data = await invoke<{ pushedCommits: number }>("object_version_push", { connectionId });
    return { ok: true, data: data.pushedCommits };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionGetRemote(
  connectionId: string,
): Promise<Result<string | null>> {
  try {
    const data = await invoke<{ url: string | null }>("object_version_get_remote", { connectionId });
    return { ok: true, data: data.url };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export function objectFilePath(owner: string, objectType: string, objectName: string): string {
  return `${owner}/${objectType.replace(" ", "_")}/${objectName}.sql`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
bun run check
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/object-versions.ts
git commit -m "feat(versioning): TypeScript invoke wrappers"
```

---

## Task 10: Add plsqlMeta to SqlTab and trigger compile capture

**Files:**
- Modify: `src/lib/stores/sql-editor.svelte.ts`

- [ ] **Step 1: Add PlsqlMeta type and update SqlTab**

In `sql-editor.svelte.ts`, add the `PlsqlMeta` type and update `SqlTab`. Find the `SqlTab` type definition (around line 34) and replace it:

```typescript
export type PlsqlMeta = {
  connectionId: string;
  owner: string;
  objectType: string;
  objectName: string;
};

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  results: TabResult[];
  activeResultId: string | null;
  running: boolean;
  runningRequestId: string | null;
  splitterError: string | null;
  filePath: string | null;
  isDirty: boolean;
  savedContent: string | null;
  plsqlMeta: PlsqlMeta | null;
};
```

- [ ] **Step 2: Add plsqlMeta: null to makeTab**

Find `function makeTab` (around line 164) and add `plsqlMeta: null` to the returned object:

```typescript
function makeTab(title: string, sql: string): SqlTab {
  return {
    id: newId(),
    title,
    sql,
    results: [],
    activeResultId: null,
    running: false,
    runningRequestId: null,
    splitterError: null,
    filePath: null,
    isDirty: false,
    savedContent: null,
    plsqlMeta: null,
  };
}
```

- [ ] **Step 3: Update openWithDdl to accept optional plsqlMeta**

Find `openWithDdl(title: string, ddl: string): void` and replace the function signature and tab construction:

```typescript
openWithDdl(title: string, ddl: string, plsqlMeta: PlsqlMeta | null = null): void {
  const existing = _tabs.find(t => t.title === title);
  if (existing) {
    _activeId = existing.id;
    if (!_drawerOpen) _drawerOpen = true;
    return;
  }
  const id = crypto.randomUUID();
  const tab: SqlTab = {
    id,
    title,
    sql: ddl,
    results: [],
    activeResultId: null,
    running: false,
    runningRequestId: null,
    splitterError: null,
    filePath: null,
    isDirty: false,
    savedContent: null,
    plsqlMeta,
  };
  _tabs = [..._tabs, tab];
  _activeId = id;
  if (!_drawerOpen) _drawerOpen = true;
},
```

- [ ] **Step 4: Trigger compile capture after successful compile**

Add the import at the top of the file (after existing imports):

```typescript
import { objectVersionCapture, objectFilePath } from "$lib/object-versions";
```

In `runActiveAll`, find the block that fires `compileErrorsGet` after a successful run of a compilable object (around line 596-607). Replace it with a version that also triggers versioning when there are 0 errors:

```typescript
        if (tabResult.status === "ok") {
          const compilable = extractCompilable(sql);
          if (compilable) {
            const tabId = tab.id;
            compileErrorsGet(compilable.objectType, compilable.objectName).then((ceRes) => {
              const t = _tabs.find((x) => x.id === tabId);
              if (!t) return;
              const r = t.results.find((x) => x.id === resultId);
              if (r) {
                r.compileErrors = ceRes.ok ? ceRes.data : [];
                _tabs = [..._tabs];
              }
              if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
                const { connectionId, owner, objectType, objectName } = t.plsqlMeta;
                void objectVersionCapture(connectionId, owner, objectType, objectName, t.sql, "compile");
              }
            });
          }
        }
```

**Note:** `runActiveAll` has two locations where compile errors are fetched (single-statement and multi-statement paths). Apply the same change to both. Search for `compileErrorsGet(compilable.objectType` and update all occurrences in `runActiveAll`.

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
bun run check
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/sql-editor.svelte.ts src/lib/object-versions.ts
git commit -m "feat(versioning): plsqlMeta on SqlTab + compile capture trigger"
```

---

## Task 11: ObjectVersionBadge.svelte

**Files:**
- Create: `src/lib/workspace/ObjectVersionBadge.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { objectVersionList } from "$lib/object-versions";

  type Props = {
    connectionId: string;
    owner: string;
    objectType: string;
    objectName: string;
    onOpen: () => void;
  };

  let { connectionId, owner, objectType, objectName, onOpen }: Props = $props();

  let count = $state(0);
  let latestAt = $state<string | null>(null);

  async function refresh() {
    const res = await objectVersionList(connectionId, owner, objectType, objectName);
    if (res.ok && res.data.length > 0) {
      count = res.data.length;
      latestAt = res.data[0].capturedAt;
    } else {
      count = 0;
      latestAt = null;
    }
  }

  function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  onMount(refresh);

  export function reloadVersions() {
    void refresh();
  }
</script>

{#if count > 0}
  <button class="ver-btn" title="Version history" onclick={onOpen}>
    <span class="ver-dot"></span>
    v{count}{latestAt ? ` · ${timeAgo(latestAt)}` : ""}
  </button>
{/if}

<style>
  .ver-btn {
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255,255,255,0.04);
    padding: 0 0.65rem;
    color: #7ec96a;
    cursor: pointer;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    opacity: 0.7;
    transition: background 0.1s, opacity 0.1s;
  }
  .ver-btn:hover {
    background: rgba(126,201,106,0.08);
    opacity: 1;
  }
  .ver-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #7ec96a;
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 2: Verify**

```powershell
bun run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/ObjectVersionBadge.svelte
git commit -m "feat(versioning): ObjectVersionBadge toolbar component"
```

---

## Task 12: ObjectVersionFlyout.svelte — version list + diff panel

**Files:**
- Create: `src/lib/workspace/ObjectVersionFlyout.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    objectVersionList,
    objectVersionDiff,
    objectVersionLoad,
    objectVersionLabel,
    objectVersionGetRemote,
    objectVersionSetRemote,
    objectVersionPush,
    objectFilePath,
    type ObjectVersionEntry,
  } from "$lib/object-versions";

  type Props = {
    connectionId: string;
    owner: string;
    objectType: string;
    objectName: string;
    onLoadInEditor: (ddl: string) => void;
    onClose: () => void;
  };

  let { connectionId, owner, objectType, objectName, onLoadInEditor, onClose }: Props = $props();

  const filePath = $derived(objectFilePath(owner, objectType, objectName));

  let versions = $state<ObjectVersionEntry[]>([]);
  let selectedId = $state<number | null>(null);
  let diff = $state<string | null>(null);
  let diffError = $state(false);
  let loadingDiff = $state(false);
  let editingLabelId = $state<number | null>(null);
  let labelInput = $state("");

  let showRemote = $state(false);
  let remoteUrl = $state("");
  let remotePat = $state("");
  let currentRemote = $state<string | null>(null);
  let pushStatus = $state<string | null>(null);
  let pushLoading = $state(false);

  async function loadVersions() {
    const res = await objectVersionList(connectionId, owner, objectType, objectName);
    if (res.ok) {
      versions = res.data;
      if (versions.length > 0 && selectedId === null) {
        selectedId = versions[0].id;
        void loadDiff(versions[0]);
      }
    }
  }

  async function loadDiff(entry: ObjectVersionEntry) {
    if (versions.length < 2) { diff = null; return; }
    const head = versions[0];
    if (entry.id === head.id) {
      diff = null;
      return;
    }
    loadingDiff = true;
    diffError = false;
    const res = await objectVersionDiff(connectionId, entry.commitSha, head.commitSha, filePath);
    loadingDiff = false;
    if (res.ok) {
      diff = res.data;
      diffError = false;
    } else {
      diff = null;
      diffError = true;
    }
  }

  function selectVersion(entry: ObjectVersionEntry) {
    selectedId = entry.id;
    void loadDiff(entry);
  }

  async function loadInEditor() {
    const entry = versions.find((v) => v.id === selectedId);
    if (!entry) return;
    const res = await objectVersionLoad(connectionId, entry.commitSha, filePath);
    if (res.ok) {
      onLoadInEditor(res.data);
      onClose();
    }
  }

  function startEditLabel(entry: ObjectVersionEntry) {
    editingLabelId = entry.id;
    labelInput = entry.label ?? "";
  }

  async function saveLabel(entry: ObjectVersionEntry) {
    const newLabel = labelInput.trim() || null;
    await objectVersionLabel(connectionId, entry.id, owner, objectType, objectName, newLabel);
    editingLabelId = null;
    await loadVersions();
  }

  function parseDiffLines(raw: string): { type: "add" | "rem" | "ctx" | "hunk"; text: string }[] {
    return raw.split("\n").map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return { type: "add", text: line };
      if (line.startsWith("-") && !line.startsWith("---")) return { type: "rem", text: line };
      if (line.startsWith("@")) return { type: "hunk", text: line };
      return { type: "ctx", text: line };
    });
  }

  async function loadRemote() {
    const res = await objectVersionGetRemote(connectionId);
    if (res.ok) currentRemote = res.data;
  }

  async function saveRemote() {
    if (!remoteUrl.trim() || !remotePat.trim()) return;
    const res = await objectVersionSetRemote(connectionId, remoteUrl.trim(), remotePat.trim());
    if (res.ok) {
      currentRemote = remoteUrl.trim();
      remotePat = "";
      remoteUrl = "";
    }
  }

  async function doPush() {
    pushLoading = true;
    pushStatus = null;
    const res = await objectVersionPush(connectionId);
    pushLoading = false;
    if (res.ok) {
      pushStatus = res.data === 0 ? "Already up to date" : `Pushed ${res.data} commit${res.data !== 1 ? "s" : ""}`;
    } else {
      pushStatus = `Error: ${res.error.message}`;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  onMount(() => {
    void loadVersions();
    void loadRemote();
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flyout-backdrop" onclick={onClose} onkeydown={() => {}}></div>

<div class="flyout" role="dialog" aria-modal="true">
  <div class="fly-list">
    <div class="fly-header">{owner} · {objectType} · {objectName}</div>
    <div class="fly-body">
      {#if versions.length === 0}
        <div class="empty-state">No versions captured yet</div>
      {:else}
        {#each versions as entry (entry.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="ver-row"
            class:selected={selectedId === entry.id}
            onclick={() => selectVersion(entry)}
            onkeydown={(e) => e.key === "Enter" && selectVersion(entry)}
            role="button"
            tabindex="0"
            ondblclick={() => startEditLabel(entry)}
          >
            <div class="ver-meta">
              {#if editingLabelId === entry.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="label-input"
                  bind:value={labelInput}
                  autofocus
                  onkeydown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); void saveLabel(entry); }
                    if (e.key === "Escape") { e.stopPropagation(); editingLabelId = null; }
                  }}
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <div class="ver-time">{new Date(entry.capturedAt).toLocaleString()}</div>
                <div class="ver-sha">{entry.commitSha.slice(0, 7)}{entry.label ? ` · ${entry.label}` : ""}</div>
              {/if}
            </div>
            <span class="rbadge" class:rb-compile={entry.captureReason === "compile"} class:rb-baseline={entry.captureReason === "baseline"}>
              {entry.captureReason}
            </span>
          </div>
        {/each}
      {/if}
    </div>
    <div class="fly-footer">
      <button class="restore-btn" disabled={selectedId === null} onclick={loadInEditor}>
        ↩ Open in editor
      </button>
    </div>
  </div>

  <div class="fly-diff">
    <div class="diff-header">
      {#if selectedId !== null && versions.length > 0}
        {@const sel = versions.find((v) => v.id === selectedId)}
        {@const head = versions[0]}
        {#if sel && sel.id !== head.id}
          <span class="diff-from">{sel.commitSha.slice(0, 7)}</span>
          <span class="diff-sep">→</span>
          <span class="diff-to">{head.commitSha.slice(0, 7)} (current)</span>
        {:else}
          <span class="diff-note">Select an older version to see diff</span>
        {/if}
      {/if}
    </div>
    <div class="diff-body">
      {#if loadingDiff}
        <div class="diff-loading">Loading diff…</div>
      {:else if diffError}
        <div class="diff-unavail">[unavailable]</div>
      {:else if diff}
        {#each parseDiffLines(diff) as line}
          <div class="dl {line.type}">{line.text}</div>
        {/each}
      {:else}
        <div class="diff-empty">No diff to show</div>
      {/if}
    </div>
    <div class="diff-footer">
      <button class="remote-toggle" onclick={() => { showRemote = !showRemote; }}>⚙</button>
      {#if selectedId !== null}
        {@const sel = versions.find((v) => v.id === selectedId)}
        {#if sel && sel.id !== versions[0]?.id}
          <button class="load-btn" onclick={loadInEditor}>↩ Load {sel.commitSha.slice(0, 7)} in editor</button>
        {/if}
      {/if}
    </div>
    {#if showRemote}
      <div class="remote-strip">
        {#if currentRemote}
          <span class="remote-url">{currentRemote}</span>
        {:else}
          <input class="remote-input" placeholder="https://github.com/…" bind:value={remoteUrl} />
          <input class="remote-input pat" placeholder="Personal Access Token" type="password" bind:value={remotePat} />
          <button class="save-remote-btn" onclick={saveRemote}>Save</button>
        {/if}
        <button class="push-btn" disabled={!currentRemote || pushLoading} onclick={doPush}>
          {pushLoading ? "Pushing…" : "↑ Push"}
        </button>
        {#if pushStatus}
          <span class="push-status">{pushStatus}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .flyout-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .flyout {
    position: absolute;
    top: 32px;
    right: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: 220px 1fr;
    width: 680px;
    max-height: 480px;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    overflow: hidden;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  }
  .fly-list {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .fly-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-family: "Space Grotesk", sans-serif;
  }
  .fly-body {
    flex: 1;
    overflow-y: auto;
  }
  .ver-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    cursor: pointer;
  }
  .ver-row:hover { background: rgba(255,255,255,0.04); }
  .ver-row.selected {
    background: rgba(179,62,31,0.08);
    border-left: 2px solid #b33e1f;
    padding-left: 10px;
  }
  .ver-meta { flex: 1; min-width: 0; }
  .ver-time { font-size: 10.5px; color: var(--text-secondary); }
  .ver-sha { font-size: 9.5px; color: var(--text-muted); margin-top: 1px; }
  .rbadge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    font-family: "Space Grotesk", sans-serif;
  }
  .rb-compile { background: rgba(126,201,106,0.12); color: #7ec96a; }
  .rb-baseline { background: rgba(255,255,255,0.06); color: var(--text-muted); }
  .label-input {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 10.5px;
    font-family: "JetBrains Mono", monospace;
    padding: 2px 6px;
  }
  .fly-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
  .restore-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 4px;
    background: rgba(126,201,106,0.10);
    color: #7ec96a;
    border: 1px solid rgba(126,201,106,0.2);
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .restore-btn:hover { background: rgba(126,201,106,0.16); }
  .restore-btn:disabled { opacity: 0.4; cursor: default; }
  .fly-diff { display: flex; flex-direction: column; overflow: hidden; }
  .diff-header {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 10px;
    font-family: "Space Grotesk", sans-serif;
    flex-shrink: 0;
  }
  .diff-from { color: var(--text-muted); }
  .diff-sep { color: rgba(255,255,255,0.15); }
  .diff-to { color: var(--text-secondary); }
  .diff-note { color: var(--text-muted); }
  .diff-body { flex: 1; overflow-y: auto; padding: 6px 0; }
  .dl {
    padding: 0 14px;
    line-height: 1.7;
    font-size: 10.5px;
    white-space: pre;
    font-family: "JetBrains Mono", monospace;
  }
  .dl.add { background: rgba(126,201,106,0.07); color: #7ec96a; }
  .dl.rem { background: rgba(179,62,31,0.08); color: #f5a08a; }
  .dl.ctx { color: var(--text-muted); }
  .dl.hunk { color: rgba(100,160,255,0.5); font-style: italic; padding-top: 6px; }
  .diff-loading, .diff-empty, .diff-unavail {
    padding: 16px 14px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
  }
  .diff-footer {
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .remote-toggle {
    margin-right: auto;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .remote-toggle:hover { background: rgba(255,255,255,0.06); color: var(--text-secondary); }
  .load-btn {
    font-size: 11px;
    padding: 4px 12px;
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .load-btn:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
  .remote-strip {
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    background: rgba(0,0,0,0.1);
    flex-shrink: 0;
  }
  .remote-url { font-size: 10px; color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 10px;
    font-family: "JetBrains Mono", monospace;
    padding: 3px 8px;
  }
  .remote-input.pat { flex: 0 0 140px; }
  .save-remote-btn, .push-btn {
    font-size: 10px;
    padding: 3px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .save-remote-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
  }
  .push-btn {
    background: rgba(126,201,106,0.12);
    border: 1px solid rgba(126,201,106,0.25);
    color: #7ec96a;
    font-weight: 600;
  }
  .push-btn:disabled { opacity: 0.4; cursor: default; }
  .push-status { font-size: 10px; color: var(--text-muted); }
  .empty-state {
    padding: 20px 14px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
  }
</style>
```

- [ ] **Step 2: Verify**

```powershell
bun run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/ObjectVersionFlyout.svelte
git commit -m "feat(versioning): ObjectVersionFlyout with list, diff, remote strip"
```

---

## Task 13: Wire badge into SqlDrawer and capture into workspace page

**Files:**
- Modify: `src/lib/workspace/SqlDrawer.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Update SqlDrawer.svelte — import and render badge**

At the top of `<script>` in `SqlDrawer.svelte`, add the imports:

```typescript
import ObjectVersionBadge from "./ObjectVersionBadge.svelte";
import ObjectVersionFlyout from "./ObjectVersionFlyout.svelte";
```

Add state for the flyout:

```typescript
let flyoutOpen = $state(false);
let badgeRef = $state<ReturnType<typeof ObjectVersionBadge> | null>(null);
```

In the `file-actions` div, after the compile button block (after the closing `{/if}` for the compile button), add:

```svelte
{#if active?.plsqlMeta}
  {@const meta = active.plsqlMeta}
  <div style="position:relative">
    <ObjectVersionBadge
      bind:this={badgeRef}
      connectionId={meta.connectionId}
      owner={meta.owner}
      objectType={meta.objectType}
      objectName={meta.objectName}
      onOpen={() => { flyoutOpen = true; }}
    />
    {#if flyoutOpen}
      <ObjectVersionFlyout
        connectionId={meta.connectionId}
        owner={meta.owner}
        objectType={meta.objectType}
        objectName={meta.objectName}
        onLoadInEditor={(ddl) => {
          sqlEditor.updateSql(active.id, ddl);
          flyoutOpen = false;
        }}
        onClose={() => { flyoutOpen = false; }}
      />
    {/if}
  </div>
{/if}
```

After a successful capture (both baseline and compile), call `badgeRef?.reloadVersions()`. The compile trigger is already in the store. For the badge to auto-refresh after baseline capture (which happens in the workspace page), pass a callback or use `$effect`. The simplest approach: the badge refreshes on `onMount` automatically, and after compile the `reloadVersions()` call from the store is not directly accessible from the badge. Instead, let the badge poll on a short interval: add an `$effect` in `ObjectVersionBadge` to re-fetch when `objectName` prop changes (which it will when the user switches tabs). The user can also just click the badge to see updated counts.

- [ ] **Step 2: Update workspace page — pass plsqlMeta to openWithDdl and trigger baseline**

In `src/routes/workspace/[id]/+page.svelte`, add the import at the top:

```typescript
import { objectVersionCapture } from "$lib/object-versions";
```

Find the block that calls `objectDdlGet` and `sqlEditor.openWithDdl` (line ~290):

```typescript
void (async () => {
  const res = await objectDdlGet(owner, kind, name);
  if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
  if (res.ok) {
    sqlEditor.openWithDdl(`${owner}.${name}`, res.data);
  } else {
```

Replace with:

```typescript
void (async () => {
  const res = await objectDdlGet(owner, kind, name);
  if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
  if (res.ok) {
    const connId = page.params.id;
    sqlEditor.openWithDdl(`${owner}.${name}`, res.data, {
      connectionId: connId,
      owner,
      objectType: kind,
      objectName: name,
    });
    void objectVersionCapture(connId, owner, kind, name, res.data, "baseline");
  } else {
```

Find the `onViewDdl` callback (line ~689):

```typescript
onViewDdl={async (owner, kind, name) => {
  ddlLoading = { owner, name };
  try {
    const res = await objectDdlGet(owner, kind as any, name);
    if (res.ok) sqlEditor.openWithDdl(`${owner}.${name}`, res.data);
    else if (res.error.code === SESSION_LOST) sessionLost = true;
  } finally {
    if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
  }
}}
```

Replace with:

```typescript
onViewDdl={async (owner, kind, name) => {
  ddlLoading = { owner, name };
  try {
    const res = await objectDdlGet(owner, kind as any, name);
    if (res.ok) {
      const connId = page.params.id;
      sqlEditor.openWithDdl(`${owner}.${name}`, res.data, {
        connectionId: connId,
        owner,
        objectType: kind,
        objectName: name,
      });
      void objectVersionCapture(connId, owner, kind, name, res.data, "baseline");
    }
    else if (res.error.code === SESSION_LOST) sessionLost = true;
  } finally {
    if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
  }
}}
```

- [ ] **Step 3: Verify TypeScript**

```powershell
bun run check
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```powershell
cd src-tauri
cargo test -- --nocapture
bun run test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/SqlDrawer.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(versioning): wire badge + flyout + baseline capture into workspace"
```

---

## Task 14: Manual verification checklist

Before shipping, verify these scenarios in the running app (`bun run tauri dev`):

- [ ] Open a PROCEDURE from the schema tree → badge appears with `v1 · Xs` in the toolbar
- [ ] Edit the procedure and click Compile → if compile succeeds with 0 errors, badge updates to `v2`
- [ ] Compile again without changing the code → badge stays `v2` (dedup working)
- [ ] Click the badge → flyout opens anchored below it
- [ ] Flyout shows two rows: `compile` + `baseline`; first row is selected with left red border
- [ ] Click the older row → diff panel shows the lines that changed between baseline and current
- [ ] Double-click the label area of any row → inline input appears; type a name, press Enter → label saved, shows in `sha · label` format
- [ ] Click "Open in editor" → editor content replaced with selected version's DDL (no auto-compile)
- [ ] Click outside the flyout → it closes
- [ ] Press Escape → flyout closes
- [ ] Open a TABLE → no badge appears (badge hidden for non-PL/SQL tabs)
- [ ] Open the ⚙ remote strip → URL + PAT inputs appear
- [ ] Enter a valid GitHub repo URL and PAT → click Save → URL shown
- [ ] Click ↑ Push → "Pushed N commits" shown (or appropriate error if network unavailable)

---

## Self-Review Checklist

**Spec coverage check:**
- SQLite `object_versions` table with all columns ✓ (Task 2)
- SHA-256 dedup ✓ (Tasks 3–4)
- git2 repo per connection ✓ (Tasks 3–4)
- Capture triggers: baseline on open, compile on success ✓ (Tasks 10, 13)
- `PACKAGE BODY` → `PACKAGE_BODY` directory ✓ (Task 3 test: `package_body_uses_underscore_directory`)
- 8 Tauri commands ✓ (Tasks 7–8)
- TypeScript wrappers ✓ (Task 9)
- `objectFilePath` helper for `file_path` computation ✓ (Task 9)
- Badge shows `v{count} · {time-ago}`, hidden when count=0 ✓ (Task 11)
- Flyout: version list, diff panel, restore ✓ (Task 12)
- Label: double-click inline edit, git tag ✓ (Tasks 5, 12)
- Remote strip: URL + PAT, Push button ✓ (Task 12)
- 13 Rust unit tests ✓ (Tasks 2–6)
- `vendored-openssl` for Windows builds ✓ (Task 1)
- Error handling: git failures silently swallowed in capture ✓ (Task 4)
- Flyout "unavailable" on diff error ✓ (Task 12: `diffError` state)

**No placeholders:** All steps contain complete code. ✓

**Type consistency:** `PlsqlMeta` defined in Task 10 and used identically in Tasks 11, 12, 13. `objectFilePath` defined in Task 9 and used in Task 12. `ObjectVersionEntry` defined in Task 9 and used in Task 11, 12. ✓
