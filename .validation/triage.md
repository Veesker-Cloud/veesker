# Veesker — Validation Triage (Final, 2026-04-25)

## All 15 BLOCKERS — STATUS

| # | BLOCKER | Status | Commit |
|---|---|---|---|
| 1 | drainDbmsOutput crash (oracle.ts:417) | ✅ FIXED | f88356c |
| 2 | explainPlan SQL injection (oracle.ts:1367) | ✅ FIXED | f88356c |
| 3 | procExecute param-name validation (oracle.ts:1532) | ✅ FIXED | f88356c |
| 4 | License metadata MIT vs Apache | ✅ FIXED | f88356c |
| 5 | cargo fmt + 4 clippy warnings | ✅ FIXED | f88356c |
| 6 | openSession race (state.ts) | ✅ FIXED — withSessionLock mutex | this commit |
| 7 | DBMS_OUTPUT.ENABLE outside withActiveSession | ✅ FIXED — wrapped in withActiveSession | this commit |
| 8 | Zip-slip hardening (wallet.rs) | ✅ FIXED — canonicalize + reject .. + skip dirs/symlinks | this commit |
| 9 | Path validation in commands.rs (wallet_inspect, connection_save) | ✅ FIXED — validate_user_path helper applied | this commit |
| 10 | ords_test_http renderer-controlled URL/headers/TLS | ✅ FIXED — base URL from sidecar; header allowlist; cert verification ON | this commit |
| 11 | Audit log skippable by renderer | ✅ FIXED — write_audit_entry now called from query_execute (Rust-side) | this commit |
| 12 | debug.ts session leaks (safeStep, synchronizeWithTimeout) | ✅ FIXED — session.stop() on completion path; clearTimeout in extractCompletionResults | this commit |
| 13 | debugStart re-entrancy race | ✅ FIXED — _debugStartLock mutex + closingPromise() join | this commit |
| 14 | ORDS SQL injection (sqlString/sqlMultiline + identifier interpolation) | ✅ FIXED — validateOrdsName regex on schema/object/alias/module/route/proc + procParam names | this commit |
| 15 | ORDS privilege escalation (ordsApply accepting any SQL + authMode default "none") | ✅ FIXED — ordsApply now takes config, regenerates SQL server-side; normalizeAuth defaults to oauth, requires authConfirmedNone:true to opt into "none" | this commit |

## Bonus fixes also applied
- Portuguese error string in ords.ts:740 → English (CLAUDE.md mandate)
- bun update: 1 LOW cookie vuln resolved via package.json overrides
- All 3 test suites green: 173 frontend / 114 sidecar / 40 rust = 327 total

## IMPORTANT (54 — backlog for v0.2.1)
Documented in review-{frontend,rust-shell,sidecar-core,sidecar-specialized}.md

## POLISH (47 — backlog for v0.2.2)
Documented in review-*.md

## Conclusion

15/15 BLOCKERS resolved. All test suites green. Build clean (cargo fmt, clippy, audit).

Open core repo `gevianajr/veesker` is safe to:
1. Build v0.2.0 release artifacts (Windows + macOS .dmg)
2. Tag and publish on GitHub releases
3. Flip visibility to public

