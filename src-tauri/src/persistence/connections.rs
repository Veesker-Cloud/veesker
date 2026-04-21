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
    fn not_found() -> Self {
        Self {
            code: 404,
            message: "connection not found".into(),
        }
    }
    fn conflict(msg: impl Into<String>) -> Self {
        Self {
            code: 409,
            message: msg.into(),
        }
    }
    fn invalid(msg: impl Into<String>) -> Self {
        Self {
            code: 400,
            message: msg.into(),
        }
    }
    fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: 500,
            message: msg.into(),
        }
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
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
            Ok(password) => Ok(ConnectionFull {
                meta,
                password,
                password_missing: false,
            }),
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
        if let Err(e) = secrets::delete_password(id) {
            eprintln!("[connections] keychain delete failed for {id}: {e}");
        }
        Ok(())
    }
}
