# 🛠️ REMEDIATION PLAN — VEESKER SECURITY AUDIT (Oracle 23ai Module) — v3

**Audit reference:** `SECURITY_AUDIT_VEESKER_ORACLE.md` (16 findings: 0 Critical · 4 High · 4 Medium · 6 Low · 2 Info, plus 9 out-of-scope observations)
**Date:** 2026-04-30
**Owner:** Geraldo (solo)
**Goal:** make Veesker safe for production customer data with **same defensibility as DBeaver EE / RedisInsight Cloud / Snowflake Snowsight**.
**Target completion:** Batch 1 today; Batch 2 in 7d; Batch 3 in 10d; Batch 4 in 14d; Batch 5 = roadmap.

---

## Why this plan exists in this shape

**The honest question** that drove this rewrite: *"Are my customers' production data at risk using Veesker?"*

The answer depends entirely on what mode they use:

| Mode | Risk level | Industry comparison |
|------|-----------|---------------------|
| **CE (no cloud)** | ❌ Not at risk | Same as PL/SQL Developer / DBeaver CE / pgAdmin (local-first) |
| **CL today (cloud features ON)** | ⚠️ Standard SaaS DB-tool risk | Same as DBeaver EE / RedisInsight Cloud BEFORE they shipped per-feature opt-in |
| **CL after Batch 3** | ❌ Not at risk (above CE level) | Same defensibility as DBeaver EE / RedisInsight Cloud / Snowflake Snowsight today |

The audit revealed **two distinct concerns**:
1. **Code-level vulnerabilities** (16 findings) — fixed in Batches 1, 2, 4
2. **Architectural posture** — cloud features default-ON when they should be default-OFF in production. This is what Batch 3 fixes.

The remaining items (Batch 5) are **above industry standard** — they go beyond what competitors ship today. Worth doing eventually, not blockers for "production-safe."

---

## Role

You are a **Senior Security Engineer + Staff Backend Engineer** with deep expertise in:
- TypeScript / Hono / Bun backend hardening
- Rust / Tauri 2 desktop app security
- Svelte 5 frontend security
- Oracle 23ai security model (roles, privileges, network ACLs)
- Cryptography (JWT, secrets management, key rotation)
- Defense-in-depth architecture (client + server enforcement layers)
- Multi-repo coordination and incremental rollouts
- **Industry-standard SaaS DB-tool security posture** (DBeaver EE, RedisInsight, Snowsight, Datagrip)

Your job: fix every finding from the audit report AND match industry-standard production-safe posture, in **five sequential batches**, while preserving existing behavior for legitimate users.

Every fix must be:
- **Idempotent** (re-runnable against partially-applied state)
- **Backwards-compatible** where possible (or migration documented + rollback path)
- **Tested** (unit test added or modified — positive case for legitimate path AND negative case for attack scenario)
- **Logged** (security-relevant events emitted to existing logger; do NOT print credentials)
- **Reviewed against the original threat model** — fix must close the attack scenario from the audit, not just the literal code line
- **Observable** (a metric or counter exists for security-relevant rejections)

---

## Critical Context

This is a multi-tenant SaaS that brokers Oracle credentials for client production databases. **A regression here can leak production DB passwords across tenants.** Treat every change as if it ships to a Portuguese enterprise customer next week, because it does.

The audit report is the authoritative finding list. **Do not re-audit. Do not add new findings during this pass.** If you spot something critical mid-remediation, log it in `REMEDIATION_NOTES.md` (per repo) for a later round and keep going.

---

## Two-Repo Coordination

Fixes span TWO separate git repositories. Work happens in parallel branches with the **same name** in each repo:

| Repo | Path | Branch | What lives here |
|------|------|--------|-----------------|
| **CL** (desktop) | `C:\Users\geefa\Documents\veesker-cloud-edition` | `security/audit-2026-04-30-remediation` | CSP, host validation, audit redaction (client-side), CloudAuditService 429 handling, wallet path validation, eprintln cleanup, **production-mode gates (PROD-001, PROD-002)** |
| **Server** | `C:\Users\geefa\Documents\veesker-cloud` | `security/audit-2026-04-30-remediation` | JWT_SECRET guard, magic link consume-on-poll, audit Zod schema + redaction (server-side) + rate limit, CORS allowlist, /v1/health hasJwtSecret removal, **audit metadata-only mode (PROD-002)** |

**Merge order:** server first (more defensive), desktop after (consumes the new server contracts).

**Coordination rule:** any contract change between server and client (e.g., adding `nonce` to magic link, or `metadataOnly` flag in audit) must land on `main` of the server **before** the desktop branch merges. Otherwise we ship a desktop that breaks against unupdated server.

Use the same `REMEDIATION_NOTES.md` filename in **each** repo, scoped to that repo's changes only. Cross-reference findings that span both repos.

---

## Batch Map (high-level)

```
Batch 1 (TODAY)          → Hotfix: CRITICAL-001 (JWT_SECRET) + CRITICAL-002 (magic link)
Batch 2 (within 7 days)  → Audit Main: HIGHs + MEDIUMs from audit
Batch 3 (within 10 days) → Production Parity: PROD-001 (AI off in prod) + PROD-002 (audit metadata-only) + TERMS_OF_USE
Batch 4 (within 14 days) → Hardening: LOWs + in-scope out-of-scope items
Batch 5 (roadmap)        → Above-Industry-Standard: PROD-003..006 (multi-sig, SBOM, hash host, DDL modal)
```

After Batch 3 lands, the answer to *"are customer production data at risk?"* becomes:
**NO** — with the same defensibility statement DBeaver EE and RedisInsight Cloud use to their customers today.

---

## Severity Reclassification (release blockers)

The following findings are **promoted to CRITICAL** for this remediation pass and must be fixed first, in this order:

1. **HIGH-004 → CRITICAL-001** (JWT_SECRET fallback). Even though `JWT_SECRET` is currently set on Railway, the fallback path in code remains. A future Railway env reset, a new staging environment, or a self-hosted deployment by a customer all re-expose this. Server must refuse to start in production without a real secret. **Production exploitation: blocked today; code path still unsafe.**

2. **MEDIUM-003 → CRITICAL-002** (Magic link polling JWT replay). The poll endpoint returns JWT on every call until session expiry, no IP binding, no consume-on-read. Combined with `cors origin: "*"` (LOW-006), this is account-takeover-by-leaked-sessionId. Must be consume-on-first-read + nonce-bound + IP-bound (with mobile-network exception strategy).

These two ship in **Batch 1** as a hotfix, isolated from the rest. Branch is not ready for any merge review until both are green and verified against the Appendix C payloads.

---

## Phase 0 — Pre-flight (do once, before any code change)

1. **Snapshot production state**:
   - Document Railway env vars present (don't capture values — just names)
   - Count of `magic_link_sessions` rows by status (`pending`, `authenticated`, `expired`)
   - Count of `audit_entries` rows total + by org (informs migration impact)
   - List active customers (if any beyond Geraldo himself)
2. **Verify dependencies**:
   - Confirm Bun version on Railway matches local
   - Confirm Postgres version (for migration syntax compatibility)
   - Run `cargo audit` and `bun audit` baseline; record any pre-existing CVEs
3. **Create branches** in both repos: `security/audit-2026-04-30-remediation`
4. **Create `REMEDIATION_NOTES.md`** in each repo's root with this template:

```markdown
# Remediation Notes — Audit 2026-04-30

## Tracker

| ID | Status | Repo+Commit | Test File | Verification | Notes |
|----|--------|-------------|-----------|--------------|-------|
| CRITICAL-001 | 🟡 In progress | - | - | - | - |
...

## Decision Log
(Deviations from plan with reasoning)

## Open Items / Punted
(Anything moved to a future round)

## Operator Runbook
(Env vars, migration steps, rotation procedure)

## Rollback Plan (per finding)
(How to revert each commit if it breaks production)
```

5. **Read `SECURITY_AUDIT_VEESKER_ORACLE.md` end to end** before touching code.

---

# Batch 1 — Hotfix (TODAY)

**Scope:** CRITICAL-001 + CRITICAL-002 only.
**Why isolated:** these are fast, focused, and unblock everything else. Rollback is cheap.

## CRITICAL-001 — JWT_SECRET refuse-boot guard

**File:** `veesker-cloud/server/src/auth/jwt.ts`

```ts
const DEV_FALLBACK = "dev-secret-do-not-use-in-prod-please-set-JWT_SECRET";
const rawSecret = process.env.JWT_SECRET;

if (!rawSecret || rawSecret.length < 32 || rawSecret === DEV_FALLBACK) {
  if (process.env.NODE_ENV === "production") {
    console.error("[fatal] JWT_SECRET must be set (>=32 chars, not the dev fallback) in production. Refusing to start.");
    process.exit(1);
  }
  console.warn("[jwt] Using DEV fallback secret. NEVER use this in production.");
}

const SECRET = new TextEncoder().encode(rawSecret ?? DEV_FALLBACK);
```

**Why these specific checks:**
- `length < 32`: anything shorter is brute-forceable for HS256
- `=== DEV_FALLBACK`: belt-and-suspenders if someone pastes the fallback into env intentionally
- `process.exit(1)` not `throw`: ensures Railway sees a clean exit, doesn't restart loop

**Files also updated:** remove `hasJwtSecret` and `hasDatabaseUrl` from public `/v1/health` (`index.ts:32-57` and `routes/health.ts:18-29`). If ops needs them, add an authenticated `/v1/admin/health` later.

**Tests:** `auth/jwt.test.ts`:
- exits with non-zero in production without JWT_SECRET
- warns but works in development without JWT_SECRET
- rejects 16-char secret in production
- rejects DEV_FALLBACK string verbatim in production

**Migration:** none — env var already set on Railway.
**Rollback:** revert commit. No state changes.
**Observability:** one-time startup log line `[jwt] secret length=64 configured=true` (no value).

**Documentation:** in `REMEDIATION_NOTES.md` operator runbook section, add JWT rotation procedure:

```
JWT Rotation:
1. Generate new secret: openssl rand -hex 32
2. Set new value in Railway env: JWT_SECRET=<new-value>
3. Redeploy: rolling restart drops in-flight tokens
4. All active users see "session expired" → re-magic-link login (~30s downtime)
5. Frequency: rotate quarterly OR on any compromise indicator
6. Avoid rotating during a billing cycle (Stripe webhooks may need stable session)
```

---

## CRITICAL-002 — Magic link consume-on-poll + nonce + IP

### Migration

**File:** `veesker-cloud/server/migrations/<next>__magic_link_hardening.sql`

```sql
-- Step 1: add nullable columns; backfill safe defaults.
ALTER TABLE magic_link_sessions
  ADD COLUMN consumed_at TIMESTAMPTZ,
  ADD COLUMN creator_ip INET,
  ADD COLUMN nonce TEXT;

-- Step 2: expire all in-flight 'pending' and 'authenticated' sessions that
-- predate this migration. Pre-existing rows have no nonce → can't validate.
UPDATE magic_link_sessions
   SET status = 'expired', consumed_at = NOW()
 WHERE status IN ('pending', 'authenticated')
   AND nonce IS NULL;

-- Step 3: enforce nonce required on active rows via CHECK constraint.
ALTER TABLE magic_link_sessions
  ADD CONSTRAINT magic_link_nonce_required_for_active
  CHECK (status = 'expired' OR nonce IS NOT NULL);

-- Step 4: index for IP-based queries.
CREATE INDEX IF NOT EXISTS magic_link_creator_ip_idx
  ON magic_link_sessions (creator_ip)
  WHERE creator_ip IS NOT NULL;
```

### Server changes

**File:** `veesker-cloud/server/src/routes/auth.ts`

Update `magic-link/send` schema:
```ts
const NonceSchema = z.string().regex(/^[a-zA-Z0-9_-]{43}$/); // base64url 32 bytes
const SendSchema = z.object({
  email: z.string().email(),
  session_id: z.string().uuid(),
  nonce: NonceSchema,
});
```

Capture `creator_ip` from `x-forwarded-for`/`x-real-ip` headers, store with session.

Replace `/poll/:session_id` handler with atomic consume-on-first-read:

```ts
authRoute.get("/poll/:session_id", async (c) => {
  const sessionId = c.req.param("session_id");
  const nonce = c.req.query("nonce");
  if (!nonce) return c.json({ error: "not_found" }, 404);

  const callerIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
                ?? c.req.header("x-real-ip")
                ?? "unknown";

  const result = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT status, jwt, features, expires_at, nonce, creator_ip, consumed_at
      FROM magic_link_sessions
      WHERE session_id = ${sessionId}
      FOR UPDATE
    `;
    if (rows.length === 0) return { status: 404 };
    const r = rows[0];

    // Defensive: any failure returns 404 to avoid leaking session existence.
    if (r.nonce !== nonce) return { status: 404 };
    if (r.creator_ip && r.creator_ip !== callerIp) {
      console.warn(`[magic-link] IP mismatch session=${sessionId} created=${r.creator_ip} polled=${callerIp}`);
      return { status: 404 };
    }
    if (r.consumed_at) return { status: 404 };

    if (r.status === "pending" && new Date(r.expires_at) < new Date()) {
      await tx`UPDATE magic_link_sessions SET status = 'expired' WHERE session_id = ${sessionId}`;
      return { status: 200, body: { status: "expired" } };
    }

    if (r.status === "authenticated") {
      await tx`UPDATE magic_link_sessions SET consumed_at = NOW() WHERE session_id = ${sessionId}`;
      return { status: 200, body: { status: "authenticated", token: r.jwt, features: r.features } };
    }

    return { status: 200, body: { status: r.status } };
  });

  if (result.status === 404) return c.json({ error: "not_found" }, 404);
  return c.json(result.body);
});
```

**Why `FOR UPDATE` + transaction:** prevents race condition where two concurrent polls both see `consumed_at IS NULL` and both return JWT. Row lock serializes them.

**IP mismatch known false-positives:** mobile networks (cellular handoff, WiFi-to-LTE), corporate CGNAT, VPN connect/disconnect. Decision: strict IP match for v1. Track in `REMEDIATION_NOTES.md` as known limitation. Most magic-link flows complete in < 2 min — IP rarely changes that fast.

### Desktop changes

**File:** `veesker-cloud-edition/src/lib/workspace/LoginModal.svelte`

```svelte
<script lang="ts">
  function generateNonce(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function sendLink() {
    if (!email.trim()) return;
    const sessionId = crypto.randomUUID();
    const nonce = generateNonce();
    try {
      const res = await fetch("https://api.veesker.cloud/v1/auth/magic-link/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), session_id: sessionId, nonce }),
      });
      if (!res.ok) throw new Error("send_failed");
      authState = "waiting";
      startPoll(sessionId, nonce); // ← pass nonce
    } catch { /* ... */ }
  }

  async function startPoll(sessionId: string, nonce: string) {
    // ...
    const res = await fetch(
      `https://api.veesker.cloud/v1/auth/poll/${sessionId}?nonce=${encodeURIComponent(nonce)}`
    );
    // ...
  }
</script>
```

**Critical invariant:** the nonce **never** leaves the desktop process. Generated client-side, sent in `/send`, sent in `/poll` as query param. The browser/email link does **not** carry it. Even if attacker captures the email URL, they don't have the nonce, so polling fails.

### Tests

Server:
- `it("rejects poll without nonce")` → 404
- `it("rejects poll with wrong nonce")` → 404
- `it("returns JWT on first authenticated poll, 404 on second")`
- `it("rejects poll from different IP")` → 404 with log
- `it("two concurrent polls — exactly one returns JWT")` (race condition test)
- `it("rejects expired session even with valid nonce")` → 200 status:expired

Desktop:
- `it("generates 32-byte nonce, includes in send and poll requests")`

### Deploy + Rollback

**Migration deploy steps:**
1. Run migration: `bun run migrate` on Railway
2. Existing pending/authenticated sessions become `expired`
3. Affected users see "Link expired. Please try again." → re-magic-link works
4. Acceptable customer impact: anyone mid-flow re-clicks email

**Rollback:** revert server commit + run reverse migration (drop columns). No data loss but in-flight sessions invalidated again.

**Success criteria for Batch 1:**
- [ ] `curl https://api.veesker.cloud/v1/health` does NOT include `hasJwtSecret`
- [ ] Server refuses to boot with NODE_ENV=production and no JWT_SECRET (verified locally)
- [ ] Replay poll after consume → 404
- [ ] Race-condition test passes
- [ ] Manual smoke test: full magic-link flow works for legitimate user
- [ ] All test suites green

---

# Batch 2 — Audit Main (within 7 days)

**Scope:** HIGH-001, HIGH-002, HIGH-003, MEDIUM-001 (regex layer only — Layer 1 punted to roadmap), MEDIUM-002, MEDIUM-004.

**Sequencing:**
- Server: HIGH-003 (rate limit + Zod max), HIGH-001 server-side redaction
- Desktop: HIGH-001 client-side redaction, HIGH-002 host/serviceName validation, MEDIUM-001 regex hardening, MEDIUM-002 wallet path, MEDIUM-004 CSP

**Deploy order:** server first, desktop second.

## HIGH-001 — Audit SQL redaction

### Shared regex set (single source of truth)

Create `veesker-cloud/server/src/lib/redact-sql.ts` and **copy verbatim** to `veesker-cloud-edition/src/lib/services/redactSql.ts`. Comment in both files: `// SOURCE OF TRUTH: veesker-cloud/server/src/lib/redact-sql.ts. Sync changes.`

```ts
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/IDENTIFIED\s+BY\s+VALUES\s+(['"])([^'"]+)\1/gi, "IDENTIFIED BY VALUES '***REDACTED***'"],
  [/IDENTIFIED\s+BY\s+(['"])([^'"]+)\1/gi, "IDENTIFIED BY '***REDACTED***'"],
  [/IDENTIFIED\s+BY\s+([^\s;,)]+)/gi, "IDENTIFIED BY ***REDACTED***"],
  [/IDENTIFIED\s+GLOBALLY\s+AS\s+(['"])([^'"]+)\1/gi, "IDENTIFIED GLOBALLY AS '***REDACTED***'"],
  [/\bPASSWORD\s+(['"])([^'"]+)\1/gi, "PASSWORD '***REDACTED***'"],
  [/BFILENAME\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*\)/gi, "BFILENAME('***REDACTED***', '***REDACTED***')"],
  [/USING\s+(['"])([^'"]+)\1/gi, "USING '***REDACTED***'"],
];

export function redactSql(sql: string): { redacted: string; matched: boolean } {
  let result = sql;
  let matched = false;
  for (const [re, replacement] of REDACTION_PATTERNS) {
    if (re.test(result)) {
      matched = true;
      result = result.replace(re, replacement);
    }
  }
  return { redacted: result, matched };
}
```

**Apply on client:** `CloudAuditService.ts:67`, redact `sql` before pushing to buffer. Increment local counter `redactionsThisSession` if matched.

**Apply on server:** `audit.ts:39-54`, redact each entry's `sql` before truncation, before INSERT. Add column `sql_redacted BOOLEAN NOT NULL DEFAULT FALSE` to `audit_entries`.

**Existing rows:** NOT retroactively redacted. Document in notes. Optional one-shot `scripts/redact-historical-audits.ts` for tenants who request it.

**Tests:** each pattern has 2 cases (simple match + edge case with escaped quotes). Negative case: `SELECT 'IDENTIFIED BY' FROM dual` (in literal) — current implementation **WILL over-redact**. Acceptable v1 limitation; v2 needs tokenizer-based redaction.

**Documentation:**
- `TERMS_OF_USE.md`: "Audit log SQL text is redacted client-side and server-side for known credential patterns. Redaction is best-effort — do not rely on it for compliance. Sensitive values should not be passed as SQL literals."
- UI tooltip in audit settings explaining redaction.

**Observability:** server metric `audit_sql_redacted_count`. Alert if redaction rate >5% of ingested entries (heavy credential SQL → outreach opportunity).

---

## HIGH-002 — Connection string injection

### Authoritative validation in Rust

**File:** `veesker-cloud-edition/src-tauri/src/persistence/connections.rs`

```rust
fn validate_host(host: &str) -> Result<(), ConnectionError> {
    if host.trim().is_empty() {
        return Err(ConnectionError::invalid("host is required"));
    }
    if host.len() > 253 {
        return Err(ConnectionError::invalid("host too long (max 253 chars)"));
    }
    let invalid_chars = ['(', ')', '?', '=', '/', '\\', ' ', '\t', '\n', '"', '\'', '@', '&'];
    if host.chars().any(|c| invalid_chars.contains(&c) || c.is_control()) {
        return Err(ConnectionError::invalid(
            "host contains invalid characters (allowed: letters, digits, hyphens, dots, colons, brackets for IPv6)"
        ));
    }
    Ok(())
}

fn validate_service_name(svc: &str) -> Result<(), ConnectionError> {
    if svc.trim().is_empty() {
        return Err(ConnectionError::invalid("service name is required"));
    }
    if svc.len() > 128 {
        return Err(ConnectionError::invalid("service name too long (max 128 chars)"));
    }
    if !svc.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') {
        return Err(ConnectionError::invalid(
            "service name contains invalid characters (allowed: letters, digits, underscore, dot, hyphen)"
        ));
    }
    Ok(())
}

fn validate_connect_alias(alias: &str) -> Result<(), ConnectionError> {
    if alias.trim().is_empty() {
        return Err(ConnectionError::invalid("connect alias is required"));
    }
    if alias.len() > 128 {
        return Err(ConnectionError::invalid("connect alias too long"));
    }
    if !alias.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') {
        return Err(ConnectionError::invalid("connect alias contains invalid characters"));
    }
    Ok(())
}
```

Wire into `ConnectionService::save` for both Basic and Wallet variants.

**IPv6 handling:** accept `:` and `[]`. Both `[::1]:1521/SVC` (bracketed) and `::1:1521/SVC` (unbracketed) work. Reject zone identifiers (`fe80::1%eth0`).

### Mirror validation in sidecar

**File:** `veesker-cloud-edition/sidecar/src/oracle.ts` — add `validateConnectionParams` helper at top of `connectionTest` and `buildConnection`.

### Pre-emptive form validation

**File:** `veesker-cloud-edition/src/lib/ConnectionForm.svelte` — add `pattern` attribute and `$derived` validation message.

**Tests:** each Appendix C payload rejected at Rust layer; sidecar layer rejects same; integration test end-to-end save → 400.

**Backwards compat:** existing valid connections unaffected — Oracle would have rejected anything not matching these character classes anyway.

---

## HIGH-003 — Audit ingest rate limiting

### Zod tightening

**File:** `veesker-cloud/server/src/routes/audit.ts:14`

```ts
const AuditEntry = z.object({
  occurredAt: z.string().datetime(),
  connectionId: z.string().uuid().nullable(),
  connectionName: z.string().max(256).nullable(),
  host: z.string().max(256).nullable(),
  sql: z.string().min(1).max(64 * 1024),  // ← parse-time max
  success: z.boolean(),
  rowCount: z.number().int().nullable(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  errorCode: z.number().int().nullable(),
  errorMessage: z.string().max(8 * 1024).nullable(),
  clientVersion: z.string().max(64).nullable().optional(),
});
```

### In-memory rate limiter

**File:** `veesker-cloud/server/src/middleware/rate-limit.ts` (new)

```ts
import type { Context, Next } from "hono";

const BUCKETS = new Map<string, { tokens: number; lastRefill: number }>();
const CAPACITY = 100;
const REFILL_PER_MIN = 100;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of BUCKETS) {
    if (now - b.lastRefill > SWEEP_INTERVAL_MS) BUCKETS.delete(k);
  }
}, SWEEP_INTERVAL_MS);

export function rateLimit(c: Context, next: Next) {
  const user = c.get("user");
  const key = `${user.org}:${user.sub}`;
  const now = Date.now();
  const b = BUCKETS.get(key) ?? { tokens: CAPACITY, lastRefill: now };
  const minutesSinceRefill = (now - b.lastRefill) / 60_000;
  b.tokens = Math.min(CAPACITY, b.tokens + minutesSinceRefill * REFILL_PER_MIN);
  b.lastRefill = now;

  if (b.tokens < 1) {
    const retryAfter = Math.ceil((1 - b.tokens) / (REFILL_PER_MIN / 60));
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limit_exceeded", retryAfterSec: retryAfter }, 429);
  }

  b.tokens -= 1;
  BUCKETS.set(key, b);
  return next();
}
```

Apply only on `audit.ts` POST handler. Single-tier for now. Note in `REMEDIATION_NOTES.md`: scaling beyond single instance needs Redis backend (roadmap).

### Desktop 429 handling

**File:** `veesker-cloud-edition/src/lib/services/CloudAuditService.ts:41`

Add jittered backoff on 429:
```ts
if (msg.includes("server_error_429")) {
  const jitter = 30_000 + Math.random() * 30_000;
  console.warn(`[audit] rate limited, backing off ${Math.round(jitter / 1000)}s`);
  setTimeout(() => { /* next flush picks up */ }, jitter);
}
```

**Tests:** load test 200 concurrent batches → first 100 OK, rest 429 with `Retry-After`. Bucket refills correctly. Desktop 429 doesn't cause retry storm.

---

## MEDIUM-001 — AI tool regex hardening (Layer 2 only)

**Layer 1 (Oracle-side role)** — punted to Batch 5 / roadmap. Documented as feature: "AI read-only credential" field in connection settings.
**Layer 3 (parser)** — punted. `node-sql-parser` Oracle dialect incomplete; ROI not worth integration cost.
**Layer 2 (regex):**

**File:** `veesker-cloud-edition/sidecar/src/ai.ts:85-97`

Replace with state-machine that strips strings/comments before keyword check:

```ts
function stripStringsAndComments(sql: string): string {
  let result = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      result += "''";
      continue;
    }
    if ((c === "q" || c === "Q") && next === "'" && sql[i + 2]) {
      const open = sql[i + 2];
      const close = ({ "[": "]", "(": ")", "{": "}", "<": ">" } as const)[open as "["] ?? open;
      i += 3;
      while (i < sql.length - 1) {
        if (sql[i] === close && sql[i + 1] === "'") { i += 2; break; }
        i++;
      }
      result += "''";
      continue;
    }
    if (c === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      result += '""';
      continue;
    }
    result += c;
    i++;
  }
  return result;
}

const DANGEROUS_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "DROP", "ALTER", "TRUNCATE",
  "RENAME", "GRANT", "REVOKE", "EXECUTE", "EXEC", "CALL", "BEGIN", "DECLARE",
  "COMMIT", "ROLLBACK", "UPSERT", "REPLACE", "LOCK", "SET",
  "UTL_HTTP", "UTL_TCP", "UTL_SMTP", "UTL_FILE", "UTL_INADDR",
  "DBMS_LOCK", "DBMS_HTTP", "DBMS_LDAP", "DBMS_SCHEDULER",
  "DBMS_AQ", "DBMS_PIPE", "DBMS_FLASHBACK", "DBMS_OUTPUT",
];
const DANGEROUS_RE = new RegExp(`\\b(${DANGEROUS_KEYWORDS.join("|")})\\b`, "i");
const FOR_UPDATE_RE = /\bFOR\s+UPDATE\b/i;

export function isReadOnlySql(raw: string): boolean {
  const stripped = stripStringsAndComments(raw).replace(/\s+/g, " ").trim();
  const first = /^(\w+)/i.exec(stripped)?.[1]?.toUpperCase();
  if (first !== "SELECT" && first !== "WITH") return false;
  if (DANGEROUS_RE.test(stripped)) return false;
  if (FOR_UPDATE_RE.test(stripped)) return false;
  return true;
}
```

**Documentation:** code comment at top of function:
```ts
// SECURITY: This is the AI tool's last-resort gate. The primary defense should
// be a dedicated read-only Oracle role (see roadmap PROD-006/AI-RO-CRED).
// When that ships, this becomes belt-and-suspenders.
```

**Tests:** each bypass payload rejected (UTL_HTTP, DBMS_LOCK, FOR UPDATE, autonomous-tx fn calls). Each false-positive query passes: `SELECT * FROM tickets WHERE message LIKE '%insert into%'`, `SELECT q'[INSERT]' FROM dual`, etc. Edge cases: nested q-quotes, escaped quotes, comments containing keywords.

---

## MEDIUM-002 — connection_test wallet path validation

**File:** `veesker-cloud-edition/src-tauri/src/commands.rs:51-76`

```rust
fn config_to_params(app: &AppHandle, config: ConnectionConfig) -> Result<Value, ConnectionError> {
    use crate::persistence::connection_config::{basic_params, wallet_params};
    use std::path::Path;
    match config {
        ConnectionConfig::Basic { host, port, service_name, username, password } => {
            super::persistence::connections::validate_host(&host)?;
            super::persistence::connections::validate_service_name(&service_name)?;
            Ok(basic_params(&host, port, &service_name, &username, &password))
        }
        ConnectionConfig::Wallet { wallet_dir, wallet_password, connect_alias, username, password } => {
            let canon = validate_user_path(app, &wallet_dir)?;
            super::persistence::connections::validate_connect_alias(&connect_alias)?;
            Ok(wallet_params(&canon, &wallet_password, &connect_alias, &username, &password))
        }
    }
}
```

Update `connection_test` to pass `app` and propagate error.

**Tests (platform-conditional):**
```rust
#[cfg(windows)]
#[test]
fn connection_test_rejects_unc_wallet_dir() { /* "\\\\evil\\share" rejected */ }

#[cfg(unix)]
#[test]
fn connection_test_rejects_etc_wallet_dir() { /* "/etc/oracle/wallet" rejected */ }
```

---

## MEDIUM-004 — CSP hardening

**File:** `veesker-cloud-edition/src-tauri/tauri.conf.json:23`

```jsonc
"csp": "default-src 'self' asset: https://asset.localhost; \
  script-src 'self'; \
  style-src 'self' https://fonts.googleapis.com; \
  font-src 'self' https://fonts.gstatic.com data:; \
  img-src 'self' data: asset: https://asset.localhost blob:; \
  connect-src ipc: http://ipc.localhost https://api.veesker.cloud; \
  frame-src 'none'; \
  frame-ancestors 'none'; \
  base-uri 'self'; \
  form-action 'self'; \
  object-src 'none'"
```

Changes:
- Removed `'unsafe-inline'` from `style-src`
- Removed `http://localhost:1420` from `connect-src`
- Removed `https://api.anthropic.com` (sidecar makes the call, not WebView)
- Added `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`

**Svelte audit required:** before removing `'unsafe-inline'`, audit every `.svelte` file for inline `style="..."` with dynamic interpolation. Replace with class bindings or CSS variables.

**Test:** run app, open every panel, no CSP violations in console. Try injecting `<style>body{background:url(//evil/leak)}</style>` via DevTools → CSP must block.

**Success criteria for Batch 2:**
- [ ] Audit redaction validated end-to-end
- [ ] Connection string injection blocked at Rust layer
- [ ] Rate limiter validated under load
- [ ] AI regex passes new bypass + false-positive tests
- [ ] Wallet path UNC/etc rejection verified
- [ ] CSP audit complete; no console violations during full app walkthrough
- [ ] All test suites green

---

# Batch 3 — Production Parity (within 10 days)

**Scope:** PROD-001 (AI off in prod) + PROD-002 (audit metadata-only in prod) + TERMS_OF_USE update.

**Why this batch exists:** the audit's HIGH-001 fix (redaction) only covers credentials. It does NOT cover PII/PHI/PCI in normal SELECT/INSERT queries. Industry-standard SaaS DB tools (DBeaver EE, RedisInsight Cloud, Snowsight) handle this by **defaulting cloud features OFF for production** — Veesker today defaults them ON when licensed.

After this batch, the answer to *"are customer production data at risk?"* becomes the same NO that DBeaver EE / RedisInsight Cloud give their customers today.

**Sequencing:**
- Server: PROD-002 (audit metadata-only mode contract)
- Desktop: PROD-001 (AI gate in prod), PROD-002 (UI controls), TERMS_OF_USE updates

## PROD-001 — AI tool off-by-default in production-tagged connections

**File:** `veesker-cloud-edition/src/lib/workspace/SheepChat.svelte` (and any AI entry points)

Add a per-session AI gate when `connection.env === 'prod'`:

```svelte
<script lang="ts">
  import { getActiveConnection } from "$lib/stores/connection.svelte";
  
  let aiUnlockedThisSession = $state(false);
  
  const isProd = $derived(getActiveConnection()?.safety?.env === "prod");
  const aiAllowed = $derived(!isProd || aiUnlockedThisSession);
  
  async function unlockAiForProd() {
    const ack = confirm(
      "⚠️ This connection is tagged PRODUCTION.\n\n" +
      "AI tools may read any data your Oracle user has access to and " +
      "send it to Anthropic's API for processing.\n\n" +
      "Anthropic's data handling policy: https://www.anthropic.com/legal/aup\n\n" +
      "Type the connection name to confirm AI access for this session:"
    );
    if (!ack) return;
    
    const typed = prompt(`Type "${getActiveConnection()?.name}" to enable AI:`);
    if (typed === getActiveConnection()?.name) {
      aiUnlockedThisSession = true;
    }
  }
</script>

{#if !aiAllowed}
  <div class="prod-ai-gate">
    <h3>🔒 AI disabled for production connections</h3>
    <p>This connection is tagged <code>prod</code>. AI features require explicit unlock per session.</p>
    <button class="warn" onclick={unlockAiForProd}>Unlock AI for this session</button>
  </div>
{:else}
  <!-- existing AI chat UI -->
{/if}
```

**Same gate** applied at sidecar level (defense in depth):

**File:** `veesker-cloud-edition/sidecar/src/ai.ts`

```ts
import { getSessionSafety } from "./state";

export async function aiChat(params: AiChatParams, tools: boolean = false): Promise<AiChatResult> {
  const safety = getSessionSafety();
  if (safety.env === "prod" && !params.acknowledgeProdAi) {
    throw {
      code: -32604,
      message: "AI tools require per-session production acknowledgment. Unlock via the chat panel.",
    };
  }
  // ... rest of existing implementation
}
```

Frontend passes `acknowledgeProdAi: true` only after the per-session unlock. The acknowledgment **does not persist** across restarts — every new session in a prod-tagged connection requires re-unlock.

**Tests:**
- AI call fails when `env=prod` and no acknowledgment
- AI call succeeds with acknowledgment
- Acknowledgment doesn't persist across `closeSession`/`openSession` cycles
- Non-prod connections behave unchanged

**Documentation:** add section to `TERMS_OF_USE.md` under "AI Features":
```
When using AI features, your active SQL and (with tools enabled) query results
are sent to Anthropic for processing. For connections tagged "production", AI
features are disabled by default and require explicit per-session unlock.

Anthropic's data handling: https://www.anthropic.com/legal/aup
Veesker does not store AI prompts or responses on its servers.
```

## PROD-002 — Audit metadata-only mode in production

**File:** `veesker-cloud-edition/src/lib/services/CloudAuditService.ts`

Add a metadata-only mode that strips the SQL text entirely for prod connections, sending only structural metadata:

```ts
type CloudEntry = {
  occurredAt: string;
  connectionId: string | null;
  connectionName: string | null;
  host: string | null;          // ← still sent (will be hashed in PROD-005, Batch 5)
  sqlMode: "full" | "metadata-only";  // ← new
  sql: string | null;           // ← null when metadata-only
  sqlKind: string | null;       // ← new: "SELECT" | "INSERT" | "UPDATE" | etc.
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
  clientVersion: string | null;
};

import { classifySqlKind } from "./sql-classifier"; // new helper, light wrapper over existing classifier

export const CloudAuditService = {
  async push(entry: { /* same as before */ }, context: { isProd: boolean }): Promise<void> {
    if (!FEATURES.cloudAudit) return;
    const clientVersion = await resolveClientVersion();
    
    const sqlMode = context.isProd ? "metadata-only" : "full";
    const sqlKind = classifySqlKind(entry.sql); // "SELECT", "INSERT", "DML", "DDL", etc.
    const sqlText = sqlMode === "full" ? redactSql(entry.sql).redacted : null;
    
    _buffer.push({
      occurredAt: new Date().toISOString(),
      connectionId: entry.connectionId || null,
      connectionName: entry.connectionName || null,
      host: entry.host || null,
      sqlMode,
      sql: sqlText,
      sqlKind,
      success: entry.success,
      rowCount: entry.rowCount,
      elapsedMs: entry.elapsedMs,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
      clientVersion,
    });
    if (_buffer.length >= BATCH_SIZE) void flush();
  },
  // ... rest unchanged
};
```

Caller (in `SqlEditor.svelte` or wherever audit push happens) determines `isProd` from active connection and passes through.

**Server schema migration:**

```sql
-- Migration: <next>__audit_metadata_mode.sql
ALTER TABLE audit_entries
  ADD COLUMN sql_mode TEXT NOT NULL DEFAULT 'full' CHECK (sql_mode IN ('full', 'metadata-only')),
  ADD COLUMN sql_kind TEXT;

-- Make sql_text nullable to accommodate metadata-only entries.
ALTER TABLE audit_entries ALTER COLUMN sql_text DROP NOT NULL;
ALTER TABLE audit_entries ADD CONSTRAINT audit_sql_required_for_full
  CHECK (sql_mode = 'metadata-only' OR sql_text IS NOT NULL);

-- Existing rows are 'full' mode (default). No backfill needed.
```

**Server Zod schema update** (`audit.ts:14`):
```ts
const AuditEntry = z.object({
  // ... existing fields ...
  sqlMode: z.enum(["full", "metadata-only"]).default("full"),
  sql: z.string().min(1).max(64 * 1024).nullable(), // nullable now
  sqlKind: z.string().max(32).nullable().optional(),
}).refine(
  (e) => e.sqlMode === "metadata-only" || (e.sql !== null),
  { message: "sql is required when sqlMode is 'full'" }
);
```

**Server insert** (`audit.ts:43`):
```ts
await sql`
  INSERT INTO audit_entries (
    org_id, user_id, user_email, connection_id, connection_name, host,
    sql_text, sql_mode, sql_kind, sql_truncated, success, row_count, elapsed_ms,
    error_code, error_message, client_version, occurred_at
  ) VALUES (
    ${user.org}, ${user.sub}, ${user.email},
    ${e.connectionId}, ${e.connectionName}, ${e.host},
    ${sqlText}, ${e.sqlMode}, ${e.sqlKind ?? null}, ${truncated}, ${e.success}, ${e.rowCount}, ${e.elapsedMs},
    ${e.errorCode}, ${e.errorMessage}, ${e.clientVersion ?? null}, ${e.occurredAt}
  )
`;
```

**UI changes** in audit settings panel (CL):
```
Audit logging:
  ○ Off
  ● Metadata-only (recommended for production)
        Logs: timestamp, statement type, duration, row count.
        Does NOT log: full SQL text, query parameters.
  ○ Full SQL (with redaction)
        Logs: redacted SQL text (credentials masked, PII NOT masked).
        Use only for development/staging. Confirm queries don't contain PII.

Default for connections tagged "production": Metadata-only.
```

**Tests:**
- `cloudAudit` push for prod connection → server receives `sqlMode='metadata-only'`, `sql=null`
- `cloudAudit` push for dev connection → server receives `sqlMode='full'`, `sql=<redacted>`
- Server Zod rejects `sqlMode='full'` with `sql=null`
- Audit log query (admin/dba role) returns rows with both modes correctly

**Documentation update** (`TERMS_OF_USE.md`):
```
Cloud Audit Logging:

When enabled, Veesker uploads metadata about queries executed via the desktop
app to Veesker Cloud's secure audit log. Two modes are available:

1. **Metadata-only (default for production-tagged connections):**
   - Sent: timestamp, connection name, statement type (SELECT/DML/DDL),
     row count, duration, error codes
   - NOT sent: SQL text, query parameters, query results
   - Use case: compliance audit trail without data exposure

2. **Full SQL (default for non-production connections):**
   - Sent: redacted SQL text (credentials masked) + all metadata-only fields
   - NOT sent: query results
   - Caveat: PII/PHI/PCI in SQL literals is NOT redacted automatically.
     Use this mode only when you've reviewed your queries for sensitive data.

You can change the mode per-connection in the connection's audit settings.
Existing audit log entries are not retroactively redacted or downgraded.
```

**Success criteria for Batch 3:**
- [ ] AI gate active for prod connections (verified via UI)
- [ ] AI sidecar refuses without acknowledgment (verified via direct RPC call test)
- [ ] Audit metadata-only mode default for prod connections
- [ ] Audit metadata-only entries don't carry SQL text in DB
- [ ] UI clearly shows current audit mode per connection
- [ ] `TERMS_OF_USE.md` updated with both AI and audit disclosure
- [ ] All test suites green

**After this batch:** 
- Customer DBA can run Veesker on a `prod`-tagged connection without:
  - AI accidentally exfiltrating data to Anthropic (gate blocks)
  - Cloud audit accidentally uploading PII (metadata-only by default)
- The defensibility statement matches DBeaver EE / RedisInsight Cloud / Snowsight.

---

# Batch 4 — Hardening (within 14 days)

**Scope:** All 6 LOWs + in-scope out-of-scope items.

## LOW-001 — eprintln cleanup

**Note:** Rust side has neither `log` nor `tracing` crate. Don't add new deps just for 3 lines. Replace with `println!` + redact path component.

**File:** `veesker-cloud-edition/src-tauri/src/persistence/connections.rs:648, 654, 660`

```rust
if let Err(e) = secrets::delete_password(id) {
    println!("[connections] keychain delete failed for {id}: {e}");
}
if let Some(r) = row && r.auth_type == AuthType::Wallet {
    if let Err(e) = secrets::delete_wallet_password(id) {
        println!("[connections] wallet keychain delete failed for {id}: {e}");
    }
    let dir = self.wallet_dir(id);
    if dir.exists() && let Err(e) = std::fs::remove_dir_all(&dir) {
        let dir_name = dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "<unknown>".into());
        println!("[connections] wallet dir delete failed for {dir_name}: {e}");
    }
}
```

## LOW-002 — Cache Instant Client lib dir

Tauri host stores discovered libDir in app config at startup; passes to sidecar via env. Sidecar reads env, skips scan if set. Re-scan only on cache miss or version change.

## LOW-003 — Cross-platform log rotation

**File:** `veesker-cloud-edition/sidecar/src/logger.ts:42`

```ts
import { unlinkSync, existsSync } from "node:fs";

function rotate(path: string): void {
  try {
    const st = statSync(path);
    if (st.size > 5 * 1024 * 1024) {
      const old = path + ".old";
      if (existsSync(old)) {
        try { unlinkSync(old); } catch { /* ENOENT fine */ }
      }
      renameSync(path, old);
    }
  } catch { /* file doesn't exist yet — fine */ }
}
```

Test on Windows: rotate twice, second rotation must succeed.

## LOW-004, LOW-005 — Documentation only

LOW-004: comment in `auth.ts:27-31` pointing to server-side enforcement.
LOW-005: document SSL pinning decision in `REMEDIATION_NOTES.md`.

## LOW-006 — CORS allowlist

**File:** `veesker-cloud/server/src/index.ts:17-21`

```ts
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "https://veesker.cloud",
  "https://www.veesker.cloud",
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:1420"] : []),
]);

app.use("*", cors({
  origin: (origin) => ALLOWED_ORIGINS.has(origin) ? origin : null,
  allowHeaders: ["Authorization", "Content-Type", "X-Veesker-Org"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: false,
}));
```

**Test:** `curl -H "Origin: https://evil.com" .../v1/health` returns no `Access-Control-Allow-Origin`. Same with `https://veesker.cloud` returns it.

## In-scope out-of-scope items

| # | Item | Action |
|---|------|--------|
| 1 | git2 0.20 bump | `cargo update -p git2`, regression test on git push |
| 3 | tauri-plugin-fs scope | Tighten to `$APPDATA/com.veesker.app/**` for app data; wallet uploads via `tauri-plugin-dialog::open` (no broad fs:scope needed) |
| 6 | debug.* RPC methods | Add env-flag `VEESKER_DEBUG_ENABLED` (default false in production builds); all debug.* handlers refuse if unset |
| 8 | Oracle SYS_CONTEXT injection | Add explicit test asserting no string interpolation in any owner/type query handler (already parameterized — test makes it permanent) |

**Roadmap-only (do not implement in Batch 4):**
- 2: portable-pty escape sequence audit
- 4: updater multi-signer (see Batch 5 PROD-003)
- 5: rustls migration

**Success criteria for Batch 4:**
- [ ] All 6 LOWs addressed (or explicitly roadmapped with reason)
- [ ] CORS allowlist verified by cross-origin probe
- [ ] Log rotation verified on Windows (rotate-twice test)
- [ ] Instant Client cache verified (second startup faster)
- [ ] tauri-plugin-fs scope tightened; wallet upload still works
- [ ] All test suites green
- [ ] `cargo audit` and `bun audit` clean
- [ ] Final commit `chore(security): finalize audit-2026-04-30 remediation` per repo

---

# Batch 5 — Above-Industry-Standard (roadmap)

**Scope:** items that go beyond what DBeaver EE / RedisInsight Cloud / Snowsight ship today. Worth doing eventually; not blockers for "production-safe."

**Track these in `roadmap/security-hardening.md`** — separate doc, separate timeline, separate decision-making.

## PROD-003 — Updater multi-signer / signed-release pipeline

**Risk addressed:** single-key compromise of `C:\Users\geefa\veesker-updater.key` allows attacker to ship backdoored release.

**Approach options:**
- **MVP (lower effort):** GitHub Actions OIDC + branch protection + 2-person approval on `main`. Single signer remains, but social engineering / direct repo access blocked.
- **Full (higher effort):** dual-signer requirement — release valid only with two independent signatures. Requires coordinating second key holder.

**Why roadmap not Batch 4:** DBeaver, DBeaver EE, RedisInsight, pgAdmin all use single-signer release signing today. Veesker matches industry standard. Above-standard hardening is a future investment.

## PROD-004 — Sidecar SBOM + integrity verification

**Risk addressed:** supply chain attack on `oracledb` or transitive dep.

**Approach:**
- CI generates SBOM on every release (CycloneDX format)
- CI fails if any dep in credential-handling path has HIGH/CRITICAL CVE
- Lock `package.json` versions with `=` exact for `oracledb`
- Runtime check: sidecar validates `node_modules` matches `bun.lock` integrity hashes before loading oracledb
- Manual policy: no `oracledb` bump without changelog review

**Why roadmap:** competitors don't do this either. Standard practice is Dependabot + manual review.

## PROD-005 — Hash audit_entries.host

**Risk addressed:** insider with DB access maps customer's internal Oracle topology from audit log.

**Approach:**
- Hash `host` with SHA-256 + per-org salt before storing
- Useful for audit correlation (same host across queries) without revealing actual hostname
- Truncate `connection_name` if it contains words like "prod", "production", "live"
- Migration: backfill existing rows with hashed values; original hostnames are lost (acceptable)

**Why roadmap:** DBeaver EE doesn't do this. Above industry standard.

## PROD-006 — DDL via AI requires modal in prod

**Risk addressed:** AI tool tricked into running custom function with `PRAGMA AUTONOMOUS_TRANSACTION` that has destructive side effects.

**Approach:**
- When `connection.env === 'prod'` AND query references non-system function (i.e., not in whitelist of safe Oracle built-ins), require explicit confirmation modal
- Whitelist: DUAL, SYSDATE, ROWNUM, SYS_CONTEXT, USER, etc.
- Telemetry: count AI attempts to call custom functions in prod per org

**Why roadmap:** depends on PL/SQL parser integration (Layer 3 of MEDIUM-001), which is itself roadmapped.

---

## Constraints (apply to all batches)

### Don't list

- **Don't deploy to production from local.** Always via CI/Railway pipeline.
- **Don't bypass code review** — even self-review with a full re-read of the diff one hour after writing it counts.
- **Don't skip migrations.** Verify each migration runs cleanly on a copy of production data first.
- **Don't change unrelated code in same commit.** One finding = one commit (or one logical group).
- **Don't merge with failing tests.** All three test suites (server bun, sidecar bun, Rust cargo) must be green.
- **Don't ship a fix without verification against the Appendix C payloads.** Manual probe required, screenshot/log saved.
- **Don't downgrade a fix silently.** If recommended approach is harder than expected, document obstacle and alternative chosen, request explicit human review.
- **Don't print credentials anywhere.** Not in logs, not in errors, not in commit messages, not in test fixtures.
- **Don't add new dependencies** without justifying why an existing dep doesn't suffice.
- **Don't use `git rebase -i` or `git push --force`** on the remediation branch once shared.
- **Don't ignore CI warnings.** Treat clippy/biome/typescript warnings as errors for security-critical files.

### Must-do checklist per finding

- [ ] Code change committed with finding ID in message
- [ ] Test added (positive + negative when applicable)
- [ ] All three test suites pass locally
- [ ] Manual probe with Appendix C payload returns expected result
- [ ] Verified no regression in adjacent code (smoke test)
- [ ] `REMEDIATION_NOTES.md` tracker row updated
- [ ] Commit links to finding ID and test file
- [ ] (CRITICAL/HIGH only) screenshot or log of probe result attached to notes

### Per-batch success gate

Do not start Batch N+1 until Batch N's success criteria are all checked.

---

## Required Output

### Branch deliverable (per repo)

- All commits on `security/audit-2026-04-30-remediation`
- `REMEDIATION_NOTES.md` at repo root with:
  - **Tracker table** (ID | Status | Repo+Commit | Test File | Verification result | Notes)
  - **Decision log** — every deviation from this plan with reasoning
  - **Open items log** — anything punted to future round, with rationale and proposed timeline
  - **Operator runbook** — env var requirements, migration steps, JWT rotation procedure, rollback procedures
  - **Known limitations** — incomplete fixes (regex over-redaction, IP-binding false positives, etc.)
- Updated `TERMS_OF_USE.md` (HIGH-001 redaction + PROD-001 AI disclosure + PROD-002 audit modes)
- Updated `docs/oracle-setup.md` (MEDIUM-001 read-only role guidance — even though Layer 1 is roadmap, doc goes now)
- Updated `SECURITY.md` if file references audit cycle / responsible disclosure
- Updated `CHANGELOG.md` with security improvements section (no specifics that aid exploitation, just "improved authentication and audit safeguards")

### Final summary message after each batch

After each batch completes, print:
- Branch name + commit count this batch
- Findings status: X fixed, Y partial, Z roadmapped
- Migration steps the operator must run before deploying (if any)
- Suggested merge order: hotfix vs. with next release
- Re-test instructions: checklist of payloads from Appendix C mapped to verification commands
- **Customer communication recommendation**: Batch 1/2 = silent; Batch 3 = announce new "production safety" mode; Batch 4 = silent; Batch 5 = announce as enterprise feature

---

## What this plan does NOT fix (honest disclosure)

The following risks remain even after Batch 1-5:

1. **Local malware on customer machine** — can read OS keyring, wallet files, RAM. This is the OS's threat model, not Veesker's. Same for any credential-handling app.
2. **Customer's MITM proxy / rogue CA** — no SSL pinning means a corporate-installed rogue CA can MITM. Industry standard for desktop apps. Pinning would break corporate proxies.
3. **Anthropic-side data handling** — once a query goes to Anthropic via AI, Veesker has no control. PROD-001 makes this opt-in per-session for prod, but the data still flows when unlocked. Mitigation: Anthropic's own SOC2 / DPA.
4. **Updater key compromise** (until PROD-003 ships) — single-signer model. Same as DBeaver, RedisInsight, all competitors today.
5. **Supply chain compromise** (until PROD-004 ships) — `oracledb` or transitive dep going malicious. Same risk for any credential-handling tool.

These are acknowledged in `TERMS_OF_USE.md` and `REMEDIATION_NOTES.md`. They match industry-standard residual risk.

---

## Final Instructions

1. **Read this plan and the audit report end to end** before any code change.
2. **Phase 0 first** — pre-flight checks before touching code.
3. **Start with Batch 1 — CRITICAL-001 first, then CRITICAL-002.** Do not interleave with other findings.
4. **One finding = one commit** (or one logical group of commits with shared rationale).
5. **Test alongside fix.** No commit without a test. No test that doesn't include a negative case for security-critical fixes.
6. **If a fix proves significantly harder** than this plan suggests, push back: document obstacle in `REMEDIATION_NOTES.md`, propose alternative, request explicit review before deviating. Do not silently downgrade a fix.
7. **At end of each batch**, run all three test suites + manual probe + update notes + announce status before starting next batch.
8. **No surprise scope expansion.** New findings discovered mid-fix go into `REMEDIATION_NOTES.md` "Open items" — handle in a separate audit round.
9. **Final commit per repo per batch**: `chore(security): close batch-N audit-2026-04-30` referencing `REMEDIATION_NOTES.md`.

After Batch 3 lands, you can honestly answer customers: **"Veesker matches the same production data safety posture as DBeaver EE, RedisInsight Cloud, and Snowflake Snowsight."**

After Batch 5 (eventually), you can answer: **"Veesker exceeds industry standard for production data safety in DB tooling."**

Begin with Phase 0 pre-flight checks.
