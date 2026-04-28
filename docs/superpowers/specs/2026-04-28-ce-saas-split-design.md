# Veesker CE/SaaS Split — Implementation Design

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transition Veesker into a hybrid model — Community Edition (Apache 2.0, free forever) + Cloud SaaS (managed AI + billing).

**Architecture:** Four non-breaking phases. Each phase is independently deployable. No features removed from CE; AI tool access split between BYOK-text-only (CE) and schema-aware-execution (Cloud).

**Tech Stack:** SvelteKit 5, Tauri 2, Bun sidecar, @anthropic-ai/sdk, Apache 2.0

---

## Feature Classification

### CE — free forever
- Full SQL/PL/SQL IDE, schema browser, table inspector, explain plan, terminal
- ORDS/VRAS REST Studio, PL/SQL debugger, object versioning, visual flow, charts
- Transaction management, query history, audit log, auto-update
- BYOK AI: explain SQL + generate SQL (text-only, no DB tool access)
- All connections: Thin/Thick, Wallet, multi-PDB

### SaaS Cloud — paid
- Managed AI (no user key needed): schema-aware, run_query, describe_object, get_ddl tools
- Query optimization, performance analysis, procedure generation, debugging AI
- Vector Search Studio (embedding costs)
- Controlled SQL execution sandbox, impact analysis
- Team features, usage dashboard, billing/credits

---

## Phase 1 — CE Identity (repo + branding)

**Goal:** Make CE identity visible immediately. Zero behavior change.

1. Add `audit-report.md` and `.claude/` to `.gitignore`
2. Copy CE logo (`veesker_community.png`) to `static/`
3. Rewrite `README.md` with CE branding, feature table, logo, Apache 2.0 badge
4. Update `CHANGELOG.md` — v0.2.0 Community Edition entry
5. Rewrite `CommercialUseModal.svelte` — CE free forever messaging

---

## Phase 2 — AI Surgical Cut

**Goal:** Protect monetization. CE BYOK = text-only AI, no DB tool access.

1. Remove `run_query`, `describe_object`, `get_ddl` tools from `sidecar/src/ai.ts`
2. Update CE system prompt: explain/generate only, no schema context
3. Add `BYOK · CE` badge to `SheepChat.svelte` with "Cloud AI coming soon" tooltip

---

## Phase 3 — Provider Abstraction

**Goal:** Infrastructure for Cloud AI without breaking CE.

Files to create:
- `src/lib/services/features.ts` — feature flags (all true by default)
- `src/lib/ai/providers/AIProvider.ts` — interface: explainSQL, generateSQL
- `src/lib/ai/providers/BYOKProvider.ts` — text-only Anthropic via sidecar
- `src/lib/ai/providers/CloudProvider.ts` — stub, ready for Phase 4
- `src/lib/ai/AIService.ts` — selects provider by feature flag

Refactor `SheepChat.svelte` to use `AIService` instead of calling sidecar directly.

---

## Phase 4 — Cloud AI Wiring (future)

Implement `CloudProvider.ts` with `api.veesker.cloud` calls, auth flow, Cloud AI badge, BYOK fallback.

---

## Error Handling
- Phase 2: if user has no API key and tries AI → existing "no key" UI unchanged
- Phase 3: feature flags default all-true → zero regression on CE
- Phase 4: Cloud failure → graceful fallback to BYOK with user notification

## Testing
- Phase 1: visual review of README + modal
- Phase 2: `bun test` sidecar (166 tests must pass); manual verify AI responds without DB tools
- Phase 3: `bun run check` (0 errors); manual verify SheepChat works through provider
