# Decisão — Separação de Repos CE vs CL

**Data:** 2026-04-29
**Tags:** arquitetura, roadmap, ce, cloud

## Problema

Atualmente todo o código CE e CL vive no mesmo repo `veesker` (open core Apache 2.0).
Features CL são gateadas apenas por `authCtx.tier === "cloud"` no frontend — bypassável por quem clonar e modificar o fonte.

Features server-enforced (Audit Log, AI proxy) são protegidas pelo JWT via `api.veesker.cloud` — não bypassáveis.
Features client-side (Vision graph) — bypassáveis sem token se o check frontend for removido.

## Decisão tomada

Separar os repos. Código CL não deve ir para o open core.

## Abordagem planejada

- `veesker` → CE puro (Apache 2.0, vai ser público)
- `veesker-cloud-desktop` (novo repo privado) → componentes Svelte e comandos Rust exclusivos CL, injetados no build
- Features que já existem no repo com gate CL devem ser migradas antes da abertura do repo ao público

## Timing

Construir o Vision primeiro (enquanto tem momentum), depois fazer a separação.
Razão: separação é tarefa arquitetural de ~1 semana; Vision aproveita o contexto e decisões de design frescos.
O JWT server-enforced já protege funcionalmente enquanto os repos não são separados.

## O que precisa migrar

- [ ] `CloudAuditService.ts`
- [ ] `AuditLogPanel.svelte`
- [ ] `cloud_api_get` / `cloud_api_post` (commands.rs)
- [ ] Checks `authCtx.tier === "cloud"` nos componentes
- [ ] `VisionGraph.svelte` + `VisionDetailPanel.svelte` (quando construídos)
- [ ] `LoginModal.svelte` / `SubscribeModal.svelte`
