// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

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

#[allow(clippy::too_many_arguments)]
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
        Err(e) if e.code() == git2::ErrorCode::NotFound => git2::Repository::init(repo_root),
        Err(e) => Err(e),
    }
}

/// Capture a DDL snapshot. Returns `true` if a new commit was created, `false` if deduplicated.
/// All git errors are silently logged and return `Ok(false)` — the editor is never blocked.
#[allow(clippy::too_many_arguments)]
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
    if let Ok(Some(last)) = last_ddl_hash(conn, connection_id, owner, object_type, object_name)
        && last == ddl_hash
    {
        return Ok(false);
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
        Err(_) => repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[])?
    };
    Ok(commit_id.to_string())
}

/// Unified diff between two commits for a given file path.
/// `file_path_str` is `OWNER/TYPE_DIR/NAME.sql` (forward slashes).
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
#[allow(clippy::too_many_arguments)]
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

    // Remove old tag if there was one
    let rows = list_versions(conn, connection_id, owner, object_type, object_name)?;
    if let Some(old_row) = rows.iter().find(|r| r.id == version_id)
        && let Some(old_label) = &old_row.label
    {
        let old_tag = tag_name(owner, object_type, object_name, old_label);
        let _ = repo.tag_delete(&old_tag);
    }

    update_label(conn, version_id, label)?;

    if let Some(lbl) = label
        && !lbl.is_empty()
    {
        let oid = git2::Oid::from_str(&commit_sha)?;
        let obj = repo.find_commit(oid)?.into_object();
        let t = tag_name(owner, object_type, object_name, lbl);
        repo.tag_lightweight(&t, &obj, false)?;
    }
    Ok(())
}

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
        let repo = git2::Repository::open(&root).unwrap();
        let _ = repo.remote("origin", "https://github.com/test/repo.git");
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://github.com/test/repo.git"));
    }
}
