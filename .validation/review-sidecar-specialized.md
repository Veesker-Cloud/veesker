# Veesker Sidecar — Specialized Modules Review

Reviewer: Senior Code Reviewer (read-only review).
Scope: `sidecar/src/sql-splitter.ts`, `sidecar/src/debug.ts`, `sidecar/src/ords.ts`, `sidecar/src/chart.ts`, `sidecar/src/embedding.ts`.

The review focused on (a) SQL injection in dynamically-built PL/SQL, (b) splitter correctness, (c) resource cleanup, (d) privilege escalation, and (e) crash-inducing bugs.

---

## BLOCKER (must fix before public release)

### B1. ords.ts — SQL injection via every dynamically generated PL/SQL block (CRITICAL)

`sqlString` (`sidecar/src/ords.ts:337-339`) is the only sanitization used by every `generate*` function. It only doubles single quotes:

```ts
function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
```

The frontend passes user-typed values straight through `ordsGenerateSql` (`ords.ts:523-587`) into the generators, which then concatenate them into raw PL/SQL that `ordsApply` later executes via `conn.execute(params.sql, [])` (`ords.ts:324-335`). Although `'` is escaped, the following inputs are NOT escaped/validated and break out of, or pollute, the generated SQL:

- `generateAutoCrudSql` (`ords.ts:360-380`):
  - `p.schema`, `p.objectName`, `p.objectType`, `p.alias`, `p.authRole` — all flow through `sqlString` only. `p.objectType` is even checked against `"TABLE"|"VIEW"` at the dispatcher level (`ords.ts:528`) but the generator itself happily takes any string. `p.alias` is built client-side (`ords.ts:529`) but a malicious frontend or future caller can pass anything. None of these go through `quoteIdent`.
- `generateCustomSqlEndpoint` (`ords.ts:392-423`):
  - `p.moduleName`, `p.basePath`, `p.routePattern`, `p.method`, `p.source`, `p.authRole` — `p.source` passes through `sqlMultiline` (`ords.ts:341-347`), which uses `q'[ ... ]'` if the source does not contain the literal substring `]'`. That check is **trivially bypassable** with `]'||DBMS_…||q'[`-style payloads or by injecting `]'` via Unicode normalization tricks. Even when `]'` is detected, the function falls back to `sqlString` which only escapes single quotes; the source is then copied literally into a PL/SQL HANDLER block at `ords.ts:411`. An attacker who controls `p.source` can inject any PL/SQL: there is no sandbox.
- `generateProcedureEndpoint` (`ords.ts:446-516`):
  - `p.schema`, `p.procName`, `p.packageName`, and especially `p.params[*].name` are interpolated into the generated wrapper at `ords.ts:456` (`fqn`), `ords.ts:461` (declare lines `v_${name.toLowerCase()}`), `ords.ts:467-469` (call args `${par.name} => v_${lower}`), and `ords.ts:478` (`APEX_JSON.write('${lower}', v_${lower})`). **Nothing in this chain calls `quoteIdent`.** A param name of `x); EXECUTE IMMEDIATE 'GRANT DBA TO PUBLIC'; --` is concatenated raw into the wrapper PL/SQL.
  - `procDescribe` (`oracle.ts:1471`) reads the actual `ALL_ARGUMENTS` view, so under normal flow the param name is real. But the type already passed through the wire as a plain string in `ordsGenerateSql` and there is no re-validation; a hostile frontend can trivially override it (the dispatcher at `ords.ts:564-568` only wraps it in `procParams`).
- All three generators put `p.authRole` into `ORDS_TYPES.role_array(...)` only sanitized by `sqlString`. Roles in Oracle are unquoted identifiers — an `'X'` literal is accepted there because of how `role_array` works, but the broader concern is that authorization decisions are driven by user input that we never verified exists.

**Why this is a blocker:** any user with access to the VRAS UI can craft endpoint configurations whose generated SQL, when "Apply"-ed, runs as their schema with OAUTH/ORDS package privileges — including `OAUTH.GRANT_CLIENT_ROLE`. Because `ordsApply` accepts a raw `sql` string as a parameter (`ords.ts:324`), it is also a confused-deputy: the frontend can submit *arbitrary* PL/SQL that bypasses generators entirely. There is no allow-list, no review step, no validation. This is effectively `eval(SQL)` under the user's schema.

**Required remediation:**
1. In all generators, run identifier-shaped inputs (`schema`, `objectName`, `objectType`, `alias`, `procName`, `packageName`, all param `name`s, `authRole`) through `quoteIdent` (or a numeric/regex whitelist for `objectType`, `method`, `argMode`).
2. `ordsApply` (`ords.ts:324-335`) must reject any SQL that did not come from a generator. Best fix: do NOT accept a `sql` string from the client; instead accept the structured params and re-run the generator server-side, then execute. Alternatively: hash the generator output and require the client to echo the hash back.
3. `sqlMultiline` should switch to a randomly-chosen unused delimiter (e.g., `q'<UUID>...< UUID>'`) that the source cannot contain, or refuse multi-line PL/SQL `source` values entirely and use a bind variable when ORDS supports it.
4. `generateProcedureEndpoint` builds a generated PL/SQL wrapper with raw param names. Validate every name with `/^[A-Z][A-Z0-9_$#]{0,29}$/i` before use.

Citations: `ords.ts:337-347, 324-335, 360-380, 392-423, 446-516, 523-587`.

### B2. ords.ts — Privilege escalation via unfiltered authMode handling

`generateAutoCrudSql` (`ords.ts:360-380`) emits `p_auto_rest_auth => FALSE` when `authMode === "none"`. The dispatcher (`ords.ts:536, 550, 580`) defaults `authMode` to `"none"` when the client omits it. Combined with the SQL injection above, a client can:

1. Send `type:"auto-crud", authMode:"none"` for a sensitive table (e.g., `SYS.USER$` if the user has SELECT on it, or any of their own audit tables).
2. The generated SQL enables auto-REST without auth: any unauthenticated HTTP caller hitting the resulting URL gets full table CRUD.

There is no server-side check that the caller has legitimate ownership of `p.schema`/`p.objectName` (the parsing schema must match, but ORDS allows enabling other-schema objects when grants are present — and the user is presumed to have those grants if the proc runs).

**Why this is a blocker:** A misused or compromised desktop client can publish unauthenticated REST endpoints over any table the user can SELECT. There is no audit, no review step, no warning before `ordsApply` commits.

**Required remediation:**
- Force `authMode` to a valid enum on the server side — reject anything that is not exactly `none|role|oauth`.
- Require explicit user confirmation in the frontend when `authMode === "none"`, AND log every `ordsApply` call to the audit log (`audit/YYYY-MM-DD.jsonl`) with the full SQL that was executed.
- Consider blocking `authMode:"none"` entirely for production use, behind a settings flag.

Citations: `ords.ts:368, 536, 550, 580`.

### B3. ords.ts — `ordsApply` accepts arbitrary SQL string from the frontend

`ordsApply` (`ords.ts:324-335`):

```ts
export async function ordsApply(params: { sql: string }): Promise<{ ok: true }> {
  const conn = getActiveSession();
  try {
    await conn.execute(params.sql, []);
  ...
```

The contract advertised by the dispatcher is "apply the SQL we just generated". In practice, the parameter is a free-form string: the client can pass *anything*, including `DROP TABLE`, `GRANT DBA TO PUBLIC`, or `BEGIN EXECUTE IMMEDIATE q'[...]'; END;`. There is no signature, no hash, no nonce binding the SQL back to a previous `ordsGenerateSql` call.

**Why this is a blocker:** in a future where Veesker exposes the JSON-RPC endpoint over a network (or a malicious local process injects into the sidecar's stdin), this is a remote-code-execution against the database. Even today, with stdin-only RPC, it's a poor abstraction — any frontend bug can corrupt the database.

**Required remediation:** as in B1.2 — the only safe contract is "frontend sends structured params; server regenerates; server executes". `ordsApply(sql)` should be deleted.

Citations: `ords.ts:324-335`.

### B4. debug.ts — Dual debugger sessions are NOT released on most error paths

`DebugSession` (`debug.ts:332-702`) opens TWO Oracle connections (`targetConn`, `debugConn`) on every `debugStart`. The cleanup paths are:

- `debugStart` (`debug.ts:718-815`) wraps `initialize()` in try/catch and calls `session.stop()` on failure (`debug.ts:735, 769, 796`). Good.
- After `synchronizeWithTimeout` returns, the success path **never calls `session.stop()`**. The frontend is expected to call `debugStop` (`debug.ts:843-846`). If the user closes the workspace without stopping, **both connections are leaked** until the sidecar restarts.
- `safeStep` (`debug.ts:817-836`): on timeout, calls `session.stop()` (good), but on a normal "completed" return it does NOT — the global `_debugSession` stays set, holding both connections, until the next `debugStart` (which calls `_debugSession.stop()` at `debug.ts:725`) or `debugStop`.
- `extractCompletionResults` (`debug.ts:460-504`): the 5-second `Promise.race` (`debug.ts:468-471`) does not cancel the underlying `_targetExecution`. If Oracle returns *after* the race, `outBinds` may include a `ResultSet` that never gets `close()`-d, leaking server-side cursors.
- `synchronizeWithTimeout` (`debug.ts:509-556`): on JS-side timeout, `this.debugConn.close()` is fired and forgotten. `targetConn` is not touched — if the target execute hung in DBMS_DEBUG, its connection stays open forever (Oracle won't release it until the TCP socket dies).

**Why this is a blocker:** repeated debug sessions accumulate two connections each. With Oracle's default `processes=300`, a few dozen debug sessions exhaust the listener.

**Required remediation:**
1. `safeStep` must call `session.stop()` whenever `result.status === "completed"` (the program has finished).
2. `synchronizeWithTimeout` timeout path should also `targetConn.close()`.
3. Wrap the entire `debugStart` flow in a try/finally that calls `stop()` if the function throws OR returns a "completed" result without ever pausing.
4. Implement an idle-timeout: if no `debug*` RPC arrives for N minutes, auto-stop the session.

Citations: `debug.ts:693-701, 718-815, 817-836, 509-556, 460-504`.

### B5. debug.ts — `extractCompletionResults` reuses a Promise that has already settled

In `extractCompletionResults` (`debug.ts:464-471`):

```ts
if (this._completionResultsExtracted || !this._targetExecution) {
  return { refCursors: [], outBinds: {} };
}
this._completionResultsExtracted = true;
const exec = await Promise.race([
  this._targetExecution,
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
]);
```

If the 5s timeout wins, `_completionResultsExtracted` is set to `true`, but the inner `_targetExecution` keeps running (it's a real `conn.execute(script, …)`). Two consequences:
- A future call gets `{ refCursors: [], outBinds: {} }` permanently — dropping legitimate results that arrive late.
- The `setTimeout` is not cleared after the race; it stays pending until 5s elapses, holding a Bun timer reference.

**Required remediation:** keep a `clearTimeout` reference and cancel it on the winning branch. If the timeout wins, leave `_completionResultsExtracted = false` so a later poll still has a chance.

Citations: `debug.ts:460-504`.

### B6. debug.ts — `debugStart` re-entrancy race

`debugStart` (`debug.ts:723-728`):

```ts
if (_debugSession) {
  process.stderr.write("[debug] stopping previous session\n");
  _debugSession.stop();
}
const session = await DebugSession.create();
```

`stop()` is fire-and-forget (closes connections without awaiting). Two concurrent `debugStart` calls (a user double-click, or a buggy frontend) interleave:
- Call A enters, finds no session, calls `DebugSession.create()` (await).
- Call B enters during A's await, finds no session yet (A hasn't set it), calls `create()` too.
- Both A and B end up with a `_debugSession` — the later one wins, but A's two Oracle connections leak silently.

**Required remediation:** use a `Promise<void>` lock (`_starting`) that callers await; the second call gets the first session or fails fast.

Citations: `debug.ts:723-738, 354`.

---

## IMPORTANT (should fix soon)

### I1. sql-splitter — q-quoted closer is matched by single character only

`splitSql` (`sql-splitter.ts:274-285`):

```ts
case "InQString": {
  const { closer } = state;
  if (ch === closer && next === "'") {
    buf += ch + "'";
    i += 2;
    state = { kind: "Code" };
    continue;
  }
  ...
}
```

This matches a single closer char followed by `'`. For paired delimiters (`[`, `<`, `(`, `{`), Oracle treats only the *paired closer*, not the opening char — this is correct. **But for non-paired delimiters (`!`, `#`, `~`, etc.), Oracle requires the same character followed by `'`, AND the literal payload may legitimately contain `!` so long as the next char is not `'`.** The current code is correct in that case.

However the splitter does NOT handle: q-quoted with a delimiter that itself looks like `'` — e.g., `q'''...'''` is invalid Oracle anyway, but the parser does not reject it explicitly.

Edge case: q-quoted with `[` opens; payload contains `]` followed by something *not* `'` (e.g., `]x`). The current logic correctly skips since `next !== "'"`. Good.

Real gap: the test suite has no case for q-quoted strings spanning multiple **lines** (very common in stored procs). Recommended: add `splitSql("BEGIN x := q'[a\nb;c\n]'; END;\n/")` to the test file.

Citations: `sql-splitter.ts:274-285`; tests at `tests/sql-splitter.test.ts:127-173`.

### I2. sql-splitter — line counter increments before state-specific consumption

`splitSql` (`sql-splitter.ts:97`):

```ts
if (ch === "\n") line++;
```

This increments unconditionally before the switch consumes the char. Inside string/comment states, the `\n` is consumed correctly, but the line counter and the buffer-position tracking can drift if a multi-byte sequence is involved. For pure ASCII PL/SQL this is fine; for code with embedded UTF-8 strings the counter is still accurate (newlines are single bytes). Low risk, just noting.

### I3. sql-splitter — `BEGIN` keyword detection is strict on word boundary but does not detect `WITH ... SELECT` PL/SQL-bearing constructs

`PLSQL_BLOCK_RE` (`sql-splitter.ts:19-20`) recognizes `DECLARE`, `BEGIN`, and `CREATE [OR REPLACE] [EDITIONABLE] {FUNCTION|PROCEDURE|TRIGGER|PACKAGE [BODY]|TYPE [BODY]}`. It does **not** recognize:
- `CREATE [OR REPLACE] LIBRARY` (rare but legal — terminated by `/` traditionally)
- `CREATE [OR REPLACE] JAVA SOURCE/CLASS`
- `WITH FUNCTION foo … SELECT …` (Oracle 12c+ inline PL/SQL — terminator is `;`, so this works incidentally)
- `CREATE OR REPLACE FORCE VIEW … AS SELECT …` — terminator is `;`, so it correctly falls through.

Acceptable for v1. Document the unsupported forms in code comments.

### I4. ords.ts — `ordsEnableSchema` is not idempotent and ignores prior errors

`ordsEnableSchema` (`ords.ts:245-249`):

```ts
await conn.execute(`BEGIN ORDS.ENABLE_SCHEMA(p_enabled => TRUE); COMMIT; END;`, []);
```

Calling `ENABLE_SCHEMA(TRUE)` on an already-enabled schema raises `ORA-20000` in some ORDS versions. There is no try/catch translating this into a friendlier message, and the caller can't tell the difference between "already enabled (success)" and "permission denied". Add `p_url_mapping_type => 'BASE_PATH'` and `p_auto_rest_auth => FALSE` to make the call deterministic.

### I5. ords.ts — `ordsClientsCreate` is not transactional across multiple roles

`ordsClientsCreate` (`ords.ts:619-665`) creates a client + COMMITs, then in a loop calls `OAUTH.GRANT_CLIENT_ROLE` + COMMIT for each role. If any single role grant fails (typo in role name, role doesn't exist), the client exists with a partial role set and the function throws — leaving the database in an inconsistent state with no rollback. Fix: wrap in a single `BEGIN ... END;` block that does all grants then commits once.

### I6. embedding.ts — Blocked-host list is incomplete

`BLOCKED_HOSTS` (`embedding.ts:11-16`) blocks IMDS endpoints for AWS/GCP and a couple of aliases. Missing:
- `127.0.0.1`, `localhost`, `0.0.0.0`, `::1` — for the **non-Ollama** providers, hitting localhost is almost certainly a misconfiguration or SSRF target.
- IPv6 link-local: `fe80::*`.
- All RFC1918 ranges (`10.*`, `172.16-31.*`, `192.168.*`) — a "custom" provider URL pointing at the user's intranet can be used to scan internal services.

Note: the validator is only applied to "custom" and "ollama-with-custom-baseUrl". OpenAI and Voyage hardcode the host. Ollama localhost-default is intentional. Recommend: split into `validateExternalEmbedUrl(url)` for "custom" (strict), keep the looser one for Ollama.

Citations: `embedding.ts:11-32, 88-103`.

### I7. embedding.ts — No timeout on `fetch` calls

All four embed functions use plain `fetch` with no `AbortSignal.timeout(...)`. A misconfigured server (or a malicious one for "custom") can hang the sidecar indefinitely, blocking all other RPC. Add `signal: AbortSignal.timeout(30_000)` to every fetch.

### I8. embedding.ts — Crashy response parsing for OpenAI/Voyage

`embedOpenAi` (`embedding.ts:69-71`) does:

```ts
const data = await res.json() as { data: Array<{ embedding: number[] }> };
return data.data[0].embedding;
```

If the API returns an unexpected shape (rate-limit JSON, error envelope), this throws `TypeError: Cannot read properties of undefined`. The user sees an unhelpful crash. Add `if (!Array.isArray(data?.data) || !Array.isArray(data.data[0]?.embedding)) throw new Error("OpenAI returned no embedding")`. Same for Voyage at `embedding.ts:84-85`.

### I9. debug.ts — `getValuesForVars` has no input validation

`getValuesForVars` (`debug.ts:661-687`) passes `name` straight into `DBMS_DEBUG.GET_VALUE(:varname, …)` as a bind. That is safe for SQL injection (it's a bind), BUT the function loops with no upper bound on `varNames.length`. A malicious frontend can send 10 000 var names and pin the debugger for minutes. Add `if (varNames.length > 256) throw …`.

### I10. debug.ts — `getCallStack` is a stub returning `[]`

`getCallStack` (`debug.ts:689-691`) always returns an empty array but is exposed as `debugGetCallStack` RPC (`debug.ts:875-879`). The UI may render an empty stack as "you're in main" — confusing. Either implement using `DBMS_DEBUG.GET_RUNTIME_INFO` looped over backtrace_depth, or document explicitly in the UI that this is unimplemented, or remove the RPC.

### I11. debug.ts — Reason-code fallback for `libunit_type` returns `PROCEDURE`

`libunitTypeToString` (`debug.ts:301-312`) returns `"PROCEDURE"` for any unknown integer. If Oracle introduces a new libunit type (e.g., type 10), the UI silently treats it as a procedure. Log a warning to stderr in the default branch.

### I12. ords.ts — Result-row coercion uses both UPPER and lower keys

Every ORDS function does `r.NAME ?? r.name ?? r.Name`. This is harmless but duplicative. The sidecar already passes `outFormat: oracledb.OUT_FORMAT_OBJECT` and Oracle returns uppercase keys deterministically. Pick one. Recommendation: drop the lowercase fallbacks; they hide schema-renaming bugs.

### I13. chart.ts — `evictOldestSession` will mis-evict due to `Map.keys().next().value!`

`evictOldestSession` (`chart.ts:33-37`):

```ts
if (sessions.size >= MAX_SESSIONS) {
  sessions.delete(sessions.keys().next().value!);
}
```

This is called at `chartConfigure` line 123 only when the session ID is not yet in the map. If 64 distinct session IDs are alive and a 65th appears, the first-inserted one is evicted (FIFO). That is fine, but: the `!` non-null assertion is unsafe if the map is empty (size === 0) — although the guard prevents that. Still, the eviction policy is FIFO not LRU; on a long-lived session that gets reused, it can be evicted while still in active use. Switch to LRU by `delete`/`set` on access.

---

## POLISH

### P1. ords.ts — Mixed Portuguese/English in user-facing error messages

`ords.ts:172`: `"ORDS not configured for this schema. Use the ORDS bootstrap modal to enable it."` (English).
`ords.ts:330`: `"ORDS package not accessible. Habilite o schema para ORDS antes de aplicar."` (Mixed).
`ords.ts:643`: `"ORDS/OAUTH packages not accessible to this schema. Habilite o schema para ORDS pelo modal de bootstrap."` (Mixed).

The project's CLAUDE.md mandates "English only. No Portuguese in code, comments, variable names, or commit messages." These three strings violate that.

### P2. ords.ts — `ordsModuleGet`/`ordsModulesList` return shapes use any-typed rows

`ords.ts:134-152, 161-244` — every map uses `(r: any) =>` and tries multiple casings. Define a typed row interface for each query.

### P3. debug.ts — Dead `getCallStack` member function

If I10 is fixed by removing the RPC, also remove the stub at `debug.ts:689-691`.

### P4. debug.ts — Unused exported reason constants

`REASON_ENTER (6)`, `REASON_RETURN (7)`, `REASON_LINE (9)`, `REASON_EXCEPTION (11)` are exported (`debug.ts:270-274`) but never referenced outside their declaration. Either use them in `isDoneReason`/UI, or drop the `export`.

### P5. sql-splitter — `flush()` and `isCommentsOnly()` recompute leading-comment strip

`flush` (`sql-splitter.ts:71-79`) calls `isCommentsOnly(trimmed)` which calls `stripLeadingComments`. Cheap, but for very long inputs this is O(n) per flush. Inline the check or short-circuit on the first non-comment char.

### P6. embedding.ts — `embedCustom` accepts both `input` and `text` keys in body

`embedding.ts:94`: `JSON.stringify({ model: p.model, input: p.text, text: p.text })`. Sending both keys is harmless but ugly. Either pick one or document that the custom server must accept either.

### P7. chart.ts — Magic constant `MAX_SESSIONS = 64`

Acceptable, but document why 64 specifically.

### P8. chart.ts — `applyAgg` returns 0 for empty input on `min`/`max`

`applyAgg(values, "max")` with `values.length === 0` returns 0 (`chart.ts:48`). For aggregations of empty result sets this is misleading — should return null/NaN and let the UI display "—".

### P9. debug.ts — `process.stderr.write` everywhere

Many debug logs at `debug.ts:366, 376, 381, 510, 517, 527, …`. Very useful during development, but in production these spam stderr unconditionally. Gate behind `if (process.env.VEESKER_DEBUG_LOG)` or a logger.

### P10. debug.ts — `_targetExecution: Promise<any>` typed as `any`

Replace with `Promise<oracledb.Result<unknown> | null>` for clarity (`debug.ts:337`).

### P11. ords.ts — Inconsistent quoting of base-path components

`generateCustomSqlEndpoint` line 417 strips trailing slash with `replace(/\/$/, "")` then concatenates `"/*"`. If `basePath === ""`, the pattern becomes `"/*"`. Acceptable but worth a guard.

---

## Files reviewed

- `C:\Users\geefa\Documents\veesker\sidecar\src\sql-splitter.ts` (313 LOC) — read in full.
- `C:\Users\geefa\Documents\veesker\sidecar\tests\sql-splitter.test.ts` (405 LOC) — read in full.
- `C:\Users\geefa\Documents\veesker\sidecar\src\debug.ts` (953 LOC) — read in full.
- `C:\Users\geefa\Documents\veesker\sidecar\src\ords.ts` (674 LOC) — read in full.
- `C:\Users\geefa\Documents\veesker\sidecar\src\chart.ts` (135 LOC) — read in full.
- `C:\Users\geefa\Documents\veesker\sidecar\src\embedding.ts` (103 LOC) — read in full.

Cross-referenced: `sidecar/src/oracle.ts` (lines 1-30, 155-185, 1471-1545 — `quoteIdent`, `withActiveSession`, `procDescribe`), `sidecar/src/state.ts` (full).

---

## Verdict

**BLOCKERS FOUND: 6**

The SQL-injection surface in `ords.ts` (B1, B2, B3) is the most serious: an attacker who controls the JSON-RPC stream — including a buggy or malicious frontend, or a future networked deployment — can run arbitrary PL/SQL as the user's schema, publish unauthenticated REST endpoints over any table, and bypass all authorization. **`ordsApply(sql)` accepting a free-form SQL string is the single highest-priority fix.**

The debugger leak issues (B4, B5, B6) will surface as connection exhaustion in any user who debugs more than a few procedures per session.

Sub-blocker issues (I1-I13) and polish items (P1-P11) are tracked but not release-blocking.

**Recommendation: DO NOT release publicly until B1-B6 are remediated.** Re-review required after fixes.
