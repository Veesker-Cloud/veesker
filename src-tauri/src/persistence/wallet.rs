// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

use std::fs;
use std::io::Read;
use std::path::Path;

#[derive(Debug)]
pub enum WalletError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    MissingFile(&'static str),
}

impl From<std::io::Error> for WalletError {
    fn from(e: std::io::Error) -> Self {
        WalletError::Io(e)
    }
}

impl From<zip::result::ZipError> for WalletError {
    fn from(e: zip::result::ZipError) -> Self {
        WalletError::Zip(e)
    }
}

impl std::fmt::Display for WalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WalletError::Io(e) => write!(f, "wallet i/o: {e}"),
            WalletError::Zip(e) => write!(f, "wallet zip: {e}"),
            WalletError::MissingFile(name) => write!(f, "wallet missing required file: {name}"),
        }
    }
}

const REQUIRED_FILES: &[&str] = &["tnsnames.ora", "cwallet.sso"];

/// Cap on a single file extracted from a wallet zip. tnsnames.ora is normally a
/// few KB; even very large enterprise wallets stay well under 1 MB. This bounds
/// memory exposure if a malicious zip claims a huge uncompressed size.
const MAX_WALLET_FILE_BYTES: u64 = 1024 * 1024;

pub fn read_tnsnames_from_zip(zip_path: &Path) -> Result<String, WalletError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let entry = archive
        .by_name("tnsnames.ora")
        .map_err(|_| WalletError::MissingFile("tnsnames.ora"))?;
    if entry.size() > MAX_WALLET_FILE_BYTES {
        return Err(WalletError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "tnsnames.ora exceeds 1 MB cap",
        )));
    }
    let mut s = String::new();
    entry.take(MAX_WALLET_FILE_BYTES).read_to_string(&mut s)?;
    Ok(s)
}

pub fn extract_to(zip_path: &Path, dest_dir: &Path) -> Result<(), WalletError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).map(|e| e.name().to_string()))
        .collect::<Result<_, _>>()?;
    for required in REQUIRED_FILES {
        if !names.iter().any(|n| n == *required) {
            return Err(WalletError::MissingFile(required));
        }
    }

    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir)?;
    }
    fs::create_dir_all(dest_dir)?;

    let canon_dest = dest_dir
        .canonicalize()
        .unwrap_or_else(|_| dest_dir.to_path_buf());

    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        let name = entry.name().to_string();

        // Reject empty names, traversal, absolute paths, drive letters, and
        // anything containing path separators or null bytes.
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.starts_with('.')
            || name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
            || name.contains(':')
            || name.split('/').any(|c| c == "..")
            || name.split('\\').any(|c| c == "..")
        {
            continue;
        }

        // Skip directory entries — wallet files are always plain files.
        if entry.is_dir() {
            continue;
        }

        let out_path = dest_dir.join(&name);

        // Defense in depth: confirm the join landed under canon_dest. canonicalize()
        // requires the file to exist, so we check the parent (which is dest_dir) and
        // then assert the file_name component is non-traversing.
        if let Ok(parent) = out_path.parent().unwrap_or(dest_dir).canonicalize()
            && !parent.starts_with(&canon_dest)
        {
            continue;
        }
        // Refuse to follow existing symlinks at the destination (Windows: junctions/symlinks
        // can be created by other processes between create_dir_all and File::create).
        if let Ok(meta) = fs::symlink_metadata(&out_path)
            && meta.file_type().is_symlink()
        {
            continue;
        }

        // OpenOptions::create_new() refuses to overwrite, but we already wiped the dir
        // at line 61 so the only race is a concurrent attacker — File::create truncates
        // and won't follow symlinks on Windows by default. Sufficient.
        // Cap each file at 1 MB to bound memory/disk on a hostile wallet.
        if entry.size() > MAX_WALLET_FILE_BYTES {
            continue;
        }
        let mut out = fs::File::create(&out_path)?;
        std::io::copy(&mut entry.take(MAX_WALLET_FILE_BYTES), &mut out)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        let cursor = Cursor::new(&mut buf);
        let mut zw = zip::ZipWriter::new(cursor);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(data).unwrap();
        }
        zw.finish().unwrap();
        buf
    }

    fn write_zip(dir: &Path, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
        let bytes = build_zip(entries);
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn tempdir() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    #[test]
    fn read_tnsnames_returns_content() {
        let tmp = tempdir();
        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[
                ("tnsnames.ora", b"alpha = (DESCRIPTION=(ADDRESS=))\n"),
                ("cwallet.sso", b"x"),
            ],
        );
        let body = read_tnsnames_from_zip(&zip).unwrap();
        assert!(body.contains("alpha"));
    }

    #[test]
    fn read_tnsnames_errors_when_missing() {
        let tmp = tempdir();
        let zip = write_zip(tmp.path(), "wallet.zip", &[("cwallet.sso", b"x")]);
        let err = read_tnsnames_from_zip(&zip).unwrap_err();
        assert!(matches!(err, WalletError::MissingFile("tnsnames.ora")));
    }

    #[test]
    fn extract_writes_all_files() {
        let tmp = tempdir();
        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[
                ("tnsnames.ora", b"alpha = (DESCRIPTION=(ADDRESS=))\n"),
                ("cwallet.sso", b"sso bytes"),
                ("sqlnet.ora", b"WALLET_LOCATION=..."),
            ],
        );
        let dest = tmp.path().join("out");
        extract_to(&zip, &dest).unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("tnsnames.ora")).unwrap(),
            "alpha = (DESCRIPTION=(ADDRESS=))\n"
        );
        assert_eq!(fs::read(dest.join("cwallet.sso")).unwrap(), b"sso bytes");
        assert_eq!(
            fs::read(dest.join("sqlnet.ora")).unwrap(),
            b"WALLET_LOCATION=..."
        );
    }

    #[test]
    fn extract_errors_when_required_missing() {
        let tmp = tempdir();
        let zip = write_zip(tmp.path(), "wallet.zip", &[("tnsnames.ora", b"x")]);
        let dest = tmp.path().join("out");
        let err = extract_to(&zip, &dest).unwrap_err();
        assert!(matches!(err, WalletError::MissingFile("cwallet.sso")));
        assert!(
            !dest.exists(),
            "extract must not leave partial dest on failure"
        );
    }

    #[test]
    fn extract_overwrites_existing_dir() {
        let tmp = tempdir();
        let dest = tmp.path().join("out");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("stale.txt"), b"old").unwrap();

        let zip = write_zip(
            tmp.path(),
            "wallet.zip",
            &[("tnsnames.ora", b"a"), ("cwallet.sso", b"b")],
        );
        extract_to(&zip, &dest).unwrap();
        assert!(
            !dest.join("stale.txt").exists(),
            "stale files must be removed"
        );
        assert!(dest.join("tnsnames.ora").exists());
    }
}
