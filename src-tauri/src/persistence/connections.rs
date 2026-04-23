use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::Connection as SqliteConnection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{history, secrets, store, tnsnames, wallet};
use store::{AuthType, ConnectionRow, StoreError};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "authType")]
pub enum ConnectionMeta {
    #[serde(rename = "basic", rename_all = "camelCase")]
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
    #[serde(rename = "wallet", rename_all = "camelCase")]
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
                host: r
                    .host
                    .ok_or_else(|| ConnectionError::internal("basic row missing host"))?,
                port: r
                    .port
                    .ok_or_else(|| ConnectionError::internal("basic row missing port"))?,
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
    pub password_set: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wallet_password_set: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "authType")]
pub enum ConnectionInput {
    #[serde(rename = "basic", rename_all = "camelCase")]
    Basic {
        id: Option<String>,
        name: String,
        host: String,
        port: u16,
        service_name: String,
        username: String,
        password: String,
    },
    #[serde(rename = "wallet", rename_all = "camelCase")]
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
    pub(crate) fn internal(msg: impl Into<String>) -> Self {
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
        history::init_db_history(&conn).map_err(|e| match e {
            history::HistoryError::Sqlite(s) => ConnectionError::from(StoreError::from(s)),
            history::HistoryError::InvalidArg(m) => ConnectionError::internal(m),
        })?;
        Ok(Self {
            conn: Mutex::new(conn),
            wallets_root,
        })
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
        let row_id = row.id.clone();
        let auth = row.auth_type.clone();
        let meta = ConnectionMeta::try_from(row)?;

        let password_set = match secrets::get_password(&row_id) {
            Ok(_) => true,
            Err(e) if secrets::is_missing(&e) => false,
            Err(e) => return Err(e.into()),
        };

        let wallet_password_set = match auth {
            AuthType::Basic => None,
            AuthType::Wallet => Some(match secrets::get_wallet_password(&row_id) {
                Ok(_) => true,
                Err(e) if secrets::is_missing(&e) => false,
                Err(e) => return Err(e.into()),
            }),
        };

        Ok(ConnectionFull {
            meta,
            password_set,
            wallet_password_set,
        })
    }

    /// Build the sidecar JSON-RPC params for opening an Oracle session
    /// for the saved connection identified by `id`. Reads passwords directly
    /// from the OS keychain — they are never stored in `ConnectionFull`.
    pub fn sidecar_params(&self, id: &str) -> Result<serde_json::Value, ConnectionError> {
        use super::connection_config::{basic_params, wallet_params};
        let row = {
            let conn = self.lock()?;
            store::get(&conn, id)?.ok_or_else(ConnectionError::not_found)?
        };
        let row_id = row.id.clone();
        let auth = row.auth_type.clone();
        let meta = ConnectionMeta::try_from(row)?;

        let password = match secrets::get_password(&row_id) {
            Ok(p) => p,
            Err(e) if secrets::is_missing(&e) => return Err(ConnectionError::invalid(
                "user password missing from keychain — edit the connection and re-enter the password",
            )),
            Err(e) => return Err(e.into()),
        };

        match meta {
            ConnectionMeta::Basic { host, port, service_name, username, .. } => {
                Ok(basic_params(&host, port, &service_name, &username, &password))
            }
            ConnectionMeta::Wallet { connect_alias, username, id: meta_id, .. } => {
                let wallet_password = match secrets::get_wallet_password(&row_id) {
                    Ok(p) => p,
                    Err(e) if secrets::is_missing(&e) => return Err(ConnectionError::invalid(
                        "wallet password missing from keychain — edit the connection and re-enter the wallet password",
                    )),
                    Err(e) => return Err(e.into()),
                };
                let _ = auth;
                let dir = self.wallet_dir(&meta_id);
                Ok(wallet_params(&dir, &wallet_password, &connect_alias, &username, &password))
            }
        }
    }

    pub fn save(&self, input: ConnectionInput) -> Result<ConnectionMeta, ConnectionError> {
        let now = Utc::now().to_rfc3339();
        match input {
            ConnectionInput::Basic {
                id,
                name,
                host,
                port,
                service_name,
                username,
                password,
            } => {
                if name.trim().is_empty() {
                    return Err(ConnectionError::invalid("name is required"));
                }
                if host.trim().is_empty() {
                    return Err(ConnectionError::invalid("host is required"));
                }
                if username.trim().is_empty() {
                    return Err(ConnectionError::invalid("username is required"));
                }
                if password.is_empty() && id.is_none() {
                    return Err(ConnectionError::invalid("password is required"));
                }
                let row = self.assemble_basic_row(
                    id.as_deref(),
                    name,
                    host,
                    port,
                    service_name,
                    username,
                    &now,
                )?;
                self.persist_row(&row, id.is_some())?;
                if !password.is_empty() {
                    secrets::set_password(&row.id, &password)?;
                }
                ConnectionMeta::try_from(row)
            }
            ConnectionInput::Wallet {
                id,
                name,
                wallet_zip_path,
                wallet_password,
                connect_alias,
                username,
                password,
            } => {
                if name.trim().is_empty() {
                    return Err(ConnectionError::invalid("name is required"));
                }
                if username.trim().is_empty() {
                    return Err(ConnectionError::invalid("username is required"));
                }
                if password.is_empty() && id.is_none() {
                    return Err(ConnectionError::invalid("password is required"));
                }
                if wallet_password.is_empty() && id.is_none() {
                    return Err(ConnectionError::invalid("wallet password is required"));
                }
                if connect_alias.trim().is_empty() {
                    return Err(ConnectionError::invalid("connect alias is required"));
                }
                let row = self.assemble_wallet_row(
                    id.as_deref(),
                    name,
                    connect_alias.clone(),
                    username,
                    &now,
                )?;

                let wallet_dir = self.wallet_dir(&row.id);
                if let Some(zip_path) = wallet_zip_path.as_deref() {
                    let zip = Path::new(zip_path);
                    let body = wallet::read_tnsnames_from_zip(zip)?;
                    let aliases = tnsnames::parse_aliases(&body);
                    if !aliases
                        .iter()
                        .any(|a| a.eq_ignore_ascii_case(&connect_alias))
                    {
                        return Err(ConnectionError::invalid(format!(
                            "alias '{connect_alias}' not found in wallet's tnsnames.ora"
                        )));
                    }
                    wallet::extract_to(zip, &wallet_dir)?;
                } else {
                    if id.is_none() {
                        return Err(ConnectionError::invalid(
                            "wallet zip is required for new wallet connections",
                        ));
                    }
                    if !wallet_dir.exists() {
                        return Err(ConnectionError::invalid(
                            "wallet directory missing — please re-upload the wallet zip",
                        ));
                    }
                    let body = std::fs::read_to_string(wallet_dir.join("tnsnames.ora"))
                        .map_err(|e| {
                            ConnectionError::invalid(format!("read tnsnames.ora: {e}"))
                        })?;
                    let aliases = tnsnames::parse_aliases(&body);
                    if !aliases
                        .iter()
                        .any(|a| a.eq_ignore_ascii_case(&connect_alias))
                    {
                        return Err(ConnectionError::invalid(format!(
                            "alias '{connect_alias}' not found in saved tnsnames.ora"
                        )));
                    }
                }

                self.persist_row(&row, id.is_some())?;
                if !password.is_empty() {
                    secrets::set_password(&row.id, &password)?;
                }
                if !wallet_password.is_empty() {
                    secrets::set_wallet_password(&row.id, &wallet_password)?;
                }
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

    pub fn history_save(&self, input: history::HistorySaveInput) -> Result<i64, ConnectionError> {
        let conn = self.lock()?;
        history::insert(&conn, &input).map_err(|e| match e {
            history::HistoryError::Sqlite(s) => ConnectionError::from(StoreError::from(s)),
            history::HistoryError::InvalidArg(m) => ConnectionError::invalid(m),
        })
    }

    pub fn history_list(
        &self,
        connection_id: &str,
        limit: i64,
        offset: i64,
        search: Option<&str>,
    ) -> Result<Vec<history::HistoryEntry>, ConnectionError> {
        let conn = self.lock()?;
        history::list(&conn, connection_id, limit, offset, search).map_err(|e| match e {
            history::HistoryError::Sqlite(s) => ConnectionError::from(StoreError::from(s)),
            history::HistoryError::InvalidArg(m) => ConnectionError::invalid(m),
        })
    }

    pub fn history_clear(&self, connection_id: &str) -> Result<usize, ConnectionError> {
        let conn = self.lock()?;
        history::clear(&conn, connection_id).map_err(|e| match e {
            history::HistoryError::Sqlite(s) => ConnectionError::from(StoreError::from(s)),
            history::HistoryError::InvalidArg(m) => ConnectionError::invalid(m),
        })
    }

    pub fn inspect_wallet(&self, zip_path: &str) -> Result<WalletInfo, ConnectionError> {
        let body = wallet::read_tnsnames_from_zip(Path::new(zip_path))?;
        Ok(WalletInfo {
            aliases: tnsnames::parse_aliases(&body),
        })
    }
}
