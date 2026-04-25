# Veesker — Triage of Validation Findings (2026-04-25)

## BLOCKERS (15 — must fix before public release)

### Quick wins (1-30 min each)

**B-CORE-3** [oracle.ts:417-427] `drainDbmsOutput` TypeError when outBinds undefined
- Fix: add `if (!ob) break;` before status check
- Verifies: F-RT-1 from sidecar test runtime warning

**B-CORE-1** [oracle.ts:1367] `explainPlan` SQL injection
- Fix: validate `p.sql` is single statement via splitSql + reject DDL/DML keywords; or only allow within transaction wrapped explain
- Risk: anyone running EXPLAIN PLAN with crafted SQL can execute side effects

**B-CORE-2** [oracle.ts:1516-1543] `procExecute` parameter-name SQL injection
- Fix: validate `pm.name` matches Oracle identifier regex `/^[A-Za-z][A-Za-z0-9_$#]*$/` before interpolation; reject otherwise

**B-RUST-1** [wallet.rs:65-74] zip-slip defense-in-depth
- Fix: switch from string-prefix filter to canonicalize-and-startswith check + explicit `..` rejection

**B-FMT** [cargo fmt] 
- Fix: `cargo fmt`

**F-RUST-1,2,3,4** [clippy warnings]
- Remove dead code: `RpcError.data`, `worst_state`, `delete_api_key`
- Refactor: `assemble_basic_row` to take a struct param

**License mismatch**
- Fix: `package.json` says MIT but LICENSE file is Apache 2.0. Update `package.json` "license" → `"Apache-2.0"`

### Medium fixes (1-3 hours each)

**B-RUST-2** [commands.rs] path validation in `wallet_inspect`/`connection_save`
- Add `validate_user_path(app, &path)` helper; check against $DOCUMENT/$DESKTOP/$DOWNLOAD canonicalized roots; apply at every command taking `String` paths

**B-RUST-3** [commands.rs:915-975] `ords_test_http` renderer-controlled exfil
- Pin `allowed_base_url` to active connection (server-side lookup, not from renderer)
- Default `danger_accept_invalid_certs` to false; gate behind explicit user setting persisted server-side
- Cap headers to allowlist

**B-CORE-7** [state.ts + oracle.ts:114] openSession race
- Fix: serialize per-connectionId open via Mutex<HashMap<connId, oneshot>>; rejects concurrent opens

**B-CORE-8** [oracle.ts:514-517] `DBMS_OUTPUT.ENABLE` outside withActiveSession
- Fix: move inside the with-block; ensure cleanup on throw

**B-DEBUG-4** [debug.ts:817-836, 509-556] connection leaks in safeStep + synchronizeWithTimeout
- Add try/finally with session.stop() on every exit path
- Fix `extractCompletionResults` clearTimeout

**B-DEBUG-5** [debug.ts] debugStart re-entrancy race
- Mutex around debug session creation; await previous stop before starting

### Architectural fixes (>3 hours each)

**B-ORDS-1,2,3** [ords.ts] SQL injection / privilege escalation
- Replace `sqlString` with proper escaping or move all SQL building to bind vars + quoteIdent
- Replace `ordsApply({sql})` with regenerate-from-payload-on-server contract
- Default `authMode` to OAuth + warn loud on `none`; require explicit confirmation

**B-RUST-4** [commands.rs:404-427] audit log skippable
- Move audit JSONL write from `history_save` to `query_execute` (Rust-side, post-sidecar response)
- Keep `history_save` only for the SQLite history table

## IMPORTANT (54 total — should fix soon, can backlog)

Already documented per phase. Highlights:
- `Sidecar::call` 120s hard timeout doesn't propagate to Oracle (orphaned queries)
- `ConnectionService` blocking std::sync::Mutex inside async commands
- TNS aliases reject `.` and `-` (legitimate Oracle Cloud names dropped)
- `tnsnames.rs:18-22` regex too restrictive
- F-CHK-{8,9}: type mismatches in test fixtures (`explainNodes`, `username`)
- F-CHK-{15,16}: `RestModuleDetails.svelte` `detail` possibly null (fixed by reviewer in narrowing)
- F-CHK-{13,14}: OrdsBootstrapModal — false alarm per frontend reviewer (verified)
- ORDS Portuguese error strings (violates English-only rule)
- `BLOCKED_HOSTS` in embedding.ts misses RFC1918, localhost, IPv6
- ORDS clients role grants non-transactional
- `getCallStack` debugger function returns `[]` (stub)

## POLISH (47 total — nice-to-have)

Already documented per phase. Mostly a11y warnings, dead CSS, dark mode CSS variables not consistently used, minor refactors.

