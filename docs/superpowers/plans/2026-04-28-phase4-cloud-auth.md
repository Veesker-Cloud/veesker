# Phase 4 — Cloud Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement end-to-end magic link authentication so users can sign in to Veesker Cloud from the desktop app and have `FEATURES.cloudAI` and related flags unlock automatically.

**Architecture:** User enters email in `LoginModal` → desktop POSTs to `api.veesker.cloud/v1/auth/magic-link/send` → backend creates a session and sends an email via Resend → desktop polls `/v1/auth/poll/{session_id}` every 3s → user clicks link in browser → backend verifies token and marks session authenticated → desktop receives JWT on next poll, stores it in OS keyring, applies feature flags.

**Tech Stack:** Backend — Bun, Hono 4, Postgres (`postgres` npm), jose (JWT), Resend REST API. Desktop — SvelteKit 5 runes, Tauri 2, `keyring` Rust crate (already in use), Vitest.

---

## File Map

### Backend (`veesker-cloud/server/`)

| File | Action | Responsibility |
|---|---|---|
| `migrations/002_magic_link.sql` | Create | `magic_link_sessions` table |
| `src/lib/email.ts` | Create | Resend wrapper — `sendMagicLink(to, link)` |
| `src/routes/auth.ts` | Modify | Add 4 new endpoints + `computeFeatures()` |
| `src/routes/auth.test.ts` | Create | Bun tests for all 4 new endpoints |

### Desktop (`veesker/`)

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/persistence/secrets.rs` | Modify | Add `set_auth_token`, `get_auth_token`, `delete_auth_token` |
| `src-tauri/src/commands.rs` | Modify | Add `auth_token_get`, `auth_token_set`, `auth_token_clear` commands |
| `src-tauri/src/lib.rs` | Modify | Register 3 new commands in `invoke_handler` |
| `src/lib/services/auth.ts` | Create | `initAuth()` — startup JWT validation + feature apply |
| `src/lib/services/auth.test.ts` | Create | Vitest tests for `initAuth` |
| `src/lib/ai/providers/CloudProvider.ts` | Modify | Replace stub with real `api.veesker.cloud/v1/ai/chat` call |
| `src/lib/ai/providers/CloudProvider.test.ts` | Create | Vitest tests for CloudProvider HTTP behavior |
| `src/lib/workspace/LoginModal.svelte` | Modify | Replace "coming soon" stub with real 3-state auth UI |
| `src/routes/+layout.svelte` | Modify | Call `initAuth()` on mount |

---

## Part A — Backend (`veesker-cloud/server/`)

---

### Task 1: DB Migration — `magic_link_sessions`

**Files:**
- Create: `veesker-cloud/server/migrations/002_magic_link.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 002_magic_link.sql
CREATE TABLE IF NOT EXISTS magic_link_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'authenticated', 'expired')),
  jwt         TEXT,
  features    JSONB,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS magic_link_session_id ON magic_link_sessions (session_id);
CREATE INDEX IF NOT EXISTS magic_link_expires ON magic_link_sessions (expires_at)
  WHERE status = 'pending';
```

- [ ] **Step 2: Apply the migration**

Run from `veesker-cloud/server/`:
```bash
bun run migrate
```

Expected output:
```
[migrate] applying 002_magic_link.sql
[migrate] schema up to date (2 migrations)
```

- [ ] **Step 3: Verify the table exists**

Connect to the database and run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'magic_link_sessions' ORDER BY ordinal_position;
```

Expected columns: `id`, `session_id`, `email`, `token_hash`, `status`, `jwt`, `features`, `expires_at`, `created_at`.

- [ ] **Step 4: Commit**

```bash
git add migrations/002_magic_link.sql
git commit -m "feat(auth): add magic_link_sessions table"
```

---

### Task 2: Email helper — `src/lib/email.ts`

**Files:**
- Create: `veesker-cloud/server/src/lib/email.ts`
- Create: `veesker-cloud/server/src/lib/email.test.ts`

The backend needs a `RESEND_API_KEY` env var. Get a free API key from resend.com and add it to Railway environment variables.

- [ ] **Step 1: Write the failing test**

Create `src/lib/email.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

describe("sendMagicLink", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async (url: string, opts: RequestInit) => {
      if (url === "https://api.resend.com/emails") {
        const body = JSON.parse(opts.body as string);
        if (!body.to || !body.html) {
          return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
        }
        return new Response(JSON.stringify({ id: "test-id" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("calls Resend with correct body", async () => {
    const { sendMagicLink } = await import("./email");
    process.env.RESEND_API_KEY = "test-key";
    await sendMagicLink("user@example.com", "https://api.veesker.cloud/verify?token=abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(opts.body);
    expect(body.to).toBe("user@example.com");
    expect(body.html).toContain("https://api.veesker.cloud/verify?token=abc");
  });

  it("throws when Resend returns non-2xx", async () => {
    fetchMock = mock(async () => new Response(JSON.stringify({ error: "rate_limit" }), { status: 429 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { sendMagicLink } = await import("./email");
    process.env.RESEND_API_KEY = "test-key";
    await expect(sendMagicLink("user@example.com", "https://link")).rejects.toThrow("Resend error 429");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd veesker-cloud/server
bun test src/lib/email.test.ts
```

Expected: FAIL — `Cannot find module './email'`

- [ ] **Step 3: Create `src/lib/email.ts`**

Create directory `src/lib/` first, then create the file:

```typescript
export async function sendMagicLink(to: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Veesker Cloud <noreply@veesker.cloud>",
      to,
      subject: "Your Veesker Cloud sign-in link",
      html: `
        <p>Click the link below to sign in to Veesker Cloud:</p>
        <p><a href="${link}" style="font-size:16px;font-weight:bold">Sign in to Veesker Cloud</a></p>
        <p>This link expires in 15 minutes. If you did not request this, ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error ${res.status}`);
  }
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun test src/lib/email.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts
git commit -m "feat(auth): add Resend email helper"
```

---

### Task 3: `POST /v1/auth/magic-link/send`

**Files:**
- Modify: `veesker-cloud/server/src/routes/auth.ts`
- Create: `veesker-cloud/server/src/routes/auth.test.ts`

This task also adds the `computeFeatures()` helper used by later tasks.

SHA-256 in Bun: `crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))` returns an `ArrayBuffer`. Convert to hex with: `Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')`.

- [ ] **Step 1: Write the failing test**

Create `src/routes/auth.test.ts`.

**Important:** In Bun test, `mock.module()` must be called before the module is loaded. Use dynamic `await import()` after setting up mocks — do NOT use a static `import { authRoute }` at the top of the file.

```typescript
import { describe, it, expect, mock } from "bun:test";

// Set up mocks BEFORE dynamic import
const sendMock = mock(async () => {});
mock.module("../lib/email", () => ({ sendMagicLink: sendMock }));

const sqlRows: any[] = [];
const sqlMock = Object.assign(
  mock(async () => sqlRows),
  { unsafe: mock(async () => []) }
);
mock.module("../db/client", () => ({ sql: sqlMock }));

// Dynamic import AFTER mocks are registered
const { authRoute } = await import("./auth");

describe("POST /v1/auth/magic-link/send", () => {
  it("returns 200 with valid body", async () => {
    // sqlMock returns [] for all calls — upsert org, upsert user, insert session
    const res = await authRoute.request("/magic-link/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", session_id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 400 with invalid body", async () => {
    const res = await authRoute.request("/magic-link/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/routes/auth.test.ts --testNamePattern "magic-link/send"
```

Expected: FAIL — route not found

- [ ] **Step 3: Add `computeFeatures()` and send endpoint to `src/routes/auth.ts`**

Add these imports at the top of the existing file:

```typescript
import { sendMagicLink } from "../lib/email";
```

Add the `computeFeatures` helper function after the imports:

```typescript
type Features = {
  cloudAI: boolean;
  aiCharts: boolean;
  aiVrasGenerate: boolean;
  aiDebugger: boolean;
  managedEmbeddings: boolean;
  teamFeatures: boolean;
  cloudAudit: boolean;
  isLoggedIn: boolean;
  userTier: "ce" | "cloud";
};

function computeFeatures(tier: string): Features {
  const base: Features = {
    cloudAI: true,
    aiCharts: true,
    aiVrasGenerate: true,
    aiDebugger: false,
    managedEmbeddings: false,
    teamFeatures: false,
    cloudAudit: false,
    isLoggedIn: true,
    userTier: "cloud",
  };
  if (tier === "business" || tier === "enterprise") {
    return { ...base, teamFeatures: true, cloudAudit: true };
  }
  return base;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

Add the send endpoint after the existing `/stub-login` route:

```typescript
const SendMagicLink = z.object({
  email: z.string().email(),
  session_id: z.string().uuid(),
});

authRoute.post("/magic-link/send", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SendMagicLink.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
  }
  const { email, session_id } = parsed.data;

  const token = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // Upsert default org
  await sql`
    INSERT INTO organizations (name, slug, tier)
    VALUES ('Default', 'default', 'personal')
    ON CONFLICT (slug) DO NOTHING
  `;
  const orgs = await sql`SELECT id FROM organizations WHERE slug = 'default' LIMIT 1`;
  const orgId = orgs[0].id;

  // Upsert user
  await sql`
    INSERT INTO users (org_id, email)
    VALUES (${orgId}, ${email})
    ON CONFLICT (org_id, email) DO NOTHING
  `;

  await sql`
    INSERT INTO magic_link_sessions (session_id, email, token_hash, expires_at)
    VALUES (${session_id}, ${email}, ${tokenHash}, ${expiresAt})
    ON CONFLICT (session_id) DO NOTHING
  `;

  const link = `https://api.veesker.cloud/v1/auth/magic-link/verify?token=${token}&session_id=${session_id}`;

  try {
    await sendMagicLink(email, link);
  } catch {
    return c.json({ error: "email_send_failed" }, 503);
  }

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun test src/routes/auth.test.ts --testNamePattern "magic-link/send"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.ts src/routes/auth.test.ts src/lib/email.ts
git commit -m "feat(auth): add POST /v1/auth/magic-link/send"
```

---

### Task 4: `GET /v1/auth/magic-link/verify`

**Files:**
- Modify: `veesker-cloud/server/src/routes/auth.ts`
- Modify: `veesker-cloud/server/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/routes/auth.test.ts`:

```typescript
describe("GET /v1/auth/magic-link/verify", () => {
  it("redirects to /auth/done on valid token", async () => {
    const sessionId = crypto.randomUUID();
    const token = "test-token-123";
    const tokenHash = await sha256Hex(token); // need to import this helper or duplicate

    // Mock DB: session found pending + not expired + user found
    let callCount = 0;
    sqlMock.mockImplementation(async (...args: any[]) => {
      callCount++;
      if (callCount === 1) return [{ session_id: sessionId, email: "u@e.com", token_hash: tokenHash, status: "pending", expires_at: new Date(Date.now() + 60000) }];
      if (callCount === 2) return [{ id: "user-id", role: "developer", tier: "personal" }];
      return [];
    });

    const res = await authRoute.request(`/magic-link/verify?token=${token}&session_id=${sessionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("app.veesker.cloud/auth/done");
  });

  it("redirects to /auth/error on wrong token", async () => {
    sqlMock.mockImplementation(async () => [{
      session_id: "sid", email: "u@e.com",
      token_hash: "wrong-hash", status: "pending",
      expires_at: new Date(Date.now() + 60000),
    }]);
    const res = await authRoute.request("/magic-link/verify?token=bad&session_id=sid");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("auth/error");
  });

  it("redirects to /auth/error on expired session", async () => {
    sqlMock.mockImplementation(async () => [{
      session_id: "sid", email: "u@e.com",
      token_hash: "any", status: "pending",
      expires_at: new Date(Date.now() - 1000), // already expired
    }]);
    const res = await authRoute.request("/magic-link/verify?token=any&session_id=sid");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("auth/error");
  });
});

// Helper for tests — same as server implementation
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/routes/auth.test.ts --testNamePattern "verify"
```

Expected: FAIL

- [ ] **Step 3: Add the verify endpoint to `src/routes/auth.ts`**

```typescript
authRoute.get("/magic-link/verify", async (c) => {
  const token = c.req.query("token");
  const sessionId = c.req.query("session_id");
  const errorUrl = "https://app.veesker.cloud/auth/error?reason=invalid";
  const doneUrl = "https://app.veesker.cloud/auth/done";

  if (!token || !sessionId) return c.redirect(errorUrl, 302);

  const sessions = await sql`
    SELECT session_id, email, token_hash, status, expires_at
    FROM magic_link_sessions WHERE session_id = ${sessionId}
  `;
  if (sessions.length === 0) return c.redirect(errorUrl, 302);

  const session = sessions[0];
  if (session.status !== "pending" || new Date(session.expires_at) < new Date()) {
    return c.redirect(errorUrl, 302);
  }

  const incoming = await sha256Hex(token);
  if (incoming !== session.token_hash) return c.redirect(errorUrl, 302);

  const users = await sql`
    SELECT u.id, u.org_id, u.role, o.tier
    FROM users u JOIN organizations o ON o.id = u.org_id
    WHERE u.email = ${session.email} LIMIT 1
  `;
  if (users.length === 0) return c.redirect(errorUrl, 302);
  const user = users[0];

  const features = computeFeatures(user.tier);
  const jwt = await issueToken({ sub: user.id, org: user.org_id, email: session.email, role: user.role }, "30d");

  await sql`
    UPDATE magic_link_sessions
    SET status = 'authenticated', jwt = ${jwt}, features = ${JSON.stringify(features)}::jsonb
    WHERE session_id = ${sessionId}
  `;

  return c.redirect(doneUrl, 302);
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun test src/routes/auth.test.ts --testNamePattern "verify"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.ts src/routes/auth.test.ts
git commit -m "feat(auth): add GET /v1/auth/magic-link/verify"
```

---

### Task 5: `GET /v1/auth/poll/:session_id`

**Files:**
- Modify: `veesker-cloud/server/src/routes/auth.ts`
- Modify: `veesker-cloud/server/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/routes/auth.test.ts`:

```typescript
describe("GET /v1/auth/poll/:session_id", () => {
  it("returns pending when session is pending", async () => {
    sqlMock.mockImplementation(async () => [{
      status: "pending", jwt: null, features: null,
      expires_at: new Date(Date.now() + 60000),
    }]);
    const res = await authRoute.request("/poll/test-session-id");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
  });

  it("returns authenticated with token when verified", async () => {
    sqlMock.mockImplementation(async () => [{
      status: "authenticated",
      jwt: "jwt.token.here",
      features: { cloudAI: true, aiCharts: true, isLoggedIn: true, userTier: "cloud" },
      expires_at: new Date(Date.now() + 60000),
    }]);
    const res = await authRoute.request("/poll/test-session-id");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("authenticated");
    expect(body.token).toBe("jwt.token.here");
    expect(body.features.cloudAI).toBe(true);
  });

  it("returns expired when session has timed out", async () => {
    sqlMock.mockImplementation(async () => [{
      status: "pending", jwt: null, features: null,
      expires_at: new Date(Date.now() - 1000),
    }]);
    const res = await authRoute.request("/poll/test-session-id");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("expired");
  });

  it("returns 404 when session not found", async () => {
    sqlMock.mockImplementation(async () => []);
    const res = await authRoute.request("/poll/unknown-session");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/routes/auth.test.ts --testNamePattern "poll"
```

Expected: FAIL

- [ ] **Step 3: Add the poll endpoint to `src/routes/auth.ts`**

```typescript
authRoute.get("/poll/:session_id", async (c) => {
  const sessionId = c.req.param("session_id");
  const sessions = await sql`
    SELECT status, jwt, features, expires_at
    FROM magic_link_sessions WHERE session_id = ${sessionId}
  `;
  if (sessions.length === 0) return c.json({ error: "not_found" }, 404);

  const session = sessions[0];

  if (session.status === "pending" && new Date(session.expires_at) < new Date()) {
    await sql`UPDATE magic_link_sessions SET status = 'expired' WHERE session_id = ${sessionId}`;
    return c.json({ status: "expired" });
  }

  if (session.status === "authenticated") {
    return c.json({ status: "authenticated", token: session.jwt, features: session.features });
  }

  return c.json({ status: session.status });
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun test src/routes/auth.test.ts --testNamePattern "poll"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.ts src/routes/auth.test.ts
git commit -m "feat(auth): add GET /v1/auth/poll/:session_id"
```

---

### Task 6: `GET /v1/auth/me`

**Files:**
- Modify: `veesker-cloud/server/src/routes/auth.ts`
- Modify: `veesker-cloud/server/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/routes/auth.test.ts`:

```typescript
import { issueToken } from "../auth/jwt";

describe("GET /v1/auth/me", () => {
  it("returns user and features for valid JWT", async () => {
    const token = await issueToken({ sub: "user-1", org: "org-1", email: "u@e.com", role: "developer" });
    sqlMock.mockImplementation(async () => [{
      id: "user-1", email: "u@e.com", role: "developer", tier: "personal",
    }]);
    const res = await authRoute.request("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("u@e.com");
    expect(body.features.cloudAI).toBe(true);
    expect(body.features.teamFeatures).toBe(false);
  });

  it("returns 401 without token", async () => {
    const res = await authRoute.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns teamFeatures true for business tier", async () => {
    const token = await issueToken({ sub: "u2", org: "o2", email: "u2@e.com", role: "admin" });
    sqlMock.mockImplementation(async () => [{
      id: "u2", email: "u2@e.com", role: "admin", tier: "business",
    }]);
    const res = await authRoute.request("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.features.teamFeatures).toBe(true);
    expect(body.features.cloudAudit).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/routes/auth.test.ts --testNamePattern "/me"
```

Expected: FAIL

- [ ] **Step 3: Add the me endpoint to `src/routes/auth.ts`**

Add this import at the top of the file:
```typescript
import { authRequired } from "../auth/middleware";
```

Add the endpoint:

```typescript
authRoute.get("/me", authRequired, async (c) => {
  const claims = c.get("user");
  const users = await sql`
    SELECT u.id, u.email, u.role, o.id AS org_id, o.slug, o.tier
    FROM users u JOIN organizations o ON o.id = u.org_id
    WHERE u.id = ${claims.sub} LIMIT 1
  `;
  if (users.length === 0) return c.json({ error: "user_not_found" }, 404);
  const u = users[0];
  return c.json({
    user: { id: u.id, email: u.email, role: u.role },
    org: { id: u.org_id, slug: u.slug, tier: u.tier },
    features: computeFeatures(u.tier),
  });
});
```

- [ ] **Step 4: Run all backend tests**

```bash
bun test src/routes/auth.test.ts
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.ts src/routes/auth.test.ts
git commit -m "feat(auth): add GET /v1/auth/me"
```

---

## Part B — Desktop (`veesker/`)

---

### Task 7: Tauri keyring commands — `auth_token_get`, `auth_token_set`, `auth_token_clear`

**Files:**
- Modify: `veesker/src-tauri/src/persistence/secrets.rs`
- Modify: `veesker/src-tauri/src/commands.rs`
- Modify: `veesker/src-tauri/src/lib.rs`

The `keyring` crate is already a dependency — see existing `set_api_key`, `get_api_key` pattern in `persistence/secrets.rs`.

- [ ] **Step 1: Add token helpers to `persistence/secrets.rs`**

The existing pattern: `Entry::new("veesker", account_name)`. Add after the `git_pat` functions:

```rust
fn auth_token_account() -> &'static str {
    "auth:cloud_token"
}

pub fn set_auth_token(token: &str) -> keyring::Result<()> {
    entry(auth_token_account())?.set_password(token)
}

pub fn get_auth_token() -> keyring::Result<Option<String>> {
    match entry(auth_token_account())?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_auth_token() -> keyring::Result<()> {
    delete_account(auth_token_account())
}
```

- [ ] **Step 2: Add thin command handlers to `commands.rs`**

Add these three functions at the end of `commands.rs`:

```rust
#[tauri::command]
pub async fn auth_token_get() -> Result<Option<String>, String> {
    crate::persistence::secrets::get_auth_token().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_token_set(token: String) -> Result<(), String> {
    crate::persistence::secrets::set_auth_token(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_token_clear() -> Result<(), String> {
    crate::persistence::secrets::delete_auth_token().map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `.invoke_handler(tauri::generate_handler![` block (around line 214). Add three entries at the end of the list, before the closing `])`:

```rust
            commands::auth_token_get,
            commands::auth_token_set,
            commands::auth_token_clear,
```

- [ ] **Step 4: Verify it compiles**

Run from `veesker/`:
```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/secrets.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(auth): add auth_token keyring commands"
```

---

### Task 8: `src/lib/services/auth.ts` — startup auth init

**Files:**
- Create: `veesker/src/lib/services/auth.ts`
- Create: `veesker/src/lib/services/auth.test.ts`

`initAuth()` reads JWT from keyring, validates expiry locally (no network needed), applies features from `localStorage`, then refreshes from `/v1/auth/me` in background.

JWT payload is base64url. To decode without signature verification: `JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FEATURES, resetFeatures } from "./features";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

// Build a real (non-signed) JWT payload for testing
function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
  const payload = btoa(JSON.stringify({ sub: "u1", exp })).replace(/=/g, "");
  return `${header}.${payload}.fakesig`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
const PAST_EXP = Math.floor(Date.now() / 1000) - 86400;   // 1 day ago

describe("initAuth", () => {
  beforeEach(() => {
    resetFeatures();
    vi.mocked(invoke).mockReset();
    localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no token in keyring", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const { initAuth } = await import("./auth");
    await initAuth();
    expect(FEATURES.cloudAI).toBe(false);
    expect(FEATURES.isLoggedIn).toBe(false);
  });

  it("clears token and stays CE when JWT is expired", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeJwt(PAST_EXP)) // auth_token_get
      .mockResolvedValueOnce(undefined);          // auth_token_clear
    const { initAuth } = await import("./auth");
    await initAuth();
    expect(invoke).toHaveBeenCalledWith("auth_token_clear");
    expect(FEATURES.cloudAI).toBe(false);
  });

  it("applies features from localStorage when token is valid", async () => {
    vi.mocked(invoke).mockResolvedValue(makeJwt(FUTURE_EXP));
    localStorage.setItem("veesker:features", JSON.stringify({ cloudAI: true, aiCharts: true, isLoggedIn: true, userTier: "cloud", aiVrasGenerate: true, aiDebugger: false, managedEmbeddings: false, teamFeatures: false, cloudAudit: false }));
    const { initAuth } = await import("./auth");
    await initAuth();
    expect(FEATURES.cloudAI).toBe(true);
    expect(FEATURES.isLoggedIn).toBe(true);
  });

  it("does not crash when localStorage features are missing", async () => {
    vi.mocked(invoke).mockResolvedValue(makeJwt(FUTURE_EXP));
    // no localStorage entry set
    const { initAuth } = await import("./auth");
    await expect(initAuth()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd veesker
bun run test -- src/lib/services/auth.test.ts
```

Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Create `src/lib/services/auth.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { FEATURES, applyFeatureFlags, resetFeatures } from "./features";

function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

export async function initAuth(): Promise<void> {
  const token = await invoke<string | null>("auth_token_get");
  if (!token) return;

  const exp = decodeJwtExp(token);
  if (!exp || Date.now() / 1000 > exp) {
    await invoke("auth_token_clear");
    resetFeatures();
    return;
  }

  const stored = localStorage.getItem("veesker:features");
  if (stored) {
    try {
      applyFeatureFlags(JSON.parse(stored));
    } catch {
      // malformed — ignore, background refresh will fix it
    }
  }

  // Background refresh — don't await, don't block startup
  void fetch("https://api.veesker.cloud/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (res) => {
    if (res.status === 401) {
      await invoke("auth_token_clear");
      resetFeatures();
      localStorage.removeItem("veesker:features");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      if (data.features) {
        applyFeatureFlags(data.features);
        localStorage.setItem("veesker:features", JSON.stringify(data.features));
      }
    }
  }).catch(() => {
    // offline — already applied from localStorage above
  });
}

export async function logout(): Promise<void> {
  await invoke("auth_token_clear");
  localStorage.removeItem("veesker:features");
  resetFeatures();
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun run test -- src/lib/services/auth.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/auth.ts src/lib/services/auth.test.ts
git commit -m "feat(auth): add initAuth service with JWT validation"
```

---

### Task 9: `CloudProvider.ts` — real HTTP implementation

**Files:**
- Modify: `veesker/src/lib/ai/providers/CloudProvider.ts`
- Create: `veesker/src/lib/ai/providers/CloudProvider.test.ts`

Replace the stub. `POST /v1/ai/chat` doesn't exist yet on the backend — when it returns 404, the code returns `CLOUD_UNAVAILABLE`, which triggers BYOK fallback in `AIService`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/providers/CloudProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { CloudProvider } from "./CloudProvider";

const mockParams = {
  apiKey: "",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }],
  context: { activeSql: "" },
};

describe("CloudProvider", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(globalThis, "fetch").mockReset();
  });

  it("returns UNAUTHORIZED when no token in keyring", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED on 401 response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("returns PAYMENT_REQUIRED on 402 response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 402 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAYMENT_REQUIRED");
  });

  it("returns CLOUD_UNAVAILABLE on 5xx response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_UNAVAILABLE");
  });

  it("returns CLOUD_UNAVAILABLE on 404 (endpoint not yet live)", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_UNAVAILABLE");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
bun run test -- src/lib/ai/providers/CloudProvider.test.ts
```

Expected: FAIL — stub returns `CLOUD_NOT_IMPLEMENTED`, not the expected codes

- [ ] **Step 3: Replace `src/lib/ai/providers/CloudProvider.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { AIProvider, ChatParams, ChatResult, ProviderError } from "../AIProvider";

export function CloudProvider(): AIProvider {
  return {
    async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }> {
      const token = await invoke<string | null>("auth_token_get");
      if (!token) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "Not logged in to Veesker Cloud. Sign in to use Cloud AI." } };
      }

      let res: Response;
      try {
        res = await fetch("https://api.veesker.cloud/v1/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: params.messages,
            context: params.context,
          }),
        });
      } catch {
        return { ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "Veesker Cloud is temporarily unavailable." } };
      }

      if (res.status === 401) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "Session expired. Please sign in again." } };
      }
      if (res.status === 402) {
        return { ok: false, error: { code: "PAYMENT_REQUIRED", message: "Credit limit reached. Visit veesker.cloud to top up." } };
      }
      if (!res.ok) {
        return { ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "Veesker Cloud is temporarily unavailable." } };
      }

      const data = await res.json() as ChatResult;
      return { ok: true, data };
    },
  };
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
bun run test -- src/lib/ai/providers/CloudProvider.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Run full frontend test suite to catch regressions**

```bash
bun run test
```

Expected: all tests pass (pre-existing `sql-splitter.test.ts` import errors are not blocking)

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/providers/CloudProvider.ts src/lib/ai/providers/CloudProvider.test.ts
git commit -m "feat(auth): implement real CloudProvider with JWT auth"
```

---

### Task 10: `LoginModal.svelte` — real 3-state auth UI

**Files:**
- Modify: `veesker/src/lib/workspace/LoginModal.svelte`

Replace the "coming soon" stub with a real login flow: email input → send magic link → poll in background → success closes modal.

- [ ] **Step 1: Replace the full content of `src/lib/workspace/LoginModal.svelte`**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/Veesker-Cloud/veesker
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { applyFeatureFlags } from "$lib/services/features";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  type State = "idle" | "waiting" | "error";
  let state = $state<State>("idle");
  let email = $state("");
  let errorMessage = $state("");
  let polling = false;

  async function sendLink() {
    if (!email.trim()) return;
    const sessionId = crypto.randomUUID();
    try {
      const res = await fetch("https://api.veesker.cloud/v1/auth/magic-link/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), session_id: sessionId }),
      });
      if (!res.ok) throw new Error("send_failed");
      state = "waiting";
      startPoll(sessionId);
    } catch {
      state = "error";
      errorMessage = "Failed to send email. Please try again.";
    }
  }

  async function startPoll(sessionId: string) {
    polling = true;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (polling && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      if (!polling) break;
      try {
        const res = await fetch(`https://api.veesker.cloud/v1/auth/poll/${sessionId}`);
        const data = await res.json();
        if (data.status === "authenticated") {
          await invoke("auth_token_set", { token: data.token });
          localStorage.setItem("veesker:features", JSON.stringify(data.features));
          applyFeatureFlags(data.features);
          polling = false;
          onClose();
          return;
        }
        if (data.status === "expired") {
          polling = false;
          state = "error";
          errorMessage = "Link expired. Please try again.";
          return;
        }
      } catch {
        // network hiccup — keep polling
      }
    }
    if (polling) {
      polling = false;
      state = "error";
      errorMessage = "Timed out waiting. Please try again.";
    }
  }

  function retry() {
    polling = false;
    state = "idle";
    errorMessage = "";
  }

  function handleClose() {
    polling = false;
    onClose();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={handleClose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" aria-label="Close" onclick={handleClose}>✕</button>

    {#if state === "idle"}
      <div class="cloud-icon">☁</div>
      <h2>Sign in to Veesker Cloud</h2>
      <p class="lead">Schema-aware AI that knows your database — no API key required.</p>
      <input
        class="email-input"
        type="email"
        placeholder="you@company.com"
        bind:value={email}
        onkeydown={(e) => e.key === "Enter" && sendLink()}
      />
      <div class="actions">
        <button class="btn primary" onclick={sendLink} disabled={!email.trim()}>Send sign-in link</button>
        <button class="btn" onclick={handleClose}>Continue with CE</button>
      </div>

    {:else if state === "waiting"}
      <div class="cloud-icon">☁</div>
      <h2>Check your email</h2>
      <p class="lead">We sent a sign-in link to <strong>{email}</strong>. Click it in your browser, then return here.</p>
      <div class="spinner" aria-label="Waiting for authentication"></div>
      <button class="btn" onclick={retry}>Use a different email</button>

    {:else}
      <div class="cloud-icon error-icon">⚠</div>
      <h2>Something went wrong</h2>
      <p class="lead error-text">{errorMessage}</p>
      <div class="actions">
        <button class="btn primary" onclick={retry}>Try again</button>
        <button class="btn" onclick={handleClose}>Continue with CE</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .close-btn {
    position: absolute; top: 14px; right: 14px;
    background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px;
  }
  .cloud-icon { font-size: 36px; text-align: center; }
  .error-icon { filter: grayscale(0.5); }
  h2 { margin: 0; font-size: 22px; text-align: center; }
  .lead { margin: 0; color: var(--text-muted); font-size: 14px; text-align: center; line-height: 1.6; }
  .error-text { color: #f87171; }
  .email-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-surface-alt);
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }
  .email-input:focus { border-color: #2bb4ee; }
  .actions { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 10px 0; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-surface-alt);
    color: var(--text-primary);
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.primary {
    background: #2bb4ee; color: #fff; border-color: #2bb4ee;
  }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border);
    border-top-color: #2bb4ee;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: Type-check**

```bash
bun run check
```

Expected: 0 TypeScript errors

- [ ] **Step 3: Lint**

```bash
bun run lint
```

Expected: 0 Biome warnings

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/LoginModal.svelte
git commit -m "feat(auth): implement real LoginModal with magic link + poll"
```

---

### Task 11: Wire `initAuth` into app startup

**Files:**
- Modify: `veesker/src/routes/+layout.svelte`

- [ ] **Step 1: Add `initAuth` call to `+layout.svelte`**

The current `+layout.svelte` imports `"../app.css"` and renders children. Add `onMount` call:

Current file content:
```svelte
<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>
```

Replace with:
```svelte
<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { initAuth } from "$lib/services/auth";

  let { children }: { children: Snippet } = $props();

  onMount(() => { initAuth(); });
</script>
```

Leave the rest of the template and style unchanged.

- [ ] **Step 2: Type-check**

```bash
bun run check
```

Expected: 0 TypeScript errors

- [ ] **Step 3: Run full test suite**

```bash
bun run test
```

Expected: all tests pass

- [ ] **Step 4: Lint**

```bash
bun run lint
```

Expected: 0 Biome warnings

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat(auth): call initAuth on app startup"
```

---

## Manual Verification Checklist

Before marking Phase 4 complete, verify these flows end-to-end:

- [ ] Enter email in LoginModal → "Check your email" state appears
- [ ] Click link in email → browser shows "done" page (or error page for wrong token)
- [ ] Desktop detects login automatically (modal closes, no user action needed)
- [ ] `FEATURES.cloudAI` is `true` after login (can verify via browser devtools: `import { FEATURES } from "/src/lib/services/features.ts"`)
- [ ] Restart app → still logged in (JWT persisted in keyring)
- [ ] Offline restart with valid token → features apply from localStorage (no network needed)
- [ ] Wait for token to expire (set a 1-minute JWT for testing) → app silently resets to CE on next startup
- [ ] Backend: `GET /v1/auth/me` with expired JWT → 401

