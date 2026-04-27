// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

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
        Err(_) => git2::Repository::init(repo_root),
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
}
