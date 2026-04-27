# DB Object Versioning — Design Spec

**Date:** 2026-04-27  
**Status:** Approved  
**Feature name:** Object Version History

---

## Problem

When working on PL/SQL objects in a development database, changes are often pushed to homolog/prod without being backed up locally. When the dev database gets refreshed, those versions are permanently lost. The user needs a way to recover any previously compiled version of an object without changing their workflow.

---

## Scope

**In scope:** PL/SQL objects only — PROCEDURE, FUNCTION, PACKAGE, PACKAGE BODY, TRIGGER, TYPE. Push to remote via HTTPS + PAT.

**Out of scope:** TABLE, VIEW, INDEX, SEQUENCE, standalone SQL scripts, SSH auth, branching, multi-user (future phases).

---

## Approach

**git2 in Rust + SQLite as index** (Approach A).

- One git repository per connection at `<app_data>/object-history/<conn-id>/`.
- The Rust layer uses the `git2` crate to manage commits. No git CLI dependency.
- The existing `veesker.db` SQLite gains a new `object_versions` table as a fast query index.
- The sidecar requires **no changes** — `object.ddl` already returns DDL as a string for all PL/SQL types.

---

## Capture Triggers

Two automatic capture points, both with SHA-256 deduplication:

| Trigger | Reason stored | When |
|---|---|---|
| Object opened in editor | `baseline` | Captures the state before the user touches anything |
| Successful compile | `compile` | Captures each working version |

**Deduplication rule:** before creating a commit, compute SHA-256 of the DDL text and compare against the most recent hash for that object in SQLite. If identical, abort silently — no commit, no SQLite row, no noise.

---

## Data Model

### SQLite — new table in `veesker.db`

```sql
CREATE TABLE IF NOT EXISTS object_versions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id  TEXT    NOT NULL,
    owner          TEXT    NOT NULL,
    object_type    TEXT    NOT NULL,
    object_name    TEXT    NOT NULL,
    commit_sha     TEXT    NOT NULL,
    ddl_hash       TEXT    NOT NULL,
    capture_reason TEXT    NOT NULL CHECK (capture_reason IN ('baseline', 'compile')),
    label          TEXT,
    captured_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS object_versions_lookup_idx
    ON object_versions (connection_id, owner, object_type, object_name, captured_at DESC);

CREATE INDEX IF NOT EXISTS object_versions_hash_idx
    ON object_versions (connection_id, owner, object_type, object_name, id DESC);
```

**Migration:** follows the existing `has_column()` + `CREATE TABLE IF NOT EXISTS` pattern in `persistence/store.rs`. Fully idempotent on existing installs.

**`label`** is nullable TEXT. Set after the fact via inline editing in the flyout.

### Git repository layout

```
<app_data>/object-history/
  <conn-id>/
    .git/
    SCOTT/
      PROCEDURE/
        MY_PROC.sql
      FUNCTION/
        MY_FUNC.sql
      PACKAGE/
        MY_PKG.sql
      PACKAGE_BODY/          ← underscore, not space
        MY_PKG.sql
      TRIGGER/
        MY_TRG.sql
      TYPE/
        MY_TYPE.sql
    HR/
      PROCEDURE/
        ...
```

- One repo per connection — fully isolated. A prod refresh in one connection never touches another.
- Paths: `<OWNER>/<TYPE>/<NAME>.sql` — all uppercase, as Oracle returns.
- `PACKAGE BODY` → directory `PACKAGE_BODY` to avoid path issues on Windows.
- Commit author: `Veesker <local>` (fixed).
- Commit message: `[baseline] SCOTT.PROCEDURE.MY_PROC` or `[compile] SCOTT.PACKAGE.MY_PKG`.
- Single branch: `main`.
- Remote `origin` configured optionally via `object_version_set_remote`. PAT stored in keyring under key `veesker:git:<conn-id>`. Remote URL stored in the repo's own git config (`git remote add origin <url>`) — no extra SQLite column needed; read back via `repo.find_remote("origin")?.url()`.

---

## Capture Flow

```
Frontend receives DDL string (from object.ddl RPC)
  │
  ▼
object_version_capture Tauri command
  │
  ├─ 1. Compute SHA-256 of DDL
  ├─ 2. Query SQLite: last ddl_hash for this object
  │       └─ if equal → return Ok (no-op, deduplicated)
  ├─ 3. Open or init git repo at <app_data>/object-history/<conn-id>/
  ├─ 4. Write DDL to <OWNER>/<TYPE>/<NAME>.sql in worktree
  ├─ 5. git add + git commit via git2
  └─ 6. INSERT into object_versions (commit_sha, ddl_hash, reason, captured_at)
```

Steps 3–6 are synchronous in the Rust command handler. On failure at any step, the error is logged and silently swallowed — the editor workflow is never blocked by a versioning failure.

---

## Rust Module

New file: `src-tauri/src/persistence/object_versions.rs`  
Added to: `src-tauri/src/persistence/mod.rs`

### Seven new Tauri commands (in `commands.rs`)

| Command | Params | Returns |
|---|---|---|
| `object_version_capture` | `connection_id, owner, object_type, object_name, ddl, reason` | `{ captured: bool }` |
| `object_version_list` | `connection_id, owner, object_type, object_name` | `ObjectVersionEntry[]` |
| `object_version_diff` | `connection_id, sha_a, sha_b, file_path` | `{ diff: string }` |
| `object_version_load` | `connection_id, commit_sha, file_path` | `{ ddl: string }` |
| `object_version_label` | `connection_id, version_id, label` | `{}` |
| `object_version_set_remote` | `connection_id, remote_url, pat` | `{}` |
| `object_version_push` | `connection_id` | `{ pushed_commits: u32 }` |
| `object_version_get_remote` | `connection_id` | `{ url: string \| null }` |

`ObjectVersionEntry`:
```typescript
{
  id: number;
  commitSha: string;
  ddlHash: string;
  captureReason: 'baseline' | 'compile';
  label: string | null;
  capturedAt: string;  // ISO 8601
}
```

`file_path` is `<OWNER>/<TYPE>/<NAME>.sql` — computed by the frontend from the same metadata.

### `object_version_label`

Updates the `label` column in SQLite. If label is non-empty, also creates a git tag `veesker/<owner>.<type>.<name>/<label>` pointing to the commit. If label is cleared, the tag is deleted.

---

## Frontend Components

### `src/lib/oracle.ts`

Eight new `invoke()` wrappers mirroring the command signatures above.

### `src/lib/workspace/ObjectVersionBadge.svelte`

Props: `{ connectionId, owner, objectType, objectName, onOpen }`.

Rendered inside `SqlDrawer.svelte`'s `file-actions` div alongside the existing compile/save buttons. Follows the exact `.file-btn` CSS pattern. Shows `v{count} · {time-ago}` in green when versions exist; hidden when count is 0 (no noise for non-PL/SQL tabs).

### `src/lib/workspace/ObjectVersionFlyout.svelte`

Props: `{ connectionId, owner, objectType, objectName, onLoadInEditor, onClose }`.

Layout: two-column panel (`220px + flex`).

- **Left column:** scrollable list of `ObjectVersionEntry` rows. Each row shows timestamp, short SHA, reason badge (`compile` in green, `baseline` in muted). Selected row highlighted with `#b33e1f` left border. Double-click on label area opens inline `<input>` — Enter saves, Escape cancels. "Abrir no editor" button at bottom.
- **Right column:** unified diff between the selected version and the most recent committed version (head of the object's history). Clicking a different row updates the diff target. Green/salmon colors matching Veesker palette. "Carregar no editor" button at bottom right.
- **Footer remote strip:** collapsed by default, toggled by a `⚙` icon. When expanded: shows current remote URL (if configured) or a URL + PAT input form. "↑ Push" button (green) pushes `main` to `origin` using the stored PAT. Shows "✓ pushed N commits" or an error inline. PAT field always masked.

Opened as an absolutely-positioned panel anchored below the badge button, z-index above the editor, dismissed by clicking outside or pressing Escape.

### Capture wiring in `+page.svelte`

- `onMount` of a PL/SQL object tab → fetch DDL via `object.ddl` → call `object_version_capture(reason='baseline')`.
- On successful compile response → call `object_version_capture(reason='compile')` with the current editor DDL.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `git2` fails to init repo | Error logged to `sidecar.log`, capture returns `{ captured: false }`, editor unaffected |
| Dedup match | Returns `{ captured: false }` — not an error |
| SQLite out of sync with git | `object_version_diff/load` returns error; flyout shows `[unavailable]` for that row |
| Object deleted from DB before capture | `object.ddl` RPC fails → frontend does not call capture |
| Flyout with no history | Empty state: "No versions captured yet" |
| Restore with unsaved editor changes | Frontend warns before replacing content (same guard as the existing `$effect` value sync) |

---

## Testing

### Rust unit tests (`persistence/object_versions.rs`)

Using `Connection::open_in_memory()` for SQLite and `tempfile::TempDir` for the git repo (same pattern as `wallet.rs` tests):

- `capture_creates_commit_and_sqlite_row`
- `capture_is_deduplicated_when_ddl_unchanged`
- `capture_dedup_does_not_apply_across_different_objects`
- `list_returns_versions_newest_first`
- `diff_returns_unified_diff_between_two_commits`
- `load_returns_ddl_at_given_commit`
- `label_updates_sqlite_and_creates_git_tag`
- `label_clear_removes_git_tag`
- `capture_creates_repo_on_first_call` (repo init idempotence)
- `package_body_uses_underscore_directory`
- `set_remote_stores_url_in_git_config_and_pat_in_keyring`
- `get_remote_returns_null_when_not_configured`
- `push_returns_error_when_no_remote_configured`

### Manual verification

- Open a PROCEDURE → badge appears with `v1`.
- Edit and compile → badge updates to `v2`.
- Compile again without change → badge stays `v2` (dedup).
- Open flyout → two rows visible, diff shows the change.
- Double-click row → inline label input appears, Enter saves.
- "Abrir no editor" → editor content replaced.
- Simulate refresh (delete object from DB, open fresh) → flyout still shows previous versions.

---

## Dependencies

Add to `src-tauri/Cargo.toml`:

```toml
git2 = { version = "0.19", default-features = false, features = ["https", "vendored-openssl"] }
sha2 = "0.10"
```

`default-features = false` disables SSH transport (not needed). `https` enables HTTPS push/fetch. `vendored-openssl` bundles OpenSSL so no system dependency is required on Windows or Linux — avoids the common "openssl not found" build error on Windows MSVC. Adds ~3 MB to the binary but eliminates all system OpenSSL setup.

---

## Error Handling — Push

| Scenario | Behavior |
|---|---|
| No remote configured | Returns error "No remote configured for this connection" |
| Invalid PAT / 401 | Returns error "Authentication failed — check your PAT" |
| Network unavailable | Returns error with git2 message; flyout shows inline error |
| Nothing to push (already up to date) | Returns `{ pushed_commits: 0 }` — not an error |
| PAT stored but remote URL missing | Treated as "no remote configured" |

---

## Out of Scope (explicitly)

- SSH authentication for push.
- Branching or merging.
- Versioning TABLE/VIEW/INDEX/SEQUENCE (future phase).
- Conflict resolution between versions.
- Multi-user / shared version history.
- Auto-push on every commit (user-initiated only).
