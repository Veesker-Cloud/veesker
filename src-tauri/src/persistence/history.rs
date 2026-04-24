use chrono::Utc;
use rusqlite::{params, Connection as SqliteConnection};
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub enum HistoryError {
    Sqlite(rusqlite::Error),
    InvalidArg(String),
}

impl From<rusqlite::Error> for HistoryError {
    fn from(e: rusqlite::Error) -> Self {
        HistoryError::Sqlite(e)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub connection_id: String,
    pub sql: String,
    pub success: bool,
    pub row_count: Option<i64>,
    pub elapsed_ms: i64,
    pub error_code: Option<i32>,
    pub error_message: Option<String>,
    pub executed_at: String,
    pub username: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySaveInput {
    pub connection_id: String,
    pub sql: String,
    pub success: bool,
    pub row_count: Option<i64>,
    pub elapsed_ms: i64,
    pub error_code: Option<i32>,
    pub error_message: Option<String>,
    pub username: Option<String>,
    pub host: Option<String>,
}

fn has_column_history(conn: &SqliteConnection, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(query_history)")?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(names.iter().any(|n| n == column))
}

pub fn init_db_history(conn: &SqliteConnection) -> Result<(), HistoryError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS query_history (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            sql           TEXT NOT NULL,
            success       INTEGER NOT NULL,
            row_count     INTEGER,
            elapsed_ms    INTEGER NOT NULL,
            error_code    INTEGER,
            error_message TEXT,
            executed_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS query_history_connection_executed_idx
            ON query_history (connection_id, executed_at DESC);
        CREATE INDEX IF NOT EXISTS query_history_connection_id_idx
            ON query_history (connection_id, id DESC);
        "#,
    )?;
    if !has_column_history(conn, "username")? {
        conn.execute_batch(
            "ALTER TABLE query_history ADD COLUMN username TEXT;
             ALTER TABLE query_history ADD COLUMN host TEXT;",
        )?;
    }
    Ok(())
}

pub fn insert(conn: &SqliteConnection, input: &HistorySaveInput) -> Result<i64, HistoryError> {
    if input.connection_id.is_empty() {
        return Err(HistoryError::InvalidArg("connection_id required".into()));
    }
    if input.sql.is_empty() {
        return Err(HistoryError::InvalidArg("sql required".into()));
    }
    let executed_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO query_history
            (connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            input.connection_id,
            input.sql,
            input.success as i64,
            input.row_count,
            input.elapsed_ms,
            input.error_code,
            input.error_message,
            executed_at,
            input.username,
            input.host,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list(
    conn: &SqliteConnection,
    connection_id: &str,
    limit: i64,
    offset: i64,
    search: Option<&str>,
) -> Result<Vec<HistoryEntry>, HistoryError> {
    let limit = limit.clamp(1, 500);
    let offset = offset.max(0);
    if let Some(s) = search {
        // LIKE escape: backslash-escape % _ \
        let escaped = s
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{}%", escaped);
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host
             FROM query_history
             WHERE connection_id = ? AND sql LIKE ? ESCAPE '\\'
             ORDER BY id DESC
             LIMIT ? OFFSET ?",
        )?;
        let rows = stmt
            .query_map(params![connection_id, pattern, limit, offset], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host
             FROM query_history
             WHERE connection_id = ?
             ORDER BY id DESC
             LIMIT ? OFFSET ?",
        )?;
        let rows = stmt
            .query_map(params![connection_id, limit, offset], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        sql: row.get(2)?,
        success: row.get::<_, i64>(3)? != 0,
        row_count: row.get(4)?,
        elapsed_ms: row.get(5)?,
        error_code: row.get(6)?,
        error_message: row.get(7)?,
        executed_at: row.get(8)?,
        username: row.get(9)?,
        host: row.get(10)?,
    })
}

pub fn clear(conn: &SqliteConnection, connection_id: &str) -> Result<usize, HistoryError> {
    let n = conn.execute(
        "DELETE FROM query_history WHERE connection_id = ?",
        params![connection_id],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db_history(&c).unwrap();
        c
    }

    fn ok_input(conn_id: &str, sql: &str) -> HistorySaveInput {
        HistorySaveInput {
            connection_id: conn_id.into(),
            sql: sql.into(),
            success: true,
            row_count: Some(42),
            elapsed_ms: 100,
            error_code: None,
            error_message: None,
            username: Some("testuser".into()),
            host: Some("localhost".into()),
        }
    }

    fn err_input(conn_id: &str, sql: &str) -> HistorySaveInput {
        HistorySaveInput {
            connection_id: conn_id.into(),
            sql: sql.into(),
            success: false,
            row_count: None,
            elapsed_ms: 50,
            error_code: Some(-32013),
            error_message: Some("ORA-00942: table or view does not exist".into()),
            username: None,
            host: None,
        }
    }

    // 1. init_db_history is idempotent (call twice, no error)
    #[test]
    fn init_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_db_history(&c).unwrap();
        init_db_history(&c).unwrap();
    }

    // 2. insert returns a positive id and persists the row
    #[test]
    fn insert_returns_positive_id_and_persists() {
        let c = fresh();
        let id = insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual")).unwrap();
        assert!(id > 0);
        let rows = list(&c, "conn-1", 10, 0, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].sql, "SELECT 1 FROM dual");
    }

    // 3. insert rejects empty connection_id
    #[test]
    fn insert_rejects_empty_connection_id() {
        let c = fresh();
        let err = insert(&c, &ok_input("", "SELECT 1 FROM dual")).unwrap_err();
        assert!(matches!(err, HistoryError::InvalidArg(_)));
    }

    // 4. insert rejects empty sql
    #[test]
    fn insert_rejects_empty_sql() {
        let c = fresh();
        let err = insert(&c, &ok_input("conn-1", "")).unwrap_err();
        assert!(matches!(err, HistoryError::InvalidArg(_)));
    }

    // 5. list returns most-recent-first by id
    #[test]
    fn list_returns_most_recent_first() {
        let c = fresh();
        insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual")).unwrap();
        insert(&c, &ok_input("conn-1", "SELECT 2 FROM dual")).unwrap();
        insert(&c, &ok_input("conn-1", "SELECT 3 FROM dual")).unwrap();
        let rows = list(&c, "conn-1", 10, 0, None).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].sql, "SELECT 3 FROM dual");
        assert_eq!(rows[1].sql, "SELECT 2 FROM dual");
        assert_eq!(rows[2].sql, "SELECT 1 FROM dual");
    }

    // 6. list with limit/offset paginates
    #[test]
    fn list_paginates() {
        let c = fresh();
        for i in 0..5 {
            insert(&c, &ok_input("conn-1", &format!("SELECT {} FROM dual", i))).unwrap();
        }
        let page1 = list(&c, "conn-1", 2, 0, None).unwrap();
        let page2 = list(&c, "conn-1", 2, 2, None).unwrap();
        let page3 = list(&c, "conn-1", 2, 4, None).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 2);
        assert_eq!(page3.len(), 1);
        // page1 has most recent first; page2 next; no overlap
        assert_ne!(page1[0].id, page2[0].id);
        assert!(page1[0].id > page2[0].id);
    }

    // 7. list filtered by search returns only matching rows;
    //    LIKE special chars (%, _) are escaped:
    //    insert "SELECT 1 FROM dual_x" + "SELECT 1 FROM dual", search "dual_x" → 1 row, not both
    #[test]
    fn list_search_escapes_like_special_chars() {
        let c = fresh();
        insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual_x")).unwrap();
        insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual")).unwrap();
        let rows = list(&c, "conn-1", 10, 0, Some("dual_x")).unwrap();
        assert_eq!(rows.len(), 1, "expected exactly 1 row for 'dual_x' search, got {:?}", rows.iter().map(|r| &r.sql).collect::<Vec<_>>());
        assert_eq!(rows[0].sql, "SELECT 1 FROM dual_x");
    }

    // 8. list returns empty when connection_id has no history
    #[test]
    fn list_empty_for_unknown_connection() {
        let c = fresh();
        insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual")).unwrap();
        let rows = list(&c, "conn-unknown", 10, 0, None).unwrap();
        assert_eq!(rows.len(), 0);
    }

    // 9. clear removes all rows for the given connection but leaves other connections untouched
    #[test]
    fn clear_removes_only_target_connection() {
        let c = fresh();
        insert(&c, &ok_input("conn-1", "SELECT 1 FROM dual")).unwrap();
        insert(&c, &ok_input("conn-1", "SELECT 2 FROM dual")).unwrap();
        insert(&c, &ok_input("conn-2", "SELECT 3 FROM dual")).unwrap();
        let deleted = clear(&c, "conn-1").unwrap();
        assert_eq!(deleted, 2);
        let remaining_1 = list(&c, "conn-1", 10, 0, None).unwrap();
        let remaining_2 = list(&c, "conn-2", 10, 0, None).unwrap();
        assert_eq!(remaining_1.len(), 0);
        assert_eq!(remaining_2.len(), 1);
    }

    // 10. error history row roundtrips correctly (success=false, row_count=NULL, error_code/error_message set)
    #[test]
    fn error_row_roundtrips() {
        let c = fresh();
        let id = insert(&c, &err_input("conn-1", "SELECT * FROM nonexistent")).unwrap();
        let rows = list(&c, "conn-1", 10, 0, None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.id, id);
        assert!(!row.success);
        assert!(row.row_count.is_none());
        assert_eq!(row.error_code, Some(-32013));
        assert_eq!(
            row.error_message.as_deref(),
            Some("ORA-00942: table or view does not exist")
        );
    }
}
