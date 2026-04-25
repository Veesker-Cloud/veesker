# Veesker Cloud Web Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SaaS web dashboard at `app.veesker.cloud` — SvelteKit 5 static site that authenticates against `api.veesker.cloud` and lets organization admins manage connections, users, audit logs, and API tokens.

**Architecture:** New repo `gevianajr/veesker-app` (private), deployed to Cloudflare Workers Static Assets via `wrangler.jsonc`. SvelteKit 5 with adapter-static + prerender for marketing-style pages and `+page.server.ts` form actions for auth/proxy calls to the API. Auth via JWT in HttpOnly cookie; server-side proxying to `api.veesker.cloud` to keep tokens out of JS.

**Tech Stack:** SvelteKit 5, Svelte 5 runes (`$state`, `$derived`, `$effect`), Bun runtime + Vite, TypeScript strict, Cloudflare Workers (Static Assets via `wrangler.jsonc`), `gh` CLI for repo creation.

**Spec reference:** `docs/superpowers/specs/2026-04-25-veesker-cloud-app-design.md`

---

## File map (target structure)

```
veesker-app/                                            (NEW repo)
├── .gitignore
├── package.json
├── tsconfig.json
├── svelte.config.js
├── vite.config.ts
├── wrangler.jsonc                                       Cloudflare deploy config
├── README.md
├── src/
│   ├── app.html                                         shell with theme + favicon
│   ├── app.css                                          CSS variables (matches marketing site)
│   ├── lib/
│   │   ├── api.ts                                       fetch wrapper around api.veesker.cloud (server-side)
│   │   ├── auth.ts                                      cookie helpers (set/get/clear vsk_token)
│   │   ├── types.ts                                     shared types matching the API
│   │   └── components/
│   │       ├── TopNav.svelte
│   │       ├── Banner.svelte
│   │       └── EmptyState.svelte
│   └── routes/
│       ├── +layout.svelte                               TopNav + global state
│       ├── +layout.ts                                   prerender = false (dashboard is dynamic)
│       ├── +layout.server.ts                            auth guard — redirect to /login if no cookie
│       ├── +page.server.ts                              redirects / -> /connections
│       ├── login/
│       │   ├── +page.svelte                             login form
│       │   └── +page.server.ts                          form action that calls /v1/auth/stub-login
│       ├── logout/
│       │   └── +server.ts                               clears cookie, redirects
│       ├── connections/
│       │   ├── +page.svelte                             list view
│       │   ├── +page.server.ts                          loads list from API
│       │   ├── new/
│       │   │   ├── +page.svelte                         create form
│       │   │   └── +page.server.ts                      form action POST /v1/connections
│       │   └── [id]/
│       │       ├── +page.svelte                         detail / edit
│       │       └── +page.server.ts                      load + form actions for update/delete
│       ├── audit/
│       │   ├── +page.svelte                             query + pagination
│       │   ├── +page.server.ts                          POST /v1/audit/query
│       │   └── stats/
│       │       ├── +page.svelte                         dashboard with top-N panels
│       │       └── +page.server.ts                      GET /v1/audit/stats
│       ├── users/
│       │   ├── +page.svelte                             member list
│       │   ├── +page.server.ts                          GET /v1/orgs/users
│       │   └── new/
│       │       ├── +page.svelte                         invite form
│       │       └── +page.server.ts                      POST /v1/orgs/users
│       ├── tokens/
│       │   ├── +page.svelte                             personal access tokens
│       │   └── +page.server.ts                          load + create + revoke (form actions)
│       └── settings/
│           ├── +page.svelte                             profile + org overview
│           └── +page.server.ts                          load + update display name
├── static/
│   ├── favicon.svg
│   ├── favicon.png
│   └── veesker-logo.png
└── tests/
    ├── auth.test.ts                                     unit tests for cookie helpers
    └── api.test.ts                                      unit tests for the API wrapper
```

Plus changes in the **existing `veesker-cloud` repo** (NOT this one):
- `server/src/routes/tokens.ts` — NEW: list/create/revoke personal access tokens
- `server/src/index.ts` — wire `/v1/tokens` route

---

## Task 1: Bootstrap the repo

**Files:**
- Create `C:\Users\geefa\Documents\veesker-app\` (new physical repo)
- All files under it: `.gitignore`, `package.json`, `tsconfig.json`, `svelte.config.js`, `vite.config.ts`, `wrangler.jsonc`, `src/app.html`, `src/app.css`, `static/favicon.svg`, `static/favicon.png`, `static/veesker-logo.png`, `README.md`

- [ ] **Step 1: Create the directory and initialize**

```bash
cd /c/Users/geefa/Documents/
mkdir veesker-app
cd veesker-app
bun init -y
```

- [ ] **Step 2: Replace package.json**

```json
{
  "name": "veesker-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.10",
    "@sveltejs/kit": "^2.58.0",
    "@sveltejs/vite-plugin-svelte": "^5.1.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/svelte": "^5.3.1",
    "@vitest/ui": "^4.1.5",
    "jsdom": "^29.0.2",
    "svelte": "^5.55.5",
    "svelte-check": "^4.4.6",
    "typescript": "~5.6.3",
    "vite": "^6.4.2",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 3: Create svelte.config.js**

```javascript
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
      precompress: false,
      strict: false,
    }),
  },
};

export default config;
```

- [ ] **Step 4: Create wrangler.jsonc**

```jsonc
{
  "$schema": "https://unpkg.com/wrangler/config-schema.json",
  "name": "veesker-app",
  "compatibility_date": "2025-04-01",
  "assets": {
    "directory": "./build",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  }
}
```

The `single-page-application` mode tells Cloudflare to serve `index.html` (the SPA shell) for any path that doesn't match an asset, so client-side routing works.

- [ ] **Step 5: Create tsconfig.json**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 6: Create vite.config.ts**

```typescript
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.test.{js,ts}"],
    environment: "jsdom",
  },
});
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
build/
.svelte-kit/
.env
.env.*
!.env.example
.DS_Store
*.log
```

- [ ] **Step 8: Create src/app.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0e0c0a" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" type="image/svg+xml" href="%sveltekit.assets%/favicon.svg" />
    <link rel="alternate icon" type="image/png" href="%sveltekit.assets%/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
    <title>Veesker Cloud</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 9: Create src/app.css**

```css
:root {
  --bg-page: #0e0c0a;
  --bg-surface: #1a1614;
  --bg-surface-alt: #232020;
  --border: #3b3837;
  --text-primary: #f4ede4;
  --text-muted: #a39a8e;
  --accent: #e8643a;
  --accent-soft: rgba(232, 100, 58, 0.18);
  --accent-text: #e8643a;
  --error: #c44a4a;
  --warn: #c3a66e;
  --ok: #8bc4a8;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

a { color: var(--accent-text); text-decoration: none; }
a:hover { text-decoration: underline; }

button { font-family: inherit; }

.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
}

.btn {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-surface-alt);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.danger { background: var(--error); border-color: var(--error); color: #fff; }

input, select, textarea {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 500;
}

.muted { color: var(--text-muted); }
.error { color: var(--error); }
```

- [ ] **Step 10: Create README.md**

```markdown
# Veesker Cloud Web Dashboard

Web dashboard for Veesker Cloud — manage Oracle connections, audit logs, users, and API tokens. Authenticates against `api.veesker.cloud`.

Deployed at https://app.veesker.cloud

## Develop

\```bash
bun install
bun run dev
\```

## Build

\```bash
bun run build
\```

## Deploy

Push to `main` — Cloudflare Pages picks up via GitHub integration.

## Repo

Private repo: `gevianajr/veesker-app`
```

- [ ] **Step 11: Copy assets**

```bash
cp /c/Users/geefa/Documents/veesker/static/favicon.svg static/
cp /c/Users/geefa/Documents/veesker/static/favicon.png static/
cp /c/Users/geefa/Documents/veesker/static/veesker-logo.png static/
```

- [ ] **Step 12: Install deps**

```bash
bun install
```

- [ ] **Step 13: Verify dev runs**

```bash
bun run dev
```

Browser at `http://localhost:5173` should show a SvelteKit default page (we haven't added routes yet — Step 14 fills the placeholder).

- [ ] **Step 14: Create placeholder routes**

`src/routes/+page.svelte`:
```svelte
<h1>Veesker Cloud</h1>
<p>Dashboard scaffold — login flow comes in Task 2.</p>
```

- [ ] **Step 15: Initial commit + create GitHub repo + push**

```bash
git init
git add .
git commit -m "feat: bootstrap veesker-app SvelteKit + Cloudflare scaffold"
gh repo create gevianajr/veesker-app --private --source . --remote origin --push
```

---

## Task 2: API client + Auth cookies

**Files:**
- Create: `src/lib/api.ts` — fetch wrapper that adds the JWT cookie + parses JSON, server-only
- Create: `src/lib/auth.ts` — cookie helpers (set/get/clear)
- Create: `src/lib/types.ts` — shared types from API
- Test: `tests/auth.test.ts`, `tests/api.test.ts`

- [ ] **Step 1: Write failing test for cookie helpers**

`tests/auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { TOKEN_COOKIE, parseTokenCookie } from "../src/lib/auth";

describe("auth cookie", () => {
  it("constant matches expected name", () => {
    expect(TOKEN_COOKIE).toBe("vsk_token");
  });

  it("parseTokenCookie returns the token from a Cookie header", () => {
    expect(parseTokenCookie("vsk_token=abc; other=xyz")).toBe("abc");
    expect(parseTokenCookie("other=xyz")).toBeNull();
    expect(parseTokenCookie("")).toBeNull();
    expect(parseTokenCookie(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun run test tests/auth.test.ts
```
Expected: module not found.

- [ ] **Step 3: Create src/lib/auth.ts**

```typescript
export const TOKEN_COOKIE = "vsk_token";

export function parseTokenCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const [name, ...rest] = p.trim().split("=");
    if (name === TOKEN_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export function tokenCookieAttributes(maxAgeSeconds: number): string {
  // HttpOnly + Secure + SameSite=Lax. Domain set to .veesker.cloud so the
  // marketing site does not see it; only app.veesker.cloud and api.veesker.cloud subdomains share it.
  // For local dev we don't set Secure (HTTP).
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (isProd) {
    parts.push("Secure");
    parts.push("Domain=.veesker.cloud");
  }
  return parts.join("; ");
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun run test tests/auth.test.ts
```

- [ ] **Step 5: Write failing test for the API client**

`tests/api.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { apiFetch } from "../src/lib/api";

describe("apiFetch", () => {
  it("returns parsed JSON on success", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });
    const res = await apiFetch("/v1/health", { fetcher: fakeFetch });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ status: "ok" });
  });

  it("returns error shape on 4xx/5xx", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    });
    const res = await apiFetch("/v1/orgs/me", { fetcher: fakeFetch });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.status).toBe(401);
    expect(res.error.message).toMatch(/unauthorized/);
  });

  it("attaches Bearer token when provided", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await apiFetch("/v1/orgs/me", { fetcher: fakeFetch, token: "tk-123" });
    const callArgs = fakeFetch.mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBe("Bearer tk-123");
  });
});
```

- [ ] **Step 6: Run, verify failure**

```bash
bun run test tests/api.test.ts
```

- [ ] **Step 7: Create src/lib/api.ts**

```typescript
const API_BASE = process.env.NODE_ENV === "production"
  ? "https://api.veesker.cloud"
  : (process.env.VEESKER_API_BASE ?? "http://localhost:8787");

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { status: number; message: string } };

export type ApiFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  token?: string | null;
  fetcher?: typeof fetch;
};

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<ApiResult<T>> {
  const f = opts.fetcher ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const r = await f(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const message = (data && typeof data === "object" && "error" in (data as any))
      ? String((data as any).error)
      : `HTTP ${r.status}`;
    return { ok: false, error: { status: r.status, message } };
  }
  return { ok: true, data: data as T };
}
```

- [ ] **Step 8: Run tests pass**

```bash
bun run test
```

- [ ] **Step 9: Create src/lib/types.ts**

```typescript
export type Role = "viewer" | "developer" | "dba" | "admin";

export type Org = {
  id: string;
  name: string;
  slug: string;
  tier: "personal" | "pro" | "business" | "enterprise";
};

export type User = {
  id: string;
  email: string;
  role: Role;
  displayName?: string;
};

export type Connection = {
  id: string;
  orgId: string;
  name: string;
  environment: "dev" | "hml" | "staging" | "prod";
  authType: "basic" | "wallet";
  host?: string;
  port?: number;
  serviceName?: string;
  connectAlias?: string;
  username: string;
  comments?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  id: number;
  orgId: string;
  userId?: string;
  userEmail: string;
  connectionId?: string;
  connectionName?: string;
  host?: string;
  sqlText: string;
  sqlTruncated: boolean;
  success: boolean;
  rowCount?: number;
  elapsedMs: number;
  errorCode?: number;
  errorMessage?: string;
  clientVersion?: string;
  occurredAt: string;
  ingestedAt: string;
};

export type ApiToken = {
  id: string;
  name: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
};
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/api.ts src/lib/auth.ts src/lib/types.ts tests/
git commit -m "feat(lib): API client + auth cookie helpers + shared types"
```

---

## Task 3: Login page + form action

**Files:**
- Create: `src/routes/login/+page.svelte`
- Create: `src/routes/login/+page.server.ts`
- Modify: `src/routes/+layout.svelte` (header / brand)
- Modify: `src/routes/+layout.server.ts` (auth guard)

- [ ] **Step 1: Write the +layout.server.ts auth guard**

```typescript
import { redirect } from "@sveltejs/kit";
import { TOKEN_COOKIE } from "$lib/auth";

export const load = async ({ url, cookies }) => {
  const token = cookies.get(TOKEN_COOKIE);
  // Allow public pages
  const publicPaths = ["/login", "/logout"];
  if (publicPaths.some((p) => url.pathname.startsWith(p))) {
    return { authenticated: !!token };
  }
  if (!token) {
    throw redirect(302, "/login");
  }
  return { authenticated: true };
};
```

- [ ] **Step 2: Write a basic +layout.svelte**

```svelte
<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet; data?: any } = $props();
</script>

<header class="topnav">
  <div class="brand">
    <img src="/veesker-logo.png" width="28" height="28" alt="" />
    <span>veesker cloud</span>
  </div>
  <nav>
    <a href="/connections">Connections</a>
    <a href="/audit">Audit</a>
    <a href="/users">Users</a>
    <a href="/tokens">Tokens</a>
    <a href="/settings">Settings</a>
    <a href="/logout">Logout</a>
  </nav>
</header>

<main class="container">
  {@render children()}
</main>

<style>
  .topnav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 24px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex; gap: 8px; align-items: center;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 16px;
  }
  nav { display: flex; gap: 16px; }
  nav a { color: var(--text-muted); font-size: 13px; }
  nav a:hover { color: var(--text-primary); text-decoration: none; }
</style>
```

- [ ] **Step 3: Create login form (+page.svelte)**

`src/routes/login/+page.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { form }: { form?: { error?: string } } = $props();
</script>

<svelte:head><title>Login — Veesker Cloud</title></svelte:head>

<div class="login-wrap">
  <div class="login-card">
    <h1>Sign in</h1>
    <form method="POST" use:enhance>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="email" />
      <label for="orgSlug">Organization slug</label>
      <input id="orgSlug" name="orgSlug" required autocomplete="organization" />
      {#if form?.error}
        <p class="error">{form.error}</p>
      {/if}
      <button type="submit" class="btn primary">Sign in</button>
    </form>
  </div>
</div>

<style>
  .login-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(100vh - 56px);
  }
  .login-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 32px;
    width: 360px;
  }
  h1 { margin-top: 0; font-size: 22px; }
  label { margin-top: 12px; }
  button { margin-top: 18px; width: 100%; }
</style>
```

- [ ] **Step 4: Create form action (+page.server.ts)**

`src/routes/login/+page.server.ts`:
```typescript
import { fail, redirect } from "@sveltejs/kit";
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE, tokenCookieAttributes } from "$lib/auth";

export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = String(data.get("email") ?? "");
    const orgSlug = String(data.get("orgSlug") ?? "");
    if (!email || !orgSlug) return fail(400, { error: "Email and organization required" });

    const res = await apiFetch<{ token: string; user: any }>("/v1/auth/stub-login", {
      method: "POST",
      body: { email, orgSlug },
    });
    if (!res.ok) return fail(res.error.status, { error: res.error.message });

    cookies.set(TOKEN_COOKIE, res.data.token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });
    throw redirect(303, "/connections");
  },
};
```

- [ ] **Step 5: Verify build + smoke**

```bash
bun run build
bun run dev
```
Browser → http://localhost:5173 should redirect to /login. Try submitting → should call API (with a running api.veesker.cloud-cloud locally OR pointed via VEESKER_API_BASE env var).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): login page + form action + auth-guard layout"
```

---

## Task 4: Logout + connections list

**Files:**
- Create: `src/routes/logout/+server.ts`
- Create: `src/routes/connections/+page.svelte`
- Create: `src/routes/connections/+page.server.ts`

- [ ] **Step 1: Create /logout endpoint**

`src/routes/logout/+server.ts`:
```typescript
import { redirect } from "@sveltejs/kit";
import { TOKEN_COOKIE } from "$lib/auth";

export const GET = async ({ cookies }) => {
  cookies.delete(TOKEN_COOKIE, { path: "/" });
  throw redirect(303, "/login");
};
```

- [ ] **Step 2: Create connections list +page.server.ts**

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";
import type { Connection } from "$lib/types";

export const load = async ({ cookies }) => {
  const token = cookies.get(TOKEN_COOKIE);
  const res = await apiFetch<{ connections: Connection[] }>("/v1/connections", { token });
  if (!res.ok) {
    return { connections: [], error: res.error.message };
  }
  return { connections: res.data.connections, error: null };
};
```

- [ ] **Step 3: Create connections list +page.svelte**

```svelte
<script lang="ts">
  import type { Connection } from "$lib/types";

  let { data }: { data: { connections: Connection[]; error: string | null } } = $props();
</script>

<svelte:head><title>Connections — Veesker Cloud</title></svelte:head>

<div class="header">
  <h1>Connections</h1>
  <a href="/connections/new" class="btn primary">+ New connection</a>
</div>

{#if data.error}
  <div class="error-banner">{data.error}</div>
{:else if data.connections.length === 0}
  <p class="muted">No connections yet. Click "New connection" to add the first one.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Environment</th>
        <th>Type</th>
        <th>Host / Alias</th>
        <th>User</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each data.connections as conn (conn.id)}
        <tr>
          <td><a href="/connections/{conn.id}">{conn.name}</a></td>
          <td><span class="env env--{conn.environment}">{conn.environment}</span></td>
          <td>{conn.authType}</td>
          <td>{conn.host ?? conn.connectAlias ?? "—"}</td>
          <td>{conn.username}</td>
          <td><a href="/connections/{conn.id}">Edit</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--text-muted); font-weight: 600; }
  .env { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .env--prod { background: rgba(196, 74, 74, 0.18); color: var(--error); }
  .env--staging { background: rgba(195, 166, 110, 0.18); color: var(--warn); }
  .env--hml { background: rgba(195, 166, 110, 0.12); color: var(--warn); }
  .env--dev { background: rgba(139, 196, 168, 0.18); color: var(--ok); }
  .error-banner { padding: 12px; background: rgba(196, 74, 74, 0.18); color: var(--error); border-radius: 6px; }
</style>
```

- [ ] **Step 4: Smoke + commit**

```bash
bun run dev
# verify after login you land on /connections; if API has connections they render
git add -A
git commit -m "feat(connections): list view + logout endpoint"
```

---

## Task 5: Connection detail / edit / delete

**Files:**
- Create: `src/routes/connections/[id]/+page.svelte`
- Create: `src/routes/connections/[id]/+page.server.ts`

- [ ] **Step 1: +page.server.ts**

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Connection } from "$lib/types";

export const load = async ({ params, cookies }) => {
  const token = cookies.get(TOKEN_COOKIE);
  const res = await apiFetch<{ connection: Connection }>(`/v1/connections/${params.id}`, { token });
  if (!res.ok) return { connection: null, error: res.error.message };
  return { connection: res.data.connection, error: null };
};

export const actions = {
  update: async ({ request, params, cookies }) => {
    const token = cookies.get(TOKEN_COOKIE);
    const data = await request.formData();
    const body = {
      name: String(data.get("name") ?? ""),
      environment: String(data.get("environment") ?? "dev"),
      host: String(data.get("host") ?? ""),
      port: Number(data.get("port") ?? 1521),
      serviceName: String(data.get("serviceName") ?? ""),
      username: String(data.get("username") ?? ""),
      comments: String(data.get("comments") ?? ""),
    };
    const res = await apiFetch(`/v1/connections/${params.id}`, { method: "PUT", body, token });
    if (!res.ok) return fail(res.error.status, { error: res.error.message, body });
    return { saved: true };
  },
  delete: async ({ params, cookies }) => {
    const token = cookies.get(TOKEN_COOKIE);
    const res = await apiFetch(`/v1/connections/${params.id}`, { method: "DELETE", token });
    if (!res.ok) return fail(res.error.status, { error: res.error.message });
    throw redirect(303, "/connections");
  },
};
```

- [ ] **Step 2: +page.svelte**

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { Connection } from "$lib/types";

  let { data, form }: { data: { connection: Connection | null; error: string | null }; form?: any } = $props();
  let confirmingDelete = $state(false);
</script>

<svelte:head><title>{data.connection?.name ?? "Connection"} — Veesker Cloud</title></svelte:head>

{#if !data.connection}
  <p class="error">{data.error ?? "Connection not found"}</p>
  <a href="/connections" class="btn">← Back to connections</a>
{:else}
  <div class="header">
    <h1>{data.connection.name}</h1>
    <a href="/connections" class="muted">← All connections</a>
  </div>

  <form method="POST" action="?/update" use:enhance>
    <div class="grid">
      <div>
        <label for="name">Name</label>
        <input id="name" name="name" value={data.connection.name} required />
      </div>
      <div>
        <label for="environment">Environment</label>
        <select id="environment" name="environment" value={data.connection.environment}>
          <option value="dev">Dev</option>
          <option value="hml">HML</option>
          <option value="staging">Staging</option>
          <option value="prod">Prod</option>
        </select>
      </div>
      <div>
        <label for="host">Host</label>
        <input id="host" name="host" value={data.connection.host ?? ""} />
      </div>
      <div>
        <label for="port">Port</label>
        <input id="port" name="port" type="number" value={data.connection.port ?? 1521} />
      </div>
      <div>
        <label for="serviceName">Service Name</label>
        <input id="serviceName" name="serviceName" value={data.connection.serviceName ?? ""} />
      </div>
      <div>
        <label for="username">Username</label>
        <input id="username" name="username" value={data.connection.username} required />
      </div>
    </div>
    <label for="comments">Comments</label>
    <textarea id="comments" name="comments" rows="3">{data.connection.comments ?? ""}</textarea>
    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
    {#if form?.saved}
      <p class="muted">Saved.</p>
    {/if}
    <div class="actions">
      <button type="submit" class="btn primary">Save</button>
      {#if !confirmingDelete}
        <button type="button" class="btn danger" onclick={() => (confirmingDelete = true)}>Delete connection</button>
      {:else}
        <span class="muted">Confirm delete?</span>
        <button type="button" class="btn" onclick={() => (confirmingDelete = false)}>Cancel</button>
        <button type="submit" formaction="?/delete" class="btn danger">Yes, delete</button>
      {/if}
    </div>
  </form>
{/if}

<style>
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  textarea { font-family: inherit; resize: vertical; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 24px; }
</style>
```

- [ ] **Step 3: Smoke + commit**

```bash
bun run dev
# click into a connection, edit, save, also try delete with confirm
git add -A
git commit -m "feat(connections): detail page with update + delete form actions"
```

---

## Task 6: Connection create form

**Files:**
- Create: `src/routes/connections/new/+page.svelte`
- Create: `src/routes/connections/new/+page.server.ts`

- [ ] **Step 1: +page.server.ts**

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";
import { fail, redirect } from "@sveltejs/kit";

export const actions = {
  default: async ({ request, cookies }) => {
    const token = cookies.get(TOKEN_COOKIE);
    const data = await request.formData();
    const body = {
      name: String(data.get("name") ?? ""),
      environment: String(data.get("environment") ?? "dev"),
      authType: "basic",
      host: String(data.get("host") ?? ""),
      port: Number(data.get("port") ?? 1521),
      serviceName: String(data.get("serviceName") ?? ""),
      username: String(data.get("username") ?? ""),
      comments: String(data.get("comments") ?? ""),
    };
    if (!body.name || !body.host || !body.username) return fail(400, { error: "Name, host, username required", body });
    const res = await apiFetch<{ connection: { id: string } }>("/v1/connections", { method: "POST", body, token });
    if (!res.ok) return fail(res.error.status, { error: res.error.message, body });
    throw redirect(303, `/connections/${res.data.connection.id}`);
  },
};
```

- [ ] **Step 2: +page.svelte**

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { form }: { form?: any } = $props();
</script>

<svelte:head><title>New connection — Veesker Cloud</title></svelte:head>

<h1>New connection</h1>
<p class="muted">Connection passwords are NOT stored in the cloud. The desktop client fetches the password from the local OS keychain when opening this connection.</p>

<form method="POST" use:enhance>
  <div class="grid">
    <div>
      <label for="name">Name</label>
      <input id="name" name="name" value={form?.body?.name ?? ""} required />
    </div>
    <div>
      <label for="environment">Environment</label>
      <select id="environment" name="environment" value={form?.body?.environment ?? "dev"}>
        <option value="dev">Dev</option>
        <option value="hml">HML</option>
        <option value="staging">Staging</option>
        <option value="prod">Prod</option>
      </select>
    </div>
    <div>
      <label for="host">Host</label>
      <input id="host" name="host" value={form?.body?.host ?? ""} required />
    </div>
    <div>
      <label for="port">Port</label>
      <input id="port" name="port" type="number" value={form?.body?.port ?? 1521} />
    </div>
    <div>
      <label for="serviceName">Service Name</label>
      <input id="serviceName" name="serviceName" value={form?.body?.serviceName ?? ""} />
    </div>
    <div>
      <label for="username">Username</label>
      <input id="username" name="username" value={form?.body?.username ?? ""} required />
    </div>
  </div>
  <label for="comments">Comments</label>
  <textarea id="comments" name="comments" rows="3">{form?.body?.comments ?? ""}</textarea>
  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}
  <div class="actions">
    <button type="submit" class="btn primary">Create</button>
    <a href="/connections" class="btn">Cancel</a>
  </div>
</form>

<style>
  h1 { font-size: 22px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  textarea { font-family: inherit; resize: vertical; }
  .actions { display: flex; gap: 8px; margin-top: 24px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(connections): create form"
```

---

## Task 7: Audit log query page

**Files:**
- Create: `src/routes/audit/+page.svelte`
- Create: `src/routes/audit/+page.server.ts`

- [ ] **Step 1: +page.server.ts**

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";
import type { AuditEntry } from "$lib/types";

export const load = async ({ cookies, url }) => {
  const token = cookies.get(TOKEN_COOKIE);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const search = url.searchParams.get("search") ?? "";
  const successFilter = url.searchParams.get("success") ?? "";
  const body: any = { limit, offset };
  if (search) body.search = search;
  if (successFilter === "true" || successFilter === "false") body.success = successFilter === "true";
  const res = await apiFetch<{ entries: AuditEntry[]; limit: number; offset: number }>(
    "/v1/audit/query",
    { method: "POST", body, token },
  );
  if (!res.ok) return { entries: [], error: res.error.message, limit, offset, search, successFilter };
  return { entries: res.data.entries, error: null, limit, offset, search, successFilter };
};
```

- [ ] **Step 2: +page.svelte**

```svelte
<script lang="ts">
  import type { AuditEntry } from "$lib/types";

  let { data }: { data: {
    entries: AuditEntry[]; error: string | null; limit: number; offset: number; search: string; successFilter: string;
  } } = $props();

  function formatTime(s: string): string {
    const d = new Date(s);
    return d.toLocaleString();
  }
  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
</script>

<svelte:head><title>Audit log — Veesker Cloud</title></svelte:head>

<h1>Audit log</h1>

<form method="GET" class="filters">
  <input name="search" placeholder="search SQL or user…" value={data.search} />
  <select name="success">
    <option value="">All results</option>
    <option value="true" selected={data.successFilter === "true"}>Success only</option>
    <option value="false" selected={data.successFilter === "false"}>Failures only</option>
  </select>
  <button type="submit" class="btn">Filter</button>
</form>

{#if data.error}
  <p class="error">{data.error}</p>
{:else if data.entries.length === 0}
  <p class="muted">No matching entries.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>When</th>
        <th>User</th>
        <th>Connection</th>
        <th>Status</th>
        <th>Rows</th>
        <th>ms</th>
        <th>SQL</th>
      </tr>
    </thead>
    <tbody>
      {#each data.entries as e (e.id)}
        <tr class:fail={!e.success}>
          <td>{formatTime(e.occurredAt)}</td>
          <td>{e.userEmail}</td>
          <td>{e.connectionName ?? e.host ?? "—"}</td>
          <td>{e.success ? "ok" : "error"}</td>
          <td>{e.rowCount ?? "—"}</td>
          <td>{e.elapsedMs}</td>
          <td><code>{truncate(e.sqlText, 80)}</code></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="pagination">
    {#if data.offset > 0}
      <a class="btn" href="?limit={data.limit}&offset={Math.max(0, data.offset - data.limit)}&search={data.search}&success={data.successFilter}">← Newer</a>
    {/if}
    {#if data.entries.length === data.limit}
      <a class="btn" href="?limit={data.limit}&offset={data.offset + data.limit}&search={data.search}&success={data.successFilter}">Older →</a>
    {/if}
  </div>
{/if}

<style>
  h1 { font-size: 24px; }
  .filters { display: flex; gap: 8px; margin-bottom: 16px; }
  .filters input { flex: 1; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
  th { color: var(--text-muted); font-weight: 600; }
  tr.fail { background: rgba(196, 74, 74, 0.08); }
  code { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--text-primary); }
  .pagination { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(audit): query page with filters and pagination"
```

---

## Task 8: Audit stats dashboard

**Files:**
- Create: `src/routes/audit/stats/+page.svelte`
- Create: `src/routes/audit/stats/+page.server.ts`

- [ ] **Step 1: +page.server.ts**

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";

export const load = async ({ cookies, url }) => {
  const token = cookies.get(TOKEN_COOKIE);
  const days = Math.min(Number(url.searchParams.get("days") ?? 7), 90);
  const res = await apiFetch<any>(`/v1/audit/stats?days=${days}`, { token });
  if (!res.ok) return { stats: null, error: res.error.message, days };
  return { stats: res.data, error: null, days };
};
```

- [ ] **Step 2: +page.svelte**

```svelte
<script lang="ts">
  let { data }: { data: { stats: any; error: string | null; days: number } } = $props();
</script>

<svelte:head><title>Audit stats — Veesker Cloud</title></svelte:head>

<div class="header">
  <h1>Audit stats</h1>
  <select name="days" onchange={(e) => location.search = `?days=${(e.target as HTMLSelectElement).value}`}>
    <option value="1" selected={data.days === 1}>Last 24h</option>
    <option value="7" selected={data.days === 7}>Last 7 days</option>
    <option value="30" selected={data.days === 30}>Last 30 days</option>
    <option value="90" selected={data.days === 90}>Last 90 days</option>
  </select>
</div>

{#if data.error}
  <p class="error">{data.error}</p>
{:else if data.stats}
  <div class="grid">
    <div class="card">
      <div class="label">Total queries</div>
      <div class="value">{data.stats.total ?? 0}</div>
    </div>
    <div class="card">
      <div class="label">Failures</div>
      <div class="value" style="color: var(--error)">{data.stats.failures ?? 0}</div>
    </div>
    <div class="card">
      <div class="label">Avg elapsed (ms)</div>
      <div class="value">{Math.round(data.stats.avgElapsedMs ?? 0)}</div>
    </div>
  </div>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
  .label { color: var(--text-muted); font-size: 12px; }
  .value { font-size: 30px; font-weight: 600; margin-top: 4px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(audit): stats dashboard with totals and failures"
```

---

## Task 9: Users page (list + invite)

**Files:**
- Create: `src/routes/users/+page.svelte` + `+page.server.ts`
- Create: `src/routes/users/new/+page.svelte` + `+page.server.ts`

(For brevity here, follow the same pattern as `/connections` — list + invite form. The create endpoint is `POST /v1/orgs/users` per the spec.)

- [ ] Create the 4 files using the patterns from Tasks 4 + 6 (list + create-form).

- [ ] Commit:
```bash
git add -A
git commit -m "feat(users): member list + invite form"
```

---

## Task 10: API tokens page (REQUIRES backend changes first)

**Backend changes (in `gevianajr/veesker-cloud` repo, NOT this repo):**

- [ ] **Step 1: Create `server/src/routes/tokens.ts`** in the veesker-cloud repo:

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db/client";
import { authRequired } from "../auth/middleware";
import crypto from "node:crypto";

export const tokensRoute = new Hono();
tokensRoute.use("*", authRequired);

tokensRoute.get("/", async (c) => {
  const { sub: userId } = c.get("user") as any;
  const rows = await sql`
    SELECT id, name, expires_at, last_used_at, created_at
      FROM api_tokens
     WHERE user_id = ${userId}
     ORDER BY created_at DESC
  `;
  return c.json({ tokens: rows });
});

const CreateBody = z.object({ name: z.string().min(1).max(64), expiresInDays: z.number().int().min(1).max(365).optional() });

tokensRoute.post("/", async (c) => {
  const { sub: userId, org: orgId } = c.get("user") as any;
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
  const tokenPlain = `vsk_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = crypto.createHash("sha256").update(tokenPlain).digest("hex");
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const [row] = await sql`
    INSERT INTO api_tokens (org_id, user_id, name, token_hash, expires_at)
    VALUES (${orgId}, ${userId}, ${parsed.data.name}, ${tokenHash}, ${expiresAt})
    RETURNING id, name, expires_at, created_at
  `;
  return c.json({ token: { ...row, plaintext: tokenPlain } });
});

tokensRoute.delete("/:id", async (c) => {
  const { sub: userId } = c.get("user") as any;
  const id = c.req.param("id");
  await sql`DELETE FROM api_tokens WHERE id = ${id} AND user_id = ${userId}`;
  return c.json({ deleted: id });
});
```

- [ ] **Step 2: Wire route in `server/src/index.ts`** (veesker-cloud repo):

```typescript
import { tokensRoute } from "./routes/tokens";
// ...
app.route("/v1/tokens", tokensRoute);
```

- [ ] **Step 3: Commit + push veesker-cloud:**

```bash
cd /c/Users/geefa/Documents/veesker-cloud
git add server/src/routes/tokens.ts server/src/index.ts
git commit -m "feat(api): personal access tokens endpoints"
git push
```

**Frontend in veesker-app:**

- [ ] **Step 4: Create `src/routes/tokens/+page.server.ts`** mirroring the connections list pattern:

```typescript
import { apiFetch } from "$lib/api";
import { TOKEN_COOKIE } from "$lib/auth";
import { fail } from "@sveltejs/kit";
import type { ApiToken } from "$lib/types";

export const load = async ({ cookies }) => {
  const token = cookies.get(TOKEN_COOKIE);
  const res = await apiFetch<{ tokens: ApiToken[] }>("/v1/tokens", { token });
  if (!res.ok) return { tokens: [], error: res.error.message };
  return { tokens: res.data.tokens, error: null };
};

export const actions = {
  create: async ({ request, cookies }) => {
    const token = cookies.get(TOKEN_COOKIE);
    const data = await request.formData();
    const body = { name: String(data.get("name") ?? "") };
    if (!body.name) return fail(400, { error: "Name required" });
    const res = await apiFetch<{ token: ApiToken & { plaintext: string } }>("/v1/tokens", { method: "POST", body, token });
    if (!res.ok) return fail(res.error.status, { error: res.error.message });
    return { plaintext: res.data.token.plaintext, name: res.data.token.name };
  },
  revoke: async ({ request, cookies }) => {
    const token = cookies.get(TOKEN_COOKIE);
    const data = await request.formData();
    const id = String(data.get("id") ?? "");
    const res = await apiFetch(`/v1/tokens/${id}`, { method: "DELETE", token });
    if (!res.ok) return fail(res.error.status, { error: res.error.message });
    return { revoked: true };
  },
};
```

- [ ] **Step 5: Create `src/routes/tokens/+page.svelte`** with create form, list with revoke buttons, and a one-time-shown plaintext panel after successful creation.

(Markup pattern: simple form, list with `<form>` rows for revoke, conditional banner showing the plaintext after `form?.plaintext` is set. Style similar to /connections.)

- [ ] **Step 6: Commit:**

```bash
cd /c/Users/geefa/Documents/veesker-app
git add -A
git commit -m "feat(tokens): personal access token management page"
```

---

## Task 11: Settings page (org + profile)

**Files:**
- Create: `src/routes/settings/+page.svelte`
- Create: `src/routes/settings/+page.server.ts`

- [ ] **Step 1: +page.server.ts loads `/v1/orgs/me`** and accepts a form action to update the user's display name (PUT /v1/orgs/users/:id — confirm endpoint exists or add).

- [ ] **Step 2: +page.svelte renders org name + slug + tier as read-only, then a profile form for displayName.**

- [ ] **Step 3: Commit:**

```bash
git add -A
git commit -m "feat(settings): org and profile page"
```

---

## Task 12: 404, error pages, CSP headers

**Files:**
- Create: `src/routes/+error.svelte`
- Modify: `wrangler.jsonc` — add HTTP headers for CSP

- [ ] **Step 1: Error page**

`src/routes/+error.svelte`:
```svelte
<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head><title>Error — Veesker Cloud</title></svelte:head>

<div class="err">
  <h1>{page.status} {page.error?.message ?? ""}</h1>
  <p class="muted">Something went wrong. Try going back to the <a href="/connections">connections page</a>.</p>
</div>

<style>
  .err { text-align: center; padding: 80px 20px; }
  h1 { font-size: 28px; }
</style>
```

- [ ] **Step 2: Add CSP headers in wrangler.jsonc**

```jsonc
{
  ...,
  "assets": {
    ...,
    "headers": "/_headers"
  }
}
```

Then create `static/_headers` (Cloudflare Pages-style headers file):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' https://api.veesker.cloud; frame-src 'none'; object-src 'none'; base-uri 'self';
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

- [ ] **Step 3: Commit:**

```bash
git add -A
git commit -m "feat(polish): 404 page + CSP + security headers"
```

---

## Task 13: Cloudflare deploy

- [ ] **Step 1: Push veesker-app to GitHub if not already.**

- [ ] **Step 2: In Cloudflare dashboard → Workers & Pages → Create → Connect to Git → select `gevianajr/veesker-app`.**

- [ ] **Step 3: Build settings:**
- Project name: `veesker-app`
- Production branch: `main`
- Framework preset: SvelteKit
- Build command: `bun install && bun run build`
- Build output directory: `build`
- Environment variables: none (production API URL is hardcoded; dev override via `VEESKER_API_BASE` in `.env`)

- [ ] **Step 4: Save and Deploy.** Verify it goes live at `https://veesker-app.<subdomain>.workers.dev`.

- [ ] **Step 5: Add custom domain.**
Cloudflare Workers → veesker-app → Settings → Domains & Routes → Add custom domain → `app.veesker.cloud`. Cloudflare manages routing internally (do not add a manual CNAME — that conflicts with Workers Custom Domain).

- [ ] **Step 6: Smoke test the deployed app.**
Visit `https://app.veesker.cloud`, log in with `geefatec@gmail.com` + `veesker` (the seeded admin from earlier), confirm:
- Login redirects to /connections
- Connections list loads (may be empty)
- Audit log loads (will be empty if no clients have ingested yet)
- Create a connection works
- Logout works

- [ ] **Step 7: Update memory file** in `~/.claude/projects/...veesker.../memory/`:

Update `project_repo_structure.md` and `project_deploy_state.md` to record `gevianajr/veesker-app` and `app.veesker.cloud` as live.

---

## Coverage matrix

| Spec section | Implemented in |
|---|---|
| Login flow | Tasks 1-3 |
| Connection inventory (list + CRUD) | Tasks 4-6 |
| Audit log viewer | Task 7 |
| Audit stats | Task 8 |
| Users / roles | Task 9 |
| API tokens | Task 10 |
| Settings | Task 11 |
| 404 / error / CSP | Task 12 |
| Deploy at app.veesker.cloud | Task 13 |

All MVP requirements covered. v0.2 features (SAML, multi-org, etc.) explicitly deferred per spec.

---

## Done criteria

- All 13 tasks have all checkboxes ticked.
- `bun run check` shows zero errors.
- `bun run build` succeeds.
- The deployed `https://app.veesker.cloud` is reachable, login works against `https://api.veesker.cloud`, all 5 main pages render.
- Memory files updated.
