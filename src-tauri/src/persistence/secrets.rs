use keyring::Entry;

const SERVICE: &str = "veesker";

fn account(id: &str) -> String {
    format!("connection:{id}")
}

fn entry(id: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, &account(id))
}

pub fn set_password(id: &str, password: &str) -> keyring::Result<()> {
    entry(id)?.set_password(password)
}

pub fn get_password(id: &str) -> keyring::Result<String> {
    entry(id)?.get_password()
}

pub fn delete_password(id: &str) -> keyring::Result<()> {
    match entry(id)?.delete_credential() {
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
}
