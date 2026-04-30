# Remediation Notes — Audit 2026-04-30 (CE / Community Edition)

**Branch:** `security/audit-2026-04-30-remediation`
**Scope:** CE-side mirrors of audit fixes that touch shared code with CL.
**Plan reference:** `docs/superpowers/2026-04-30-security-audit-oracle-solve.md` (this repo)
**Audit reference:** `docs/superpowers/2026-04-30-security-audit-oracle.md` (this repo)

---

## Why this file exists

CE (this repo) and CL (`veesker-cloud-edition`) share ~95% of the codebase
(sidecar, Rust persistence, most of the Svelte frontend). After ignoring CRLF/LF
whitespace differences, semantic divergence is limited to:

- **Rust:** `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (CL has cloud + Vision commands)
- **Sidecar:** `sidecar/src/index.ts`, `sidecar/src/oracle.ts` (CL has Vision RPC handlers)
- **Frontend:** `src/lib/services/auth.ts`, `src/lib/workspace/LoginModal.svelte`,
  `src/routes/+page.svelte`, `src/lib/workspace.ts`, plus Vision\*.svelte files (CL only)

Audit findings that touch shared code (HIGH-002, MEDIUM-001, MEDIUM-002, MEDIUM-004,
LOWs, INFOs) **need to be applied in BOTH repos with the same diff**. This file
tracks CE's status; the CL tracker lives in `veesker-cloud-edition/REMEDIATION_NOTES.md`.

CE-irrelevant findings (CL-only): CRITICAL-001/002, HIGH-001 (cloud audit),
HIGH-003 (server rate limit), LOW-006 (CORS), PROD-001/002 (cloud features).

---

## Tracker — CE backports only

| ID | CL Commit | CE Commit | Files (shared) | Notes |
|----|-----------|-----------|----------------|-------|
| HIGH-002 (host validation) | (CL pending push) | (pending) | `src-tauri/src/persistence/connections.rs` | Same diff as CL; 16/16 validation_tests pass |
| MEDIUM-001 (AI regex) | (CL pending push) | (pending) | `sidecar/src/ai.ts` | CE has AI; identical fix; 22/22 tests pass |
| MEDIUM-002 (wallet path) | (CL pending push) | (pending) | `src-tauri/src/commands.rs` | Same edit as CL; cargo check passes |
| MEDIUM-004 (CSP) | 🟡 Partial | (pending) | `src-tauri/tauri.conf.json` | Same partial fix as CL; `'unsafe-inline'` retained pending Svelte refactor |
| PROD-001 sidecar gate | (CL pending push) | (pending) | `sidecar/src/ai.ts` | env=prod requires acknowledgeProdAi; 26/26 tests pass. CE UI gate (SheepChat modal) deferred to a follow-up commit since CE's SheepChat may diverge from CL's. |
| TERMS_OF_USE 6.1 | n/a | (pending) | `TERMS_OF_USE.md` | AI prod-unlock disclosure; effective date bumped to 2026-04-30 |
| LOW-001 (eprintln) | (pending Batch 4) | — | `src-tauri/src/persistence/connections.rs` | — |
| LOW-002 (Instant Client cache) | (pending Batch 4) | — | `src-tauri/src/sidecar.rs` (or sidecar/src/oracle.ts) | — |
| LOW-003 (logger Windows) | (pending Batch 4) | — | `sidecar/src/logger.ts` | — |
| LOW-004 (localStorage doc) | (pending Batch 4) | — | `src/lib/services/auth.ts` | File diverges — apply CE-specific |
| INFO-001 (oracledb bump) | (pending Batch 4) | — | `sidecar/package.json` | Same in both |

---

## Audit findings NOT applicable to CE

These ship only in CL because the corresponding feature doesn't exist in CE:

- CRITICAL-001 (JWT_SECRET) — server only
- CRITICAL-002 (magic link) — server + CL desktop only
- HIGH-001 (cloud audit redact) — no cloud audit in CE
- HIGH-003 (audit ingest rate limit) — server only
- LOW-005 (SSL pinning for cloud_api) — no cloud_api in CE
- LOW-006 (CORS allowlist) — server only
- PROD-002 (audit metadata-only) — no cloud audit in CE

---

## Decision Log

(deviations from plan with reasoning — appended chronologically)

### 2026-04-30 — CE branch created empty

CE branch `security/audit-2026-04-30-remediation` created from `main` with only
the `.gitignore` update (excluding `.obsidian/`) and this tracker. Audit, plan,
and pentest prompt docs live in `docs/superpowers/` of the CE repo; they were
written BEFORE this branch was created and are committed in the same initial
commit so the branch is self-contained for review.

CE backports for shared-code findings will land in subsequent commits as Batch 2
progresses in CL.

---

## Open Items / Punted

(none yet)

---

## Operator Runbook

CE has no server, no cloud features, no migrations. Operator action items are
all in `veesker-cloud/REMEDIATION_NOTES.md`.

---

## Rollback Plan

Each shared-code fix in CE is a single commit; revert the commit to roll back.
No state changes, no migrations.

---

## Known Limitations

(populated as fixes ship with documented compromises)
