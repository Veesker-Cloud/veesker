# Veesker Auto-Update

Veesker uses Tauri's built-in updater (`tauri-plugin-updater`) to deliver new versions automatically.

## Architecture

```
App boot (2s delay) → fetch GitHub Releases latest.json → compare versions → notify if newer
                                                                                  ↓
                                User clicks "Atualizar agora" → download .exe → verify Ed25519 sig
                                                                                  ↓
                                                                            install + relaunch
```

- **Endpoint:** `https://github.com/geeviana/veesker/releases/latest/download/latest.json`
- **Signature:** Ed25519 (separate from Microsoft code-signing cert)
- **Install mode:** `passive` on Windows (silent, no UAC prompts beyond the first)

## Files involved

| File | Role |
|---|---|
| `src-tauri/Cargo.toml` | `tauri-plugin-updater`, `tauri-plugin-process` deps |
| `src-tauri/src/lib.rs` | plugin registration |
| `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts`, `plugins.updater.endpoints`, `plugins.updater.pubkey` |
| `src-tauri/capabilities/default.json` | `updater:default`, `process:default` permissions |
| `src/lib/workspace/UpdateNotification.svelte` | toast UI |
| `src/routes/+layout.svelte` | mounts `<UpdateNotification />` globally |

## Signing keys

**Generated 2026-04-25.** Store these securely:

- **Private key path:** `~/.veesker/update-key` — **NEVER commit, NEVER share**
- **Public key path:** `~/.veesker/update-key.pub` (also embedded in `tauri.conf.json`)

If you lose the private key, **all existing installs become orphaned** — they reject any update signed with a different key. The only recovery is to ship a new install bundle to all users out-of-band.

### Backup

Copy both files to:
1. Password manager (paste the file contents into a secure note)
2. Encrypted USB drive
3. Another machine/cloud encrypted backup

```powershell
# Read both files for safe storage
Get-Content "$env:USERPROFILE\.veesker\update-key"
Get-Content "$env:USERPROFILE\.veesker\update-key.pub"
```

## Build a signed release

```powershell
# 1. Bump version in 3 places
#    - src-tauri/tauri.conf.json
#    - src-tauri/Cargo.toml
#    - package.json

# 2. Set the signing env var (required for updater artifacts)
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.veesker\update-key"
# (no password set during generation, so no password var needed)

# 3. Recompile sidecar binary
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..

# 4. Build with updater artifacts
bun run tauri build
```

The build produces:
- `src-tauri/target/release/bundle/nsis/Veesker_<v>_x64-setup.exe` — main installer
- `src-tauri/target/release/bundle/nsis/Veesker_<v>_x64-setup.exe.sig` — Ed25519 signature
- `src-tauri/target/release/bundle/msi/Veesker_<v>_x64_en-US.msi` — alt installer
- `src-tauri/target/release/bundle/msi/Veesker_<v>_x64_en-US.msi.sig` — its sig

## Publish a release

For each release, upload to GitHub Releases:

1. The `.exe` (NSIS installer) **and** its `.sig`
2. A **`latest.json`** file at the root of the release assets

### latest.json template

```json
{
  "version": "0.2.0",
  "notes": "## Novidades v0.2.0\n\n- VRAS: corrigidos blockers de schema mapping\n- Snippets SQL configuráveis\n- Bug fix em DML confirm modal",
  "pub_date": "2026-05-15T18:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<paste content of Veesker_0.2.0_x64-setup.exe.sig>",
      "url": "https://github.com/geeviana/veesker/releases/download/v0.2.0/Veesker_0.2.0_x64-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "<paste content of Veesker_0.2.0_aarch64.app.tar.gz.sig>",
      "url": "https://github.com/geeviana/veesker/releases/download/v0.2.0/Veesker_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<paste content of Veesker_0.2.0_x64.app.tar.gz.sig>",
      "url": "https://github.com/geeviana/veesker/releases/download/v0.2.0/Veesker_0.2.0_x64.app.tar.gz"
    }
  }
}
```

Read the signature contents:
```powershell
Get-Content "src-tauri\target\release\bundle\nsis\Veesker_0.2.0_x64-setup.exe.sig" -Raw
```

The endpoint `https://github.com/.../releases/latest/download/latest.json` always resolves to whichever release is marked **Latest** on GitHub. So flip the "Latest" toggle on the new release after upload — older versions in the wild will see the new one immediately.

## Rollback

If a bad version goes out:

1. On GitHub, mark a previous good release as "Latest"
2. The endpoint will start resolving to that older `latest.json`
3. Apps in the wild that auto-checked are already on the bad version — they need a manual reinstall (or wait for a new release that has version > bad version + a "fix" tag in notes)

There is no native "rollback to older version" in Tauri's updater — version comparison is strictly newer-wins.

## Update lifecycle from user POV

1. App opens normally, 2-second delay
2. Quiet network call to GitHub (no UI yet)
3. **If update found:** toast bottom-right with "Veesker X.Y.Z disponível"
4. User can dismiss (`Depois`) or `Atualizar agora`
5. Atualizar agora → progress bar (download in MB) → "Instalando…" → "Reinicie" toast
6. User clicks `Reiniciar agora` → `relaunch()` → app comes back on new version

If the user dismisses, the toast won't reappear in this session. Next launch checks again.

## Disabling updater for dev mode

The updater calls don't fire in `bun run tauri dev` because:
- `check()` succeeds but no newer version exists for the dev binary
- Plus the plugin gates checks behind a real installer

You can hard-disable by commenting out `<UpdateNotification />` in `+layout.svelte`.

## Auditing what's deployed

Each user's install can be audited via:
```powershell
# In Veesker app folder (e.g., %LocalAppData%\Programs\Veesker\)
& '.\Veesker.exe' --version
```

## Security model

- **Update authenticity:** every `.exe` ships with `.sig` — Ed25519 proves it came from someone with the private key (you).
- **Update integrity:** Tauri verifies hash before installing.
- **Channel hijack:** the endpoint is HTTPS → MITM would need to break TLS. The sig check fails on tampered binaries even if MITM succeeds.
- **Lost key recovery:** as noted above, requires re-shipping out-of-band.

Combined with Microsoft code-signing (when SignPath approves), users get:
- Authenticity at install (Microsoft cert)
- Authenticity per update (Ed25519 sig in updater)
- Both run during install, both must validate.
