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
    let mut stmt = conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")?;
    stmt.exists(params![table])
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
        assert_eq!(row.host.as_deref(), Some("localhost"));
        assert_eq!(row.port, Some(1521));
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
        row.port = Some(1599);
        row.updated_at = "2026-05-01T00:00:00Z".into();
        update(&c, &row).unwrap();
        let after = get(&c, "a").unwrap().unwrap();
        assert_eq!(after.port, Some(1599));
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

    #[test]
    fn migration_adds_columns_to_legacy_schema() {
        let c = Connection::open_in_memory().unwrap();
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
}
