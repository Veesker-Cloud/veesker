use serde_json::{json, Value};
use std::path::Path;

pub fn basic_params(
    host: &str,
    port: u16,
    service_name: &str,
    username: &str,
    password: &str,
) -> Value {
    json!({
        "authType": "basic",
        "host": host,
        "port": port,
        "serviceName": service_name,
        "username": username,
        "password": password,
    })
}

pub fn wallet_params(
    wallet_dir: &Path,
    wallet_password: &str,
    connect_alias: &str,
    username: &str,
    password: &str,
) -> Value {
    json!({
        "authType": "wallet",
        "walletDir": wallet_dir.to_string_lossy(),
        "walletPassword": wallet_password,
        "connectAlias": connect_alias,
        "username": username,
        "password": password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn basic_params_emits_camel_case_with_all_fields() {
        let v = basic_params("db.example.com", 1521, "FREEPDB1", "PDBADMIN", "secret");
        assert_eq!(v["authType"], "basic");
        assert_eq!(v["host"], "db.example.com");
        assert_eq!(v["port"], 1521);
        assert_eq!(v["serviceName"], "FREEPDB1");
        assert_eq!(v["username"], "PDBADMIN");
        assert_eq!(v["password"], "secret");
    }

    #[test]
    fn wallet_params_emits_camel_case_with_path() {
        let dir = PathBuf::from("/tmp/wallets/abc");
        let v = wallet_params(&dir, "wpw", "fakedb_high", "ADMIN", "userpw");
        assert_eq!(v["authType"], "wallet");
        assert_eq!(v["walletDir"], "/tmp/wallets/abc");
        assert_eq!(v["walletPassword"], "wpw");
        assert_eq!(v["connectAlias"], "fakedb_high");
        assert_eq!(v["username"], "ADMIN");
        assert_eq!(v["password"], "userpw");
    }
}
