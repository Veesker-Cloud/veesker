// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

export type UserTier = "ce" | "cloud";

// Intentionally mutable: feature flags change at runtime when user logs in or subscription changes
export const FEATURES = {
  cloudAI: false,            // Sheep with DB tools + schema-aware context
  aiCharts: false,           // Charts generated via natural language (Phase 4)
  aiDebugger: false,         // Debugger runtime analysis (Phase 4)
  aiVrasGenerate: true,      // VRAS AI Suggest — CE BYOK, always on
  managedEmbeddings: false,  // Vector embeddings without Ollama/key (Phase 4)
  teamFeatures: false,       // Shared queries, RBAC (Phase 4)
  cloudAudit: false,         // Long-term audit sync (Phase 4)
  isLoggedIn: false,
  userTier: "ce" as UserTier,
};

export function applyFeatureFlags(flags: Partial<typeof FEATURES>): void {
  Object.assign(FEATURES, flags);
}

export function resetFeatures(): void {
  FEATURES.cloudAI = false;
  FEATURES.aiCharts = false;
  FEATURES.aiDebugger = false;
  FEATURES.managedEmbeddings = false;
  FEATURES.teamFeatures = false;
  FEATURES.cloudAudit = false;
  FEATURES.isLoggedIn = false;
  FEATURES.userTier = "ce";
  FEATURES.aiVrasGenerate = true; // CE BYOK — always on regardless of login state
}
