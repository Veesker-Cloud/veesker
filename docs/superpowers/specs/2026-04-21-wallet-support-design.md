# Wallet Support (Oracle Autonomous Database) — Design Spec

**Phase:** 2 of 9
**Date:** 2026-04-21
**Status:** Approved
**Depends on:** Phase 1 (Connection Persistence MVP2)

## Goal

Allow Veesker to connect to **Oracle Autonomous Database** (ATP/ADW) using **mTLS wallets**, alongside the existing basic auth (host/port/service). One unified `connections` table, one `ConnectionForm` with an auth-type toggle.

## Non-goals

- Wallet rotation / expiration warnings
- TLS-only connections without a wallet (Oracle 19c+ server-cert mode)
- IAM token-based auth
- Re-encrypting wallet on disk (we trust filesystem permissions inside `appDataDir`)

## Smoke test caveat

The user does not have an Autonomous DB wallet to test against. Phase 2 ships the full feature but verification is **partial**:

- ✅ Wallet zip is accepted, parsed, extracted, persisted, deleted
- ✅ `tnsnames.ora` aliases populate the dropdown correctly
- ✅ Sidecar receives the `wallet` auth-type payload and assembles the correct `oracledb.getConnection` call
- ❌ Real mTLS handshake against Oracle Autonomous DB (no wallet available)

A user clicking **Test** with a wallet will exercise the full pipeline; the sidecar will report whatever Oracle returns.

## Architecture

### Data model — SQLite migration

The MVP2 schema has `host`/`port`/`service_name` as `NOT NULL`. For wallet connections those columns must be nullable. SQLite cannot `DROP NOT NULL` via `ALTER TABLE`, so the migration **recreates the table**:

```sql
CREATE TABLE connections_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'basic'
    CHECK (auth_type IN ('basic', 'wallet')),
  host TEXT,
  port INTEGER,
  service_name TEXT,
  connect_alias TEXT,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO connections_new (id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at)
  SELECT id, name, 'basic', host, port, service_name, NULL, username, created_at, updated_at FROM connections;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
CREATE UNIQUE INDEX idx_connections_name_lower ON connections (LOWER(name));
```

Wrapped in a transaction so it's atomic. The CHECK constraint enforces the enum at the DB layer.

**Migration trigger:** `init_db` in `src-tauri/src/persistence/store.rs` runs `PRAGMA table_info(connections)` after creating/opening; if `auth_type` column is absent, runs the migration. New databases get the new schema directly (the original `SCHEMA` string is updated to include the new columns + check, so fresh installs skip the migration entirely).

### Wallet storage on disk

| Item | Location | Notes |
|------|----------|-------|
| Extracted wallet files | `{appDataDir}/wallets/{connection_id}/` | Created on save, removed on delete |
| User password | macOS Keychain — service `veesker`, account `connection:{id}` | Same as MVP2 |
| Wallet password (PEM/PKCS12) | macOS Keychain — service `veesker`, account `connection:{id}:wallet` | New — separate from user password |

The wallet zip itself is **not retained** — only its extracted contents. Required files (validated on save):

- `tnsnames.ora` (required — provides aliases)
- `cwallet.sso` (required — auto-login PKCS12 wallet)
- `sqlnet.ora`, `ewallet.p12`, `keystore.jks`, `truststore.jks`, `ojdbc.properties` (extracted if present, optional)

If `tnsnames.ora` or `cwallet.sso` is missing, save fails with `400 INVALID_WALLET`.

### Tauri commands

**New:**

```rust
#[tauri::command]
async fn wallet_inspect(zip_path: String) -> Result<WalletInfo, ConnectionError>
```

Reads the zip without persisting anything. Returns:

```rust
struct WalletInfo {
    aliases: Vec<String>,  // parsed from tnsnames.ora
}
```

Used by the form to populate the alias dropdown **before** the user submits.

**Modified:**

`connection_save` — `ConnectionInput` becomes a discriminated union:

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
enum ConnectionInput {
    Basic {
        id: Option<String>,
        name: String,
        host: String,
        port: u16,
        service_name: String,
        username: String,
        password: String,
    },
    Wallet {
        id: Option<String>,
        name: String,
        wallet_zip_path: Option<String>,  // None = keep existing wallet on edit
        wallet_password: String,
        connect_alias: String,
        username: String,
        password: String,
    },
}
```

When `Wallet { wallet_zip_path: Some(path), .. }`:
1. Validate zip contains required files
2. Generate/use connection id
3. Extract zip into `{appDataDir}/wallets/{id}/` (overwriting if it already exists — this is the replace-wallet path)
4. Persist row with `auth_type = 'wallet'`, `connect_alias`
5. Store both passwords in keychain

When `Wallet { wallet_zip_path: None, .. }` (edit without re-uploading):
- Wallet directory must already exist; otherwise `400 WALLET_MISSING`
- Update the row + keychain entries; leave the directory untouched

`connection_delete` — additionally:
- `fs::remove_dir_all({appDataDir}/wallets/{id})` (best-effort, ignores `NotFound`)
- Delete `connection:{id}:wallet` keychain entry (best-effort)

`connection_get` — return `ConnectionFull` extended with `auth_type`, `connect_alias`, and a `walletPasswordMissing: bool` flag for the wallet password (parallel to existing `passwordMissing`).

### Sidecar (`sidecar/src/oracle.ts`)

`ConnectionTestParams` becomes a discriminated union mirroring the Rust enum:

```ts
type ConnectionTestParams =
  | {
      authType: 'basic';
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
    }
  | {
      authType: 'wallet';
      walletDir: string;       // absolute path to extracted wallet
      walletPassword: string;
      connectAlias: string;    // e.g. 'mydb_high'
      username: string;
      password: string;
    };
```

Wallet-mode call:

```ts
await oracledb.getConnection({
  user: params.username,
  password: params.password,
  connectString: params.connectAlias,
  configDir: params.walletDir,
  walletLocation: params.walletDir,
  walletPassword: params.walletPassword,
});
```

`node-oracledb` 6.x Thin mode supports this natively — no Instant Client install required.

### `tnsnames.ora` parser

A small Rust module `src-tauri/src/persistence/tnsnames.rs`:

```rust
pub fn parse_aliases(content: &str) -> Vec<String>
```

Strategy: scan top-level lines matching `^([A-Z0-9_]+)\s*=\s*\(`. Ignore continuation lines (leading whitespace) and comments (`#`). Aliases are case-insensitive in Oracle but we preserve the casing from the file.

Returned in file order so the dropdown matches what the user sees if they open the file. Tests cover: typical Autonomous DB wallet (5 aliases), comments, blank lines, indented continuation lines.

### Frontend

**`src/lib/connections.ts`** — extend types:

```ts
type AuthType = 'basic' | 'wallet';

type ConnectionMeta = {
  id: string;
  name: string;
  authType: AuthType;
  // basic-only:
  host?: string;
  port?: number;
  serviceName?: string;
  // wallet-only:
  connectAlias?: string;
  // shared:
  username: string;
  createdAt: string;
  updatedAt: string;
};

type ConnectionFull = {
  meta: ConnectionMeta;
  password: string;
  passwordMissing: boolean;
  walletPassword?: string;          // wallet-only
  walletPasswordMissing?: boolean;  // wallet-only
};

// ConnectionInput is a discriminated union by authType, mirroring Rust
```

New API wrapper `walletInspect(zipPath: string): Promise<Result<{ aliases: string[] }>>`.

**`src/lib/ConnectionForm.svelte`** — single component, radio at top:

```
Auth: ( ) Basic   ( ) Wallet (mTLS)
```

- **Basic mode:** today's fields (Name / Host / Port / Service / Username / Password)
- **Wallet mode:** Name / **Drop wallet .zip here** zone / Connect alias dropdown (disabled until inspect succeeds) / Wallet password / Username / Password
- The drop zone uses Tauri's `tauri-plugin-dialog` to open a file picker as the fallback to drag-drop. Selected zip path → `walletInspect()` → populates dropdown.
- Edit mode for wallet connections: drop zone shows "Wallet on file. **Replace wallet**" — clicking re-opens the file picker. If user doesn't replace, the alias dropdown stays populated from `connection_get`'s saved `connectAlias`.
- **Auth type cannot be changed during edit** (basic ↔ wallet). The radio is disabled. To switch, user deletes and recreates. Rationale: changing auth type changes which fields are required; clearing partially populated state is messy. Recreating is one extra click.

**Landing list (`src/routes/+page.svelte`):**
- Wallet connections show a small badge `🔒 wallet` next to the name.
- Meta line for wallet: `{username}@{connectAlias}` (no host/port/service)
- Meta line for basic: unchanged `{username}@{host}:{port}/{serviceName}`

### Error model additions

| Code | Where | Meaning |
|------|-------|---------|
| `400 INVALID_WALLET` | `connection_save`, `wallet_inspect` | Zip missing `tnsnames.ora` or `cwallet.sso`, or zip is corrupt |
| `400 WALLET_MISSING` | `connection_save` (edit path) | Editing wallet connection but `wallets/{id}/` doesn't exist |
| `400 INVALID_ALIAS` | `connection_save` | `connect_alias` not present in saved `tnsnames.ora` |
| `400 INVALID_INPUT` | `connection_save` | Existing — extended to cover empty `connect_alias`, empty `wallet_password` |

## File structure

**New files:**
- `src-tauri/src/persistence/tnsnames.rs` — parser + tests
- `src-tauri/src/persistence/wallet.rs` — zip validation, extract, file ops
- *(no new SvelteKit routes — uses existing `/connections/new` and `/connections/[id]/edit`)*

**Modified files:**
- `src-tauri/Cargo.toml` — add `zip = "2"` dep
- `src-tauri/tauri.conf.json` + `Cargo.toml` — add `tauri-plugin-dialog` (for the wallet file picker)
- `package.json` — add `@tauri-apps/plugin-dialog`
- `src-tauri/src/persistence/store.rs` — schema migration, extend `ConnectionRow`
- `src-tauri/src/persistence/connections.rs` — discriminated `ConnectionInput`, wallet branch in save/delete
- `src-tauri/src/persistence/secrets.rs` — `wallet_account(id)` helper
- `src-tauri/src/commands.rs` — add `wallet_inspect` command
- `src-tauri/src/lib.rs` — register `wallet_inspect`
- `sidecar/src/oracle.ts` — discriminated union, wallet-mode `getConnection` call
- `sidecar/src/handlers.ts` — pass-through (handler already opaque to params shape, but verify)
- `src/lib/connections.ts` — extend types, add `walletInspect`
- `src/lib/ConnectionForm.svelte` — auth-type toggle, drop zone, alias dropdown
- `src/routes/+page.svelte` — wallet badge + meta-line variant

## Testing

**Rust unit tests:**
- `tnsnames.rs` — parser: typical wallet, comments, blank lines, indented continuations, malformed (no panic, returns empty)
- `wallet.rs` — extract a fixture zip; reject zip without required files; reject corrupt zip
- `store.rs` — migration is idempotent (running twice doesn't fail); existing MVP2 row reads back as `auth_type='basic'`
- `connections.rs` — save wallet with no zip on edit fails with `WALLET_MISSING`; save with bad alias fails with `INVALID_ALIAS`; delete removes wallet dir

**Sidecar:**
- No new unit tests — logic is a config-construction passthrough. Integration covered by manual smoke (basic still works end-to-end against local Oracle 23ai).

**Manual smoke (basic path — must still pass):**
- Existing basic connection still tests against `oracle23ai` Docker container, returns positive in <500ms

**Manual smoke (wallet path — partial):**
- Drop a fabricated wallet zip (tnsnames + dummy cwallet.sso) — form parses 3 aliases, dropdown populates
- Save → verify `wallets/{id}/` contains the files, DB row has `auth_type='wallet'`, keychain has both entries
- Test → sidecar receives `authType: 'wallet'` (verify via stderr log of JSON-RPC), Oracle reports a connection error (expected — fake wallet)
- Edit → re-open form, dropdown shows saved alias, **Replace wallet** with a different fixture, save, verify directory replaced
- Delete → verify `wallets/{id}/` gone, both keychain entries gone, DB row gone

## Success criteria

1. Existing basic connections from MVP2 continue to work without re-entering anything (migration preserves data).
2. User can drop an Autonomous DB wallet zip, pick an alias, and save a connection.
3. Saved wallet connections survive app restart (DB + filesystem + keychain).
4. Editing a wallet connection without replacing the wallet works.
5. Replacing the wallet on an existing connection works.
6. Deleting a wallet connection cleans up the directory and both keychain entries.
7. The basic connection landing list still shows correctly alongside wallet entries with their badge.
8. `cargo test` and `bun run check` both green; `bun run build` produces a working static bundle.
