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
            row.id,
            row.name,
            row.host,
            row.port,
            row.service_name,
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
            row.name,
            row.host,
            row.port,
            row.service_name,
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
