// Plugin / extension API for Veesker.
//
// This module defines the surface that future Veesker add-ons (paid or free)
// can use to extend the open-source IDE. The interfaces here are intentionally
// minimal — they grow as concrete add-ons are built.
//
// Plugin loading is NOT implemented yet. This file establishes the types so
// the open-source repo can stay aligned with future enterprise/marketplace
// add-ons without breaking changes.

import type { ObjectKind } from "$lib/workspace";

// ── Auth providers ───────────────────────────────────────────────────────────
// Add-ons can register additional auth flows (SAML, OIDC, Kerberos, etc.).

export type ConnectionAuthProvider = {
  id: string;
  displayName: string;
  description: string;
  buildConnection: (input: Record<string, unknown>) => Promise<{
    host: string;
    port: number;
    serviceName: string;
    username: string;
    password?: string;
    extras?: Record<string, unknown>;
  }>;
};

const authProviders = new Map<string, ConnectionAuthProvider>();

export function registerAuthProvider(p: ConnectionAuthProvider): void {
  if (authProviders.has(p.id)) {
    console.warn(`[plugins] auth provider '${p.id}' already registered`);
  }
  authProviders.set(p.id, p);
}

export function listAuthProviders(): ConnectionAuthProvider[] {
  return Array.from(authProviders.values());
}

// ── AI providers ─────────────────────────────────────────────────────────────
// Add-ons can register alternative AI backends (Azure OpenAI, AWS Bedrock,
// on-prem Llama, etc.). The default Anthropic Claude provider lives in
// sidecar/src/ai.ts.

export type AiChatProvider = {
  id: string;
  displayName: string;
  endpoint?: string;
  // Add-on supplies a pure function that calls its API. The signature
  // matches what sidecar/src/ai.ts.aiChat returns.
  chat: (params: {
    apiKey: string | null;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    context: Record<string, unknown>;
  }) => Promise<{ content: string }>;
};

const aiProviders = new Map<string, AiChatProvider>();

export function registerAiProvider(p: AiChatProvider): void {
  aiProviders.set(p.id, p);
}

export function listAiProviders(): AiChatProvider[] {
  return Array.from(aiProviders.values());
}

// ── Object actions ───────────────────────────────────────────────────────────
// Add-ons can contribute right-click actions for schema objects.

export type ObjectAction = {
  id: string;
  label: string;
  appliesTo: ObjectKind[];
  run: (ctx: { owner: string; name: string; kind: ObjectKind }) => Promise<void>;
};

const objectActions: ObjectAction[] = [];

export function registerObjectAction(a: ObjectAction): void {
  objectActions.push(a);
}

export function listObjectActions(kind: ObjectKind): ObjectAction[] {
  return objectActions.filter((a) => a.appliesTo.includes(kind));
}

// ── Audit log destinations ───────────────────────────────────────────────────
// Add-ons can register audit log forwarders (Splunk, Datadog, S3, custom).
// The core writes audit entries locally; destinations are notified and may
// forward asynchronously.

export type AuditEntry = {
  timestamp: string; // ISO 8601
  connectionId: string;
  username: string;
  host: string;
  sql: string;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
};

export type AuditDestination = {
  id: string;
  ship: (entry: AuditEntry) => Promise<void>;
};

const auditDestinations: AuditDestination[] = [];

export function registerAuditDestination(d: AuditDestination): void {
  auditDestinations.push(d);
}

export async function dispatchAuditEntry(entry: AuditEntry): Promise<void> {
  await Promise.allSettled(auditDestinations.map((d) => d.ship(entry)));
}

// ── License-aware features ──────────────────────────────────────────────────
// Add-ons can declare features that should only be available under certain
// license tiers. The core does not enforce — it just exposes the API.
// Enforcement is the add-on's responsibility (or honor-system per
// COMMERCIAL_USE.md).

export type LicenseTier = "personal" | "pro" | "business" | "enterprise";

export type GatedFeature = {
  id: string;
  requiresTier: LicenseTier;
  description: string;
};

const gatedFeatures = new Map<string, GatedFeature>();

export function registerGatedFeature(f: GatedFeature): void {
  gatedFeatures.set(f.id, f);
}

export function listGatedFeatures(): GatedFeature[] {
  return Array.from(gatedFeatures.values());
}
