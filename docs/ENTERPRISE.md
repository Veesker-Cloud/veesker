# Veesker Enterprise — Strategy & Architecture

This document is the public reference for Veesker's enterprise roadmap. The implementation lives in a separate private repository; the open-source IDE (this repo) does not gate any feature, per the [Docker-style commercial use policy](../COMMERCIAL_USE.md).

## Strategy

Three revenue streams, in priority order:

### 1. Veesker Cloud (SaaS) — recurring revenue, scales linearly with users

A small backend (Bun/Postgres + Svelte web dashboard) that the desktop app talks to when an organization opts in. Adds team-oriented features that don't make sense for individuals:

- **Connection registry sync** — admin defines connections in the Cloud, every team member's desktop pulls them. Centralized credentials, environment tags, role-based visibility.
- **Audit log central** — desktop ships every SQL execution to the Cloud's audit endpoint. Web dashboard for compliance review, search, and export.
- **SSO** — desktop authenticates via SAML/OIDC against the Cloud, which proxies to the customer's identity provider (Azure AD, Okta, Auth0, Active Directory).
- **Query approval workflow** — DDL/DML in production triggers an approval request in the Cloud. DBA approves via web. Desktop unlocks the execution.
- **Template management** — admin-curated SQL templates pushed to all team members.
- **Veesker Marketplace** — distribution channel for paid add-ons (see below).

**Pricing:** included with Business and Enterprise tiers. Standalone Cloud-only subscription possible.

### 2. Add-ons (paid plugins) — recurring or one-time, niche-deep

Pure-code plugins distributed via the Cloud Marketplace (or licensed directly for offline customers). Loaded by the open-source desktop app via the [Plugin API](../src/lib/plugins.ts). Each plugin is a separate codebase, typically:
- Frontend: small Svelte components
- Sidecar: optional TypeScript handler
- Distribution: signed bundle, license key validates entitlement

**Initial roadmap:**

| Add-on | Target customer | Revenue model |
|---|---|---|
| **Oracle EBS Pack** | EBS-running enterprises (banks, retail, gov) | R$ 4.000/year/company |
| **Audit Log Shipper** | Compliance-driven (banks, healthcare, gov) | R$ 1.500/year/seat |
| **AWR Analyzer** | DBAs / performance teams | R$ 1.500/year/seat |
| **Compliance Pack BR** | Brazilian financial sector (BACEN, SUSEP) | R$ 2.000/year/company |
| **Azure OpenAI / AWS Bedrock connectors** | Regulated cloud customers | R$ 500/month/company |
| **On-prem LLM gateway** | Defense, gov, banking — data-sovereignty needs | R$ 1.000/month/company |
| **Forms 6i / Reports converter** | Legacy modernization projects | R$ 8.000 one-time per project |

### 3. Support contracts — high-margin, low-marginal-cost

Pure professional services. No new code. Sells alongside Cloud + add-ons.

| Tier | Price | What it actually is |
|---|---|---|
| Pro | R$ 1.500/month | Email, 5-business-day SLA, ~2h/month |
| Business | R$ 5.000/month | Slack channel, 24h SLA, ~10h/month |
| Enterprise | R$ 20.000/month | 4h SLA, dedicated engineer, ~40h/month |
| Government / Regulated | Custom | Indemnification, on-prem deployment, SOC2/LGPD docs |

## Architecture

### Repository layout (planned)

```
github.com/geeviana/veesker                        Public, Apache 2.0 — open-source IDE
├── (current contents — desktop app, sidecar, docs)
└── src/lib/plugins.ts                              Plugin API surface (open)

github.com/veesker/veesker-cloud                   Private — SaaS backend + web dashboard
├── server/                                         Bun + Hono REST API
├── web/                                            SvelteKit dashboard
├── migrations/                                     Postgres migrations
└── infra/                                          Terraform / docker-compose

github.com/veesker/veesker-addons                  Private — monorepo of paid plugins
├── ebs-pack/
├── audit-shipper/
├── awr-analyzer/
├── compliance-br/
├── azure-openai/
├── aws-bedrock/
├── onprem-llm/
└── forms-converter/

github.com/veesker/veesker-marketplace              Private — public-facing marketplace
└── (Svelte site listing add-ons, billing, license-key generation)

github.com/veesker/veesker-licenses                Private — license issuance + validation
└── (lambda or small Bun service)
```

### Data flow — Veesker Cloud + Desktop

```
┌────────────────────────────────────────────────────────────────────┐
│ Customer's machine                                                 │
│                                                                    │
│  Veesker desktop (open source) ──────────────────────┐            │
│        │                                              │            │
│        │ HTTPS API token                              │            │
│        ▼                                              │            │
│  ┌──────────────────────────────┐                    │            │
│  │ Plugin: cloud-sync           │   ◀── Loaded from  │            │
│  │ (paid add-on, license-gated) │       marketplace  │            │
│  └──────────────────────────────┘                    │            │
│              │                                        │            │
└──────────────┼────────────────────────────────────────┼────────────┘
               │                                        │
               ▼                                        ▼
┌────────────────────────────────────────────────────────────────────┐
│ Veesker Cloud (SaaS, multi-tenant)                                 │
│                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │ API Gateway  │───▶│ Auth (SAML)  │    │ Postgres DB  │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│         │                                       ▲                  │
│         ▼                                       │                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │ Connection   │    │ Audit log    │    │ Query        │         │
│  │ registry     │    │ collector    │    │ approval     │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                              │                                     │
│                              ▼                                     │
│                       ┌──────────────┐                             │
│                       │ Splunk / DD  │  (customer's destination)   │
│                       │ S3 / etc.    │                             │
│                       └──────────────┘                             │
└────────────────────────────────────────────────────────────────────┘
```

### Plugin loading mechanism

Open-source Veesker exposes the [Plugin API](../src/lib/plugins.ts). At startup, the desktop app:

1. Looks for plugins in `%LocalAppData%\Veesker\plugins\` (Win) or `~/Library/Application Support/Veesker/plugins/` (Mac)
2. Each plugin is a `.veesker` bundle: signed ZIP containing a `manifest.json` + JS code + license.txt
3. Verifies the bundle signature against Veesker's plugin-signing public key (separate from update-signing key)
4. Validates the license key (offline JWT, signed by Veesker license server)
5. Loads the plugin's JS module and calls its `register()` function with the API surface
6. Plugin uses `registerAuthProvider`, `registerAuditDestination`, etc. to extend the IDE

**Open-source codebase contains everything needed to load plugins.** Plugins themselves are separate and proprietary.

## Roadmap

### Phase E0 — Foundation (current)

- [x] Plugin API surface defined in `src/lib/plugins.ts`
- [x] License store skeleton (`src/lib/stores/license.svelte.ts`)
- [x] Commercial use modal at first launch
- [x] Pricing page (`docs/PRICING.md`)
- [x] Commercial use policy (`COMMERCIAL_USE.md`)

### Phase E1 — Plugin loading + first add-on (next 4-6 weeks)

- [ ] Plugin loader implementation in core (`src-tauri/src/plugins.rs` + sidecar bridge)
- [ ] Plugin signing key generation and storage process
- [ ] Plugin manifest format definition
- [ ] License JWT format and validation library (offline)
- [ ] First add-on: **Audit Log Shipper**
  - Splunk HEC, Datadog, generic webhook destinations
  - Buffered queue with retry
  - Configurable filtering (only DML/DDL, only failures, etc.)
  - Web UI for configuring destinations
- [ ] License issuance script (manual at first, automated later)
- [ ] Internal documentation: how to build, sign, and ship a plugin

### Phase E2 — Veesker Cloud MVP (8-12 weeks)

- [ ] Backend: Bun + Hono + Postgres
- [ ] Auth: JWT-based with SAML/OIDC bridge
- [ ] Multi-tenant data model
- [ ] First feature: connection registry sync
- [ ] Web dashboard (SvelteKit) for admins
- [ ] Cloud sync plugin for desktop (paid add-on, included with Business+)
- [ ] Hosted at `cloud.veesker.dev`
- [ ] Initial billing integration (Stripe or Mercado Pago)

### Phase E3 — Audit & SSO (4-6 weeks after E2)

- [ ] Audit log central collection in Cloud
- [ ] Audit log shipping to Splunk/DD/S3 from Cloud (server-side)
- [ ] SAML 2.0 IdP integration
- [ ] OIDC integration
- [ ] Active Directory user sync

### Phase E4 — EBS Pack (8-12 weeks)

The high-margin add-on you can build with deep domain expertise:

- [ ] Concurrent program generator
- [ ] GL integration template wizards
- [ ] AOL package skeletons
- [ ] APEX form scaffolds (replacing Forms 6i)
- [ ] EBS-specific code conventions enforcement
- [ ] AP/AR/PO module helpers

### Phase E5 — Marketplace + remaining add-ons (rolling)

- [ ] Marketplace web UI at `marketplace.veesker.dev`
- [ ] Add-on submission process (own + third-party)
- [ ] Revenue-share for third-party add-ons (70/30)
- [ ] AWR Analyzer
- [ ] Forms/Reports converter
- [ ] Compliance Pack BR
- [ ] Azure OpenAI / AWS Bedrock / on-prem LLM connectors

## Build & distribute an add-on (internal process)

Documented in the private `veesker-addons` repo. Summary:

```bash
# Develop
cd addons/audit-shipper
bun install
bun run dev  # links into local Veesker for testing

# Build
bun run build  # produces dist/audit-shipper.veesker

# Sign
veesker-cli sign-plugin dist/audit-shipper.veesker \
  --key ~/.veesker/plugin-signing-key

# Publish to marketplace
veesker-cli publish dist/audit-shipper.veesker \
  --version 1.0.0 \
  --notes "Initial release"
```

License keys are issued per-customer:

```bash
veesker-cli issue-license \
  --customer "ACME Corp" \
  --plugin audit-shipper \
  --seats 25 \
  --expires 2027-04-25
# → writes license.veesker to send the customer
```

## Open core boundary

**Always open source:**
- Veesker IDE (entire desktop app, all features)
- Sidecar (Bun, Oracle communication)
- Plugin API surface
- Plugin loader (signed-plugin verification, license validation)
- Default audit log writer (local `.jsonl`)
- Cloud client SDK (just the HTTP wrapper — every paid customer can audit it)
- All documentation about the architecture

**Never open source:**
- Veesker Cloud server code
- Specific add-on implementations (EBS Pack, AWR Analyzer, etc.)
- License signing keys
- Plugin signing keys
- Marketplace billing logic
- Customer license database

This boundary is enforceable because the Plugin API is well-defined: anyone can write a plugin against it (free or paid). Marketplace add-ons are just one source of plugins among potentially many.

## Maintainer's commitment

The open-source desktop app receives:
- The same features as the paid version (everything is in the OSS repo, no gating)
- Security fixes for free, prioritized
- Best-effort support via GitHub issues
- Documentation kept in sync

The paid Cloud + add-ons receive:
- Priority development
- Customer-specific bug fixes via SLA
- Roadmap influence weighted by tier

If the project pivots, fails, or is acquired:
- The open-source repo continues under Apache 2.0 — no rug-pull possible
- Existing customers' Cloud data is exportable via the API
- License keys remain valid for the term of their subscription

## Contact

- Sales / partnership / OEM: geefatec@gmail.com
- Add-on marketplace inquiry: geefatec@gmail.com
- Volume / government / regulated: geefatec@gmail.com
