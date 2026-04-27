// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

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

fn api_key_account(service: &str) -> String {
    format!("apikey:{service}")
}

pub fn set_api_key(service: &str, key: &str) -> keyring::Result<()> {
    entry(&api_key_account(service))?.set_password(key)
}

pub fn get_api_key(service: &str) -> keyring::Result<Option<String>> {
    match entry(&api_key_account(service))?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Public API kept for the upcoming Settings → Clear API key UI flow.
#[allow(dead_code)]
pub fn delete_api_key(service: &str) -> keyring::Result<()> {
    delete_account(&api_key_account(service))
}

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

#[allow(dead_code)]
pub fn delete_git_pat(connection_id: &str) -> keyring::Result<()> {
    delete_account(&git_account(connection_id))
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
