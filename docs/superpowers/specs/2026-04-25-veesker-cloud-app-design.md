# Veesker Cloud Web Dashboard — Design Spec

**Date:** 2026-04-25
**Target:** `app.veesker.cloud` (Cloudflare Workers Static Assets)
**Repo:** `gevianajr/veesker-app` (NEW, private)
**Status:** Approved (architectural decisions taken in 2026-04-25 sessions)

## Summary

Web dashboard at `app.veesker.cloud` that lets organization admins manage Veesker Cloud assets (connections, users, API tokens, audit logs) from any browser, without installing the desktop IDE. Authenticates against the existing Hono REST API at `api.veesker.cloud` via JWT, mirrors the data model already in Postgres, and runs as a Cloudflare Workers Static Assets project (same deployment style as the marketing site at `veesker.cloud`).

## Goals (v0.1 MVP)

- **Login:** stub login (email + org slug) issuing a JWT — same flow as the desktop app's future cloud sync.
- **Connection inventory:** list, view, create, edit, delete shared Oracle connections. Mirrors the `connections` table in Postgres.
- **Audit log viewer:** time-bounded query of `audit_entries` with filters (user, connection, success/failure, search term) and pagination.
- **Users & roles:** list members of the org, see their roles (viewer/developer/dba/admin), invite a new user (creates a row + admin emails the credentials manually for v0.1).
- **API tokens:** list user's own personal access tokens, create/revoke. Tokens authenticate the desktop IDE against the cloud API.
- **Settings:** view org details (name, slug, tier), update display name on profile.

## Non-goals (v0.1)

- SAML/OIDC SSO (deferred to v0.2 — backend route exists in spec but not implemented)
- Approval-request workflow (rows exist in DB; UI deferred)
- Connection grants per-user (DB supports it; UI deferred)
- Billing / Stripe integration (deferred to commercial GA)
- Multi-org switching (one user → one org for MVP; multi-org follows commercial GA)
- Self-service signup (admins manually seed users via SQL or invite)

## Architecture decision: subdomain over path

`app.veesker.cloud`, NOT `veesker.cloud/app`. Reasoning:

- **Cookie isolation** — JWT in HttpOnly cookie scoped to `app.veesker.cloud` does not leak to marketing pages. Path-based scoping (`/app`) shares the parent cookie jar.
- **CSP independence** — dashboard's CSP can allow `connect-src api.veesker.cloud` without affecting marketing site CSP.
- **Deploy independence** — dashboard ships on its own cadence; marketing changes don't risk breaking the app.
- **Industry standard** — Stripe (`dashboard.stripe.com`), Linear (`linear.app`), Notion (`notion.so` + `app.notion.so`), Vercel (`vercel.com` + `app.vercel.app`).
- **CDN routing** — Cloudflare DNS maps `app.veesker.cloud` to a separate Worker; marketing remains pinned to `veesker.cloud`. Both cached independently.

Trade-off accepted: an extra DNS record. One-time setup; zero ongoing cost.

## Stack

- **SvelteKit 5 + Svelte 5 runes** (matches desktop + marketing — single skill set)
- **TypeScript strict**
- **Tailwind?** No — match marketing site's pattern (CSS variables + scoped Svelte styles). One less dependency.
- **Auth:** JWT in HttpOnly+Secure cookie, set by `/v1/auth/stub-login` (modify slightly to support cookie path; today returns JSON)
- **API:** fetch from `https://api.veesker.cloud` directly. CORS already allows any origin (server already configured per `infra` work).
- **Deploy:** Cloudflare Workers Static Assets via `wrangler.jsonc`, same pattern as `veesker-site`. Custom domain `app.veesker.cloud` mapped via Cloudflare Custom Domain (NOT manual CNAME — Cloudflare manages routing internally).
- **Repo:** NEW private repo `gevianajr/veesker-app` at `C:\Users\geefa\Documents\veesker-app\`.

## User flow

1. User visits `https://app.veesker.cloud`.
2. If no valid JWT cookie → redirected to `/login`.
3. User enters email + org slug → server calls `POST api.veesker.cloud/v1/auth/stub-login`, gets JWT, stores in HttpOnly cookie scoped to `.app.veesker.cloud`.
4. Redirect to `/connections` (default landing).
5. User browses connections, audit log, users, tokens, settings via top-nav.
6. Logout button clears the cookie and bounces to `/login`.

## Data model

The dashboard does not own data. It calls:

- `POST /v1/auth/stub-login` — login (existing)
- `GET /v1/orgs/me` — current org + user info (existing)
- `GET /v1/orgs/users` — list org users (existing)
- `POST /v1/orgs/users` — create a user (existing, admin-only) — for v0.1 invite flow
- `GET /v1/connections` — list connections (existing)
- `GET /v1/connections/:id` — get one (existing)
- `POST /v1/connections` — create (existing, dba/admin)
- `DELETE /v1/connections/:id` — delete (existing)
- `POST /v1/audit/query` — paginated audit log (existing)
- `GET /v1/audit/stats` — top-N panel for the audit tab (existing)
- (NEW) `GET /v1/tokens` — list current user's personal tokens — adds to `api.veesker.cloud`
- (NEW) `POST /v1/tokens` — create a token, returns plaintext once
- (NEW) `DELETE /v1/tokens/:id` — revoke

Three new endpoints land in the existing `veesker-cloud` repo's `auth.ts` (or a new `tokens.ts`); not in this dashboard repo.

## Pages

| Path | Purpose | Required role |
|---|---|---|
| `/login` | email + org slug form, returns JWT cookie on success | none |
| `/` | redirects to `/connections` | logged in |
| `/connections` | list of connections + new/edit/delete | viewer+ to read; dba/admin to write |
| `/connections/:id` | detail + edit form | viewer+ |
| `/connections/new` | create form | dba/admin |
| `/audit` | audit log viewer with filters + pagination | viewer+ |
| `/audit/stats` | dashboard with top users/connections/error rates | viewer+ |
| `/users` | org member list + roles + invite button | admin |
| `/users/new` | invite form (creates DB row, admin distributes password manually) | admin |
| `/tokens` | current user's API tokens | self |
| `/settings` | org info + user profile | self |
| `/logout` | clears cookie, redirects to `/login` | logged in |

## Auth flow detail

- `/login` POSTs to a SvelteKit form action handler at `/login/+page.server.ts`.
- The handler proxies to `api.veesker.cloud/v1/auth/stub-login`, gets JWT.
- Sets cookie `vsk_token` with `httpOnly`, `secure`, `sameSite=lax`, `domain=.veesker.cloud` (so subdomains share if needed in the future), `maxAge=7d` matching JWT expiry.
- Cookie value is sent on every API call by the SvelteKit `+page.server.ts` and `+server.ts` handlers (server-side fetch from Worker, NOT from browser).
- Browser never directly hits `api.veesker.cloud` — server-side proxies. This avoids CORS preflights and keeps tokens out of JS.
- For lightweight read pages we can later switch to direct browser fetches with token-bearer; the server-side pattern is conservative for v0.1.

## Error handling

- **Network failures:** SvelteKit error boundaries — show friendly message + retry button.
- **401/403 from API:** redirect to `/login` (token expired or revoked).
- **404:** SvelteKit's `+error.svelte` page.
- **500:** error page with link to status (or contact email).
- **Validation errors from API:** inline form messages.

## CSP

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data:;
connect-src 'self' https://api.veesker.cloud;
frame-src 'none';
object-src 'none';
base-uri 'self';
```

Set in `wrangler.jsonc` headers config OR in SvelteKit hooks. Headers preferred (Worker-level, fewer chances to forget).

## Testing strategy

- **Unit:** Vitest for utility functions (e.g., role-guard helpers, date formatters).
- **Component:** `@testing-library/svelte` for the auth-guard layout, login form validation, audit filter state.
- **E2E (deferred to v0.2):** Playwright against a staging API.

## Out of scope checklist (v0.2+)

- SAML / OIDC providers
- Self-serve signup
- Multi-org membership
- Approval-request workflow UI
- Connection sharing UI (grants table)
- Audit log export to CSV
- Real-time subscriptions (websockets / SSE) for live updates
- Mobile-optimized layout (v0.1 is desktop-first)
- I18n / Portuguese locale
- Stripe billing
- Custom domains for white-label deployments

## Open questions

None at design-approval time — every architectural choice has been validated against the existing veesker-cloud API surface, the marketing site deployment pattern, and CLAUDE.md project conventions.

## References

- Existing API (Hono): `gevianajr/veesker-cloud` repo, `server/src/routes/*`
- Existing marketing site (deploy template): `gevianajr/veesker-site` repo, `wrangler.jsonc` + `+layout.svelte`
- DNS / Cloudflare routing: `api.veesker.cloud` already configured (DNS only, Railway TLS)
- Brand assets: `static/veesker-logo.png` (copied from `veesker/static`)
