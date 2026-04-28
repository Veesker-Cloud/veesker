# Veesker CE / SaaS Split — Implementation Design v2

> **For agentic workers:** Use `superpowers:writing-plans` to turn this spec into an implementation plan, then `superpowers:subagent-driven-development` to execute phase by phase.

**Date:** 2026-04-28
**Supersedes:** `2026-04-28-ce-saas-split-design.md` (v1, replaced by this document)

---

## Principle

Community Edition is a complete, standalone Oracle IDE — free forever. Veesker Cloud adds a managed intelligence layer on top. Nothing is removed from CE; AI tools and schema-aware context are Cloud-only because they generate cost and are the primary monetization lever.

**Rule:** if a feature generates cost (AI inference, embeddings infra) or requires managed control (billing, usage tracking) → Cloud. If it drives adoption and works standalone → CE.

---

## Feature Classification

### Community Edition — free forever (Apache 2.0)

**IDE Core**
- SQL Editor multi-statement, tabs, .sql files
- Schema Browser, Object/Table Inspector
- Connections: Thin / Thick / Wallet / Multi-PDB
- Run / Cancel SQL, Result Grid, Cursor Grid
- Query History (local SQLite), Local Audit Log (JSONL)
- Dark/Light mode, Command Palette, Auto-update

**Productivity**
- SQL Beautifier, Floating dock toolbar
- Terminal PTY (xterm.js)
- Transaction commit/rollback management
- DML protection modals
- Object Versioning (git2 + SQLite + diff flyout)

**Oracle PL/SQL**
- EXPLAIN PLAN
- PL/SQL Editor + Compile + Errors panel
- PL/SQL Outline, Package Editor (spec/body)
- DBMS_OUTPUT capture, Procedure execution
- Debugger: step / breakpoints / locals / call stack / variable grid

**VRAS REST Studio**
- Manual builder: CRUD / Custom SQL / Procedure endpoints
- ORDS bootstrap, Module details, Preview, Test panel, OAuth clients
- AI Suggest endpoint (BYOK, text-to-JSON — no DB tools)

**Visualization**
- DataFlow / Visual Flow (FK + code refs)
- Charts manual (click column + type), Dashboard basic

**Vector Search**
- VectorScatter UI (2D PCA scatter)
- Embeddings BYOK: Ollama / OpenAI / Voyage / custom
- DBMS_VECTOR native Oracle 23ai support

**AI — Sheep (BYOK)**
- Explain SQL (text-only, no DB access)
- Generate SQL (text-only, no DB access)
- Context: Active SQL in editor only (no schema, no selected object)
- Fallback: local `claude` CLI if no API key configured

**Performance**
- Perf Banner, Perf Stats local

---

### SaaS Cloud — paid, managed

**AI — Sheep (managed, no key needed)**
- Tools: `run_query`, `describe_object`, `get_ddl`, `list_objects`
- Context: Current schema + Selected object + Active SQL
- Schema-aware system prompt
- Managed Anthropic key (Claude Haiku / Sonnet / Opus per tier)

**AI Intelligence**
- Charts generated via natural language ("show sales by month as bar chart")
- Query optimization: analyze plan + suggest index / rewrite
- Performance analysis (AWR / Statspack patterns)
- Procedure generation (context-aware, grounded in actual schema)
- Debugger AI: runtime execution analysis + compile error suggestions

**Vector Search — managed**
- Embeddings without Ollama or API key setup
- Persistent schema embeddings (auto-ingestion)

**Cloud Operations**
- Query memory (long-term context)
- Smart ambient suggestions
- Team features: shared queries, RBAC
- Usage dashboard + credit billing
- Cloud sync: connections / snippets / history across machines
- Long-term audit retention (>30 days)
- Always-on monitoring + slow query alerts

---

## Access Model

**Single desktop binary for both CE and Cloud.** No separate Cloud IDE.

Users access Cloud by signing in within the desktop app:
- CE: download → install → use (no account needed)
- Cloud: same app → "Sign in to Veesker Cloud" → login → Cloud features unlock

`app.veesker.cloud` is a **management portal** (not an IDE):
- Billing / subscription / Stripe
- Usage dashboard (tokens consumed)
- Team management (invite, RBAC)
- API tokens
- Centralized audit log (long-term retention)
- Settings / profile

Oracle DB connections are always local (sidecar ↔ Oracle direct). Only text payloads (SQL, DDL snippets, query results as JSON) travel to `api.veesker.cloud` for AI processing. Credentials, wallets, and TNS strings never leave the user's machine.

---

## Architecture

Three independent layers — no existing modules moved or deleted.

```
Frontend (SvelteKit)
  features.ts     — capability flags, read by UI to show/hide
  AIService.ts    — selects BYOKProvider or CloudProvider
  LoginModal      — Phase 3: stub; Phase 4: real auth

Sidecar (Bun)
  ai.ts           — aiChat(params, tools: boolean)
                    tools=false → CE (empty tools array)
                    tools=true  → Cloud (4 tools registered)

Cloud (Phase 4)
  api.veesker.cloud/v1/ai/chat    — managed Anthropic proxy
  api.veesker.cloud/v1/ai/charts  — chart generation
  api.veesker.cloud/v1/auth/*     — JWT auth
```

---

## Components

### New files

```
src/lib/services/
  features.ts                   capability flags (all cloud flags false by default)

src/lib/ai/
  AIService.ts                  selects provider, handles fallback
  providers/
    AIProvider.ts               TypeScript interface
    BYOKProvider.ts             current CE behavior, extracted
    CloudProvider.ts            stub (throws "Cloud coming soon") until Phase 4
```

### Modified files

| File | Change |
|---|---|
| `sidecar/src/ai.ts` | `aiChat(params, tools: boolean = false)` — passes `[]` or `TOOLS` |
| `src/lib/workspace/SheepChat.svelte` | calls `AIService.chat()` instead of sidecar directly |
| Result toolbar "Analyze" button (exact component TBD during impl) | checks `FEATURES.aiCharts` — shows Cloud badge if false; `ChartWidget` is renderer only, no change |

### Untouched files

`sidecar/src/oracle.ts`, `sidecar/src/ords.ts`, `sidecar/src/debug.ts`, `sidecar/src/embedding.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/main.rs` — no changes.

---

## Data Flow

### CE — BYOK

```
SheepChat → AIService → BYOKProvider
  → invoke("ai_chat", { apiKey, messages, context: { activeSql } })
  → sidecar: aiChat(params, tools=false)
  → Anthropic API (user's key, tools=[])
  → text response
```

Context sent to Anthropic: Active SQL only. No schema, no object, no DDL.

### Cloud (Phase 4 design)

```
SheepChat → AIService → CloudProvider
  1. pre-fetch context locally if needed:
     invoke("object_ddl_get") → DDL text
     invoke("table_describe") → columns text
  2. POST api.veesker.cloud/v1/ai/chat
     { message, activeSql, ddl?, columns?, jwt }
  3. Cloud: validate JWT, debit credits, call Anthropic (managed key)
  4. If tool_use returned: Cloud asks desktop to execute locally
     desktop runs Oracle query → sends text result back
  5. Loop until end_turn → stream response
```

What travels to Cloud: text strings (SQL, DDL, query rows as JSON).
What never leaves the machine: connection string, password, wallet.

---

## Auth Flow

### Phase 3 (stub)

`LoginModal.svelte` shows "Veesker Cloud coming soon" with link to `veesker.cloud/pricing`. No real auth. `FEATURES` hardcoded to CE defaults.

### Phase 4 (real)

```
POST api.veesker.cloud/v1/auth/login
  → { token: JWT, plan, features: { cloudAI, aiCharts, ... } }

Desktop persists:
  keyring.set("veesker:auth_token", token)   ← OS keychain / Credential Manager
  keyring.set("veesker:features", JSON)

features.ts on app start:
  1. Read token from keyring
  2. Validate expiry locally (works offline)
  3. Apply saved feature flags
  4. Background: GET /v1/auth/me to refresh flags (update if plan changed)
```

JWT validation is local on startup — app works offline. Background refresh keeps plan in sync.

---

## Error Handling

| Situation | Behavior | Fallback to BYOK? |
|---|---|---|
| Network offline + BYOK configured | Use BYOK, info banner in chat | ✅ |
| Network offline + no BYOK | Clear error message | ❌ |
| 401 JWT expired | Clear keyring, reset to CE, show login prompt | ❌ |
| 402 credits exhausted | Error + link to billing | ❌ |
| 500 Cloud server error | Use BYOK if configured, banner | ✅ |
| CE no BYOK configured | Error + CTA "Sign in to Cloud (no key needed)" | ❌ |

Fallback only for network/infra errors. Never for auth or billing errors (would bypass payment).

---

## `features.ts` Structure

```typescript
export const FEATURES = {
  cloudAI: false,           // Sheep with tools + schema-aware
  aiCharts: false,          // Charts via natural language
  aiDebugger: false,        // Debugger runtime analysis
  aiVrasGenerate: true,     // VRAS AI Suggest (CE BYOK ✅)
  managedEmbeddings: false, // Vector without Ollama/key
  teamFeatures: false,      // Shared queries, RBAC
  cloudAudit: false,        // Long-term audit sync
  isLoggedIn: false,
  userTier: 'ce' as 'ce' | 'cloud',
}
```

All cloud flags default `false`. On login, server returns which flags to enable based on plan.

---

## Testing

### Sidecar (Bun test — add to existing suite)

- CE mode: `tools=false` → `TOOLS` array is empty in Anthropic call
- Cloud mode: `tools=true` → 4 tools registered
- `run_query` still blocks DML regardless of `tools` value

### Frontend (Vitest)

- `FEATURES` defaults: all cloud flags `false`, `aiVrasGenerate: true`
- `AIService` selects `BYOKProvider` when `cloudAI=false`
- `AIService` selects `CloudProvider` when `cloudAI=true`
- Fallback fires on `CLOUD_UNAVAILABLE` with BYOK configured
- No fallback on 401 or 402

### Manual checklist before shipping Phase 3

- [ ] CE no BYOK → error with Cloud CTA
- [ ] CE with BYOK → AI responds, no schema context
- [ ] Asking "list my tables" in CE → AI says it has no DB access
- [ ] VRAS AI Suggest → still works (CE BYOK)
- [ ] Manual charts → still work (no AI)
- [ ] AI chart button → shows "Cloud" badge
- [ ] `bun test` sidecar → all tests pass
- [ ] `bun run check` → 0 TypeScript errors
- [ ] `bun run lint` → 0 Biome warnings

---

## Implementation Phases

### Phase 2 — AI Surgical Cut (sidecar)

1. Add `tools: boolean = false` parameter to `aiChat()`
2. Pass `[]` or `TOOLS` based on parameter
3. Update `buildSystem()` to only inject `activeSql` (drop `currentSchema`, `selectedOwner`, `selectedKind`)
4. Update `sidecar/src/handlers.ts` (RPC handler for `ai.chat`) to pass `tools: false`
5. `aiSuggestEndpoint()` unchanged — no tools, stays CE BYOK

### Phase 3 — Provider Abstraction (frontend)

1. Create `features.ts` with CE defaults
2. Create `AIProvider.ts` interface
3. Create `BYOKProvider.ts` (extract from `SheepChat`)
4. Create `CloudProvider.ts` stub
5. Create `AIService.ts` with provider selection + fallback logic
6. Refactor `SheepChat.svelte` to use `AIService`
7. Add Cloud badge to chart AI entry point
8. Add `LoginModal.svelte` stub

### Phase 4 — Cloud Wiring (future)

- Implement real auth flow
- Implement `CloudProvider.ts` with `api.veesker.cloud` calls
- Implement JWT storage + refresh
- Implement `app.veesker.cloud` management portal
- Wire billing hooks (Stripe)

---

## Out of Scope (this spec)

- Billing implementation (Stripe, credit system)
- `app.veesker.cloud` portal build
- Team features / RBAC
- Cloud sync
- Long-term audit retention backend
- VRAS AI in Cloud (deep schema generation)
- Debugger AI real implementation
- OAuth / SSO login
