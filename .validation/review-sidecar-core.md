# Veesker Sidecar — Oracle/AI/Entry Layer Review

Scope: production readiness review of seven sidecar files in preparation for public open-source release. Read-only review; no code modified.

---

## BLOCKER

### B1. SQL injection via `explainPlan` — `p.sql` interpolated raw into SQL text
**File:** `sidecar/src/oracle.ts:1367`
```ts
await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${sid}' FOR ${p.sql}`);
```
`p.sql` is taken directly from the JSON-RPC `explain.plan` request and concatenated into the executed SQL. The `sid` interpolation is safe (machine-generated UUID), but `p.sql` is fully user-controlled and can contain anything — including extra statements after a closing `)` or PL/SQL injected via tricks. While EXPLAIN PLAN itself does not execute the inner statement, the surrounding SQL is parsed by Oracle, and several injection paths exist:

1. The user can craft `p.sql` so that the resulting text closes EXPLAIN early and runs another statement, e.g. submitting `SELECT * FROM dual; DROP TABLE veesker_audit; --` — depending on driver behavior, the trailing `;` is treated as separator.
2. Even when restricted to a single statement, EXPLAIN PLAN of a query referencing function calls can trigger evaluation of stored functions via predicates (Oracle hardens against this, but the surface is broad).

Because the entry point is the local stdio JSON-RPC the operator's UI feeds it, exploitation requires a malicious frontend or a compromised sidecar parent — but for a public open-source IDE this is exactly the threat model (a malicious extension/plugin/page could submit RPCs).

**Recommendation:** Validate `p.sql` (allow only `SELECT`/`WITH` after a strip of comments — same rule as `isReadOnlySql` in `ai.ts`) and reject statements containing `;` other than a single trailing one. Ideally wrap with `BEGIN EXECUTE IMMEDIATE 'EXPLAIN PLAN ... FOR ' || :sql; END;` using a bind, but Oracle does not accept binds for the inner DML. The pragmatic fix is: parse `p.sql` to a single statement (use the existing `splitSql`), reject non-SELECT/WITH, then interpolate.

---

### B2. SQL injection via `procExecute` parameter names from `ALL_ARGUMENTS`
**File:** `sidecar/src/oracle.ts:1516–1543` (and `_procDescribeConn` at 1443–1469 supplying `pm.name`)

`pm.name` comes from `ALL_ARGUMENTS.argument_name`. It is then interpolated into:

```ts
binds[`i_${pm.name}`] = ...
callArgs.push(`${pm.name} => :i_${pm.name}`);
```

For most schemas this is fine because Oracle stores argument names as plain identifiers. **However**, if a user has CREATE PROCEDURE rights and creates a procedure whose argument names contain quoted-identifier characters (Oracle allows `"weird-name"` if quoted at definition time), the value coming back from `ALL_ARGUMENTS.argument_name` can contain `"`, spaces, or even injected text. Since `pm.name` is also used as the LHS of `=>` in named-argument syntax and as a bind variable name, it is double-trusted.

A user with permission to write a procedure on the database they connect to could craft a procedure whose `argument_name` is something like `X => p_foo, Y => SYS.DBMS_RANDOM.VALUE(),` — Oracle would refuse most truly malicious payloads at parse time, but the call expression construction is unsafe in principle.

**Recommendation:** Validate `pm.name` with the same regex used by `quoteIdent` (`/^[A-Za-z0-9_$#]{1,128}$/`) before using it in either bind names or the call expression. Reject the operation if the regex fails.

Severity rationale: requires DBA-level rights at the target database to plant a hostile procedure, but this is a public IDE that connects to *any* database the user provides — including read-write production. A malicious DBA at a customer site could weaponize a “diagnostic” procedure to attack a Veesker user. Worth blocking.

---

### B3. `drainDbmsOutput` — `ob.STATUS` crash when `outBinds` is null/undefined
**File:** `sidecar/src/oracle.ts:417–427`

The known issue you mentioned. The cast at line 424 lies:
```ts
const ob = r.outBinds as { LINE: string | null; STATUS: number };
if (ob.STATUS !== 0) break;
```
`oracledb.Connection.execute` types `outBinds` as `oracledb.BindParameters | undefined`. If the driver ever returns `undefined` (older thin-mode versions sometimes did when `DBMS_OUTPUT.GET_LINE` is invoked on a server with output disabled, or after a session reset), `ob.STATUS` throws `TypeError: undefined is not an object`. The whole drain loop is wrapped in `try/catch` that swallows everything to `null`, so the crash does not propagate, but every `procExecute` and multi-statement run that hits this returns `dbmsOutput: null` and prints `[drainDbmsOutput] TypeError: ...` to stderr.

**Confirmed not fixed.** The cast suppresses the type-checker; the runtime guard is missing. Add:
```ts
const ob = r.outBinds as { LINE?: string | null; STATUS?: number } | undefined;
if (!ob || typeof ob.STATUS !== "number" || ob.STATUS !== 0) break;
```

---

### B4. `vectorSimilaritySearch` — `metric` interpolated as identifier without enum-check enforcement
**File:** `sidecar/src/oracle.ts:1087–1121`

```ts
const metric = ["COSINE", "EUCLIDEAN", "DOT"].includes(p.distanceMetric)
  ? p.distanceMetric
  : "COSINE";
```
This is fine in isolation, but the same param is also used in `vectorCreateIndex` (line 1248) and the user-fed value is typed as `"COSINE" | "EUCLIDEAN" | "DOT"` — TypeScript types provide no runtime guarantee. If somebody bypasses the frontend and sends `{ "distanceMetric": "COSINE) -- INJECT" }`, the include-check silently falls through to `"COSINE"`, so this *specific path* is safe. **However**: `vectorCreateIndex` does the same dance with `org` (line 1250):
```ts
const org = p.indexType === "ivf" ? "NEIGHBOR PARTITIONS" : "INMEMORY NEIGHBOR GRAPH";
```
and `accuracy` (line 1249) is clamped via `Math.round(Math.min(Math.max(...)))`, which is fine.

The real concern is `metric` in `vectorCreateIndex` (line 1248): the same allow-list pattern is used **but** if `p.metric` arrives as the literal string `"COSINE) ..."` it falls back to `"COSINE"`, so we're OK there too.

I am downgrading this from BLOCKER to a defensive note — the allow-list checks do work — but flag it because:
- The allow-list test on line 1087 vs line 1248 is duplicated. Centralize.
- Line 1117 uses backtick interpolation of the variable `metric` directly; if any future edit removes the include check, injection becomes possible.

**Recommendation:** Extract a `normalizeDistanceMetric()` helper that throws on invalid input (rather than silently coercing) and use it everywhere. Same for `indexType`.

(Reclassifying this from a BLOCKER to IMPORTANT — see I3.)

---

### B5. `aiChatViaCli` — argument `["claude", "-p", "-"]` may be on PATH controlled by the user
**File:** `sidecar/src/ai.ts:163`

`Bun.spawn(["claude", "-p", "-"], ...)` is invoked when no `apiKey` is configured. This is intentional fallback to Claude Code CLI auth, but:
1. `claude` is resolved from `$PATH`. On a machine where the user PATH has been hijacked (or where a different `claude` binary exists earlier in PATH — common for users with multiple Anthropic tools installed), the sidecar silently invokes a different binary.
2. The full conversation (system prompt + history + last user message + active SQL from the editor) is piped to stdin. The active SQL may contain proprietary schemas, customer data, or credentials embedded in `CONNECT BY` predicates pulled from a SQL editor.

This is not strictly a "blocker" because the user opted in by not setting an API key. But the path resolution risk is unaddressed. **Recommendation:** Resolve `claude` via `which`/`where` once at sidecar start, log the absolute path, and refuse to fallback if the binary is not found in well-known locations (`/usr/local/bin`, `~/.bun/bin`, `~/.claude/local/bin` for Windows). Also document this prominently in the README — auditors will flag it.

(Reclassifying this from BLOCKER to IMPORTANT — see I4.)

---

### B6. `aiSuggestEndpoint` and `aiChat` — API key surface in error messages
**File:** `sidecar/src/ai.ts:280, 312`

```ts
throw { code: -32603, message: "Anthropic API key not configured. ..." };
```
Throws a plain object (not Error). When this propagates through `dispatch` in `handlers.ts:18`, `extractErrorMessage` reads `(err as any).message` correctly, but `(err as any).code` is also surfaced. That is fine, but the `aiSuggestEndpoint` invalid-JSON path (line 312) leaks the raw model output to the RPC response: `"AI returned invalid JSON: " + text.slice(0, 200)`. If the model echoes part of the prompt — including any PII the user pasted — it ends up in an error message that may be logged. Low risk, but worth noting.

More importantly: at `ai.ts:188` and `ai.ts:293`, the API key is passed to `new Anthropic({ apiKey: key })`. The `Anthropic` SDK stashes this in headers; if the SDK ever throws an error including the request, the response chain in `dispatch` could surface it. The SDK does sanitize this, but **`apiKey` is also accepted as a raw RPC param** — meaning the *frontend* sees and forwards it. A renderer-process bug or a leaky log call (`console.error(err)` in `embedBatch:1336` is fine, but global handlers in `index.ts:147` print the entire fatal err) could leak it. **Recommendation:** Never log `params` for `ai.chat`/`ai.suggest_endpoint`/`embed.batch` (no logger here today, but worth a note as a guardrail). Confirm `console.error("sidecar fatal:", err)` at `index.ts:147` cannot stringify in-flight messages.

---

### B7. `state.ts` — single global mutable session, no guard against concurrent `openSession`
**File:** `sidecar/src/state.ts:5–9`, `sidecar/src/oracle.ts:114–147`

Two simultaneous `workspace.open` calls (which can happen because `index.ts:137` dispatches every request fire-and-forget) race:
1. `openSession A` enters, calls `hasSession()` → false, awaits `buildConnection`.
2. `openSession B` enters, calls `hasSession()` → false, awaits `buildConnection`.
3. A finishes, calls `setSession(connA, schemaA)`.
4. B finishes, calls `setSession(connB, schemaB)` — leaks `connA` (never closed, holds a TCP socket and an Oracle session indefinitely until the OS GC closes it minutes later).

Same race in the `if (hasSession())` close-old-session path.

**Recommendation:** Add an `_openSessionLock: Promise<void>` mutex around `openSession`. Same goes for `closeSession`. The race is exposable from the frontend if a user double-clicks "Open Workspace" with a slow network.

---

### B8. `queryExecute` multi-statement path leaks `_running` slot if `withActiveSession` throws non-RpcCodedError
**File:** `sidecar/src/oracle.ts:519–563`

The outer `try/finally` at lines 500–563 cleans up `_running`. Inside the loop, `withActiveSession` is called (line 531). If `getActiveSession()` itself throws (because session was lost between statements), the throw escapes the inner try/catch (line 546) because `RpcCodedError` is matched, which goes into the `catch` block, gets pushed as `error`, then `break`. That's fine.

But notice: line 514–517 calls `getActiveSession().execute(...)` directly without wrapping in `withActiveSession`. If session is dead at this exact moment, the throw escapes the inner try/finally and propagates up. The `_running` cleanup still happens (outer `finally`), but the error is uncoded, and it's wrapped by `dispatch` as `-32000`. Inconsistent with the rest of the code. **Recommendation:** Wrap the `DBMS_OUTPUT.ENABLE` call in `withActiveSession` or its own try/catch.

---

## IMPORTANT

### I1. `connectionTest` and `buildConnection` — `connectTimeout` mismatch (10 vs 15 seconds)
**File:** `sidecar/src/oracle.ts:46, 55, 100, 110`

Slight inconsistency. Not breaking, but it can confuse users who get different timeout behaviour between "Test connection" and "Open workspace". Standardize on 15s and document it.

### I2. `openSession` — leaks the *new* connection if the prior session's `close()` succeeds but `setSession` is never reached
**File:** `sidecar/src/oracle.ts:114–146`

Line 117–122: closes old session if any. Line 125: builds new connection. Lines 127–141: queries server version + schema. If those queries throw a `Fatal/parse` error, the catch at 142 closes the new connection. Good. But if `setSession` itself throws (it currently can't because it's pure assignment, but if you ever extend it), the new connection is leaked. Defensive: assign to a local first, then call `setSession` last.

### I3. Distance-metric / index-type allow-lists silently coerce instead of throwing
**File:** `sidecar/src/oracle.ts:1087–1090, 1248`

Already covered in B4. Reclassified here because the current code is safe — it just hides bugs. A typo `"DOT_PRODUCT"` from the frontend would silently default to `"COSINE"` and the user would never know. Throw on invalid input; let the frontend handle the user-visible error.

### I4. `aiChatViaCli` — PATH-resolution risk
Already covered in B5. Reclassified.

### I5. `procExecute` — REF CURSOR row cap (1000) is silent
**File:** `sidecar/src/oracle.ts:1580`

```ts
while ((row = (await rs.getRow()) as unknown[] | undefined) && rowCount < 1000) {
```
Caps at 1000 rows but the result type doesn't tell the caller "truncated". If a customer's procedure returns a 50,000-row REF CURSOR, the user sees 1000 rows and assumes that's the full set. **Recommendation:** Add `truncated: boolean` to the result type and set it when the loop hit the cap.

### I6. `embedBatch` — no overall transaction control
**File:** `sidecar/src/oracle.ts:1326–1342`

Each row's `UPDATE` runs and commits at the end of the batch. If `embedText` throws halfway and `errors > 0` but `embedded > 0`, the partial batch is committed. That's fine for vector embedding (idempotent re-runs handle it), but worth documenting. Also: no rate-limiting between `embedText` calls — if the OpenAI/Anthropic embedding API rate-limits, the loop will throw `errors++` for every row in burst. Consider per-row backoff.

### I7. `query.cancel` race — `_running.cancelled = true` then `break()`
**File:** `sidecar/src/oracle.ts:578–591`

If `queryExecute` finishes between the `cancelled = true` write and the `break()` call, the `break()` throws (caught and ignored), and the next query that starts may inherit a `_running` slot that says cancelled. Actually no — `_running` is reassigned at the start of every `queryExecute`, so this is safe. But the comment "break() may fail if the query already completed; that's fine." is incomplete: `break()` could also fail because the connection is dead. Same outcome (caught), but worth logging in debug mode.

### I8. `queryExecute` — `maxRows: 100` is a silent limit
**File:** `sidecar/src/oracle.ts:471`

100 rows is the cap for SELECT results returned over RPC. The shape `QueryResult` does not include a `truncated` field. Users running `SELECT * FROM big_table` get 100 rows and no indication that there are more. Mirror the I5 recommendation: add `truncated` to `QueryResult`.

### I9. `objectsSearch` — `LIKE '%' || :q || '%'` does not escape `_` and `%` in `q`
**File:** `sidecar/src/oracle.ts:1029`

The user's search query is bound (good — no SQL injection), but `_` and `%` inside the query become wildcards. A user searching for `EMP_DATA` matches `EMPDATA`, `EMPxDATA`, etc. Not security; UX bug. **Recommendation:** Escape `%`, `_`, `\` in `q` and add `ESCAPE '\'`.

### I10. `dispatch` — error code passthrough trusts `(err as any).code` blindly
**File:** `sidecar/src/handlers.ts:19`

```ts
const code = typeof (err as any)?.code === "number" ? (err as any).code : -32000;
```
If a handler accidentally throws an Oracle error object that has a `code: 942` property (table or view does not exist), the RPC response carries `code: 942` — not in the JSON-RPC reserved range, but unexpected by the frontend. **Recommendation:** Only pass through `code` if the error is `instanceof RpcCodedError`. Otherwise default to `-32013` (ORACLE_ERR) for `instanceof Error`, `-32000` for everything else.

### I11. `index.ts` main loop — JSON.stringify on RPC response can throw on circular Oracle objects
**File:** `sidecar/src/index.ts:117–139`

If a handler returns an object containing a circular reference (e.g., a `oracledb.ResultSet` accidentally not closed and serialized), `JSON.stringify` throws and the entire dispatch chain dies for that one request. The `.catch((err) => writeLine(makeError(...)))` at line 139 catches the dispatch promise rejection, but the `writeLine` itself can throw on the result. Wrap `writeLine`:
```ts
function writeLine(obj: unknown) {
  let line: string;
  try { line = JSON.stringify(obj); }
  catch (e) { line = JSON.stringify(makeError(null, -32603, "Result not serializable: " + (e as Error).message)); }
  process.stdout.write(line + "\n");
}
```

### I12. `index.ts:124` — `for await ... of process.stdin as any` silently terminates on EOF
**File:** `sidecar/src/index.ts:121–149`

When the parent Tauri process closes stdin (parent crash, kill -9), the loop ends and `main()` returns, calling `process.exit(0)` at line 145. That is the desired behaviour, but it means a partial line in `buffer` is silently discarded. If the parent sent `{"id":1,"method":"workspace.open"...` without a newline, the request is dropped without a response. The frontend will hang forever. **Recommendation:** On loop exit, if `buffer.length > 0`, log a warning. Also consider sending an error response with `id: null` for unparseable trailing data.

### I13. `parseRequest` rejects valid JSON-RPC notifications and batches
**File:** `sidecar/src/rpc.ts:12–28`

The current parser requires both `method` (string) and `id` (number|string). JSON-RPC 2.0 allows notifications (no `id`) and batches (array). Veesker does not use them today, but for "JSON-RPC 2.0" compliance you should at least gracefully reject batches with a proper error, not silently drop. As written, batch requests cause `parseRequest` to return `null` and emit `-32700 Parse error`, which is wrong (batch is well-formed JSON, just unsupported). Pick one: either support, or return `-32600 Invalid Request`.

### I14. `procDescribe` — overloaded packaged procedures are merged (data corruption potential)
**File:** `sidecar/src/oracle.ts:1443–1469`

The comment at line 1444 says: "ALL_ARGUMENTS without subprogram_id filtering merges overloaded overloads — standalone procedures only." Yet `procExecute` is invoked unconditionally with the merged params, which means calling an overloaded packaged proc returns garbage parameter metadata, leading to wrong binds, wrong call expression, and either ORA-06550 or — worse — calling the wrong overload with wrong types. **Recommendation:** Either reject overloaded procs (add a `subprogram_id` filter and verify count) or expose `subprogram_id` in the param model. As-is, this is a correctness blocker for any package with overloads.

### I15. `vectorSimilaritySearch` — `Number(score)` returns `NaN` for null
**File:** `sidecar/src/oracle.ts:1141`

```ts
const scores = rows.map((r) => (scoreIdx >= 0 ? Number((r as unknown[])[scoreIdx]) : 0));
```
If a row has a null score (shouldn't happen with `IS NOT NULL` filter, but defensive), `Number(null)` is 0 (OK) but `Number(undefined)` is `NaN`. `NaN` serializes as `null` in JSON, not as a number, so the frontend sees `null` for some scores. Add an explicit guard.

### I16. Type safety — `as any` and `(params as any)` in every dispatch
**File:** `sidecar/src/index.ts:54–113`

Every handler binding is `(params) => fn(params as any)`. This is the natural friction with JSON-RPC, but it means *any* malformed param (missing `owner`, wrong type) goes straight to the Oracle layer and fails with a confusing error. **Recommendation:** Introduce a Zod (or similar) schema per handler in `handlers.ts` and validate before the cast. Cleaner errors, defense in depth.

### I17. `ai.ts:isReadOnlySql` — does not catch `SELECT ... FOR UPDATE`
**File:** `sidecar/src/ai.ts:81–93`

`SELECT * FROM emp FOR UPDATE` is "read-only" by the regex but locks rows. If concurrent writers depend on those rows, AI-driven exploration can deadlock production. Add `\bFOR\s+UPDATE\b` to the dangerous list.

### I18. `ai.ts:run_query` — no row-count limit enforced server-side
**File:** `sidecar/src/ai.ts:105–112`

The frontend slices `rows.slice(0, 50)`, but `queryExecute` already caps at 100. Two concerns:
- The slice happens *after* the full Oracle response. If a user's malicious query returns 100 rows of 4MB CLOBs, the entire 400MB response is buffered before the slice.
- The model gets only 50 rows but the JSON we send back may include all 100 if `(res as any).rows` is not what we think (it's the full 100). Actually `slice(0, 50)` does cap. OK.

**Recommendation:** Force `maxRows: 50` for AI-driven queries by passing through to a dedicated path, not the general `queryExecute`.

---

## POLISH

### P1. `errors.ts` — `OBJECT_NOT_FOUND` and `SPLITTER_ERROR` codes are imported from oracle.ts where they are already present elsewhere; double-import on lines 75 and 183 of oracle.ts (mid-file `import` after function declarations)
**File:** `sidecar/src/oracle.ts:74–75, 183–184`

The file has two mid-file `import` blocks. ES modules hoist these to the top, but it makes the file harder to read. Move all imports to the top.

### P2. `state.ts:36` — `_sessionParams` is a module-level mutable singleton with no `clearSession` integration
**File:** `sidecar/src/state.ts:36–44`

`clearSession()` (line 13) zeroes `currentSession` and `currentSchema` but leaves `_sessionParams` populated, including the password. After `workspace.close`, the password sits in memory until process exit. **Recommendation:** Clear `_sessionParams` in `clearSession()`. Better: never store the password at all; if you need to reconnect (you do — `query.cancel` → `break()` → reopen), have the caller re-supply it.

### P3. Naming — `RunningQuery` private to oracle.ts but accessor `_getRunning` is exported
**File:** `sidecar/src/oracle.ts:362–374`

The two test-only escape hatches (`_resetRunning`, `_getRunning`) are exported. Rename to `__test_*` and document they are not part of the public API. Better: use a vitest-only test helper that imports a non-exported reset.

### P4. `oracle.ts:80` — `isLostSessionError` does not catch ORA-12537 (TNS network reset) or ORA-12170 (TNS connect timeout)
**File:** `sidecar/src/oracle.ts:80–92`

If the TNS listener restarts, the user's session is dead but the error code is different from the listed five. Add ORA-12537, ORA-12170, ORA-12541 (no listener), DPI-1067 (closed for refresh).

### P5. `oracle.ts:996` — `tableCountRows` does no schema-vs-current-user check; counts whatever the user can see
**File:** `sidecar/src/oracle.ts:990–1002`

Documented behaviour, but the function name `tableCountRows` is ambiguous. If `p.owner` is `SYS` and the user has no SELECT on `SYS.AUD$`, the COUNT throws ORA-00942. The error reaches the frontend with no context. Wrap with a try/catch and return `{ count: null, reason: "no privilege" }` for prettier UX. POLISH only — current behaviour is correct, just unhelpful.

### P6. Comments — `oracle.ts:443–449` — long comment explaining a thin-mode quirk is accurate but repeated near both call-sites
**File:** `sidecar/src/oracle.ts:443–449, 460–464`

The same workaround is documented twice. Consolidate into one TSDoc on `executeSingleStatement`.

### P7. `ai.ts:91` — regex DOES NOT match the keyword `EXEC ` (with trailing space) reliably; word boundary `\b` only matches before `\w`
**File:** `sidecar/src/ai.ts:91`

`\bEXEC\b` matches `EXEC` followed by a non-word char — that includes whitespace, so it's actually OK. Sanity-check covered. POLISH only.

### P8. `index.ts:33` — long import line, hard to maintain
**File:** `sidecar/src/index.ts:4–51`

Twenty-plus named imports from `./oracle`. Split into logical groups (sessions, metadata, vector, embeddings, exec) or use `import * as oracle`.

### P9. `oracle.ts:417` — `DBMS_OUTPUT.GET_LINE` with `maxSize: 32767` is right at the SQL CHAR limit; also calls `BEGIN ... END` per line
**File:** `sidecar/src/oracle.ts:417–423`

Per-line round-trip is slow. Use `DBMS_OUTPUT.GET_LINES(:lines, :numlines)` to fetch in batches. Performance only — current impl works.

### P10. `oracle.ts:711` — `IN (${upstreamPlaceholders})` builds bind names dynamically; while safe (the names come from a fixed list of types), the placeholder math could be a `case when` instead, safer
**File:** `sidecar/src/oracle.ts:699–717`

Code is safe. But the construction `:t0, :t1` from a fixed string array could be replaced by hard-coded SQL with two binds, since `upstreamTypes` only ever has 1 or 2 values.

### P11. Dead-code-ish — `aiChat` system prompt mentions cyberpunk sheep mascot; reasonable for the brand but worth confirming
**File:** `sidecar/src/ai.ts:138`

No issue; flagged as "make sure marketing approves before releasing public source".

### P12. `errors.ts` — `QUERY_CANCELLED = -2` is intentionally outside the JSON-RPC reserved range, but the comment doesn't mention that other code paths might also pick low integers
**File:** `sidecar/src/errors.ts:10–12`

Document that any new code in `-2..-31999` range must coordinate with `errors.ts` to avoid collisions.

---

## Files reviewed
- C:\Users\geefa\Documents\veesker\sidecar\src\index.ts (152 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\rpc.ts (44 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\handlers.ts (33 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\errors.ts (21 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\state.ts (44 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\oracle.ts (1595 LOC)
- C:\Users\geefa\Documents\veesker\sidecar\src\ai.ts (315 LOC)

## Verdict
BLOCKERS FOUND: 5
