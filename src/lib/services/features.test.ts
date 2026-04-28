import { describe, test, expect, afterEach } from "vitest";
import { FEATURES, applyFeatureFlags, resetFeatures } from "./features";

describe("FEATURES defaults (CE mode)", () => {
  afterEach(() => resetFeatures());

  test("all cloud AI flags are false", () => {
    expect(FEATURES.cloudAI).toBe(false);
    expect(FEATURES.aiCharts).toBe(false);
    expect(FEATURES.aiDebugger).toBe(false);
    expect(FEATURES.managedEmbeddings).toBe(false);
    expect(FEATURES.teamFeatures).toBe(false);
    expect(FEATURES.cloudAudit).toBe(false);
  });

  test("VRAS AI Suggest is true (CE BYOK)", () => {
    expect(FEATURES.aiVrasGenerate).toBe(true);
  });

  test("user is not logged in by default", () => {
    expect(FEATURES.isLoggedIn).toBe(false);
    expect(FEATURES.userTier).toBe("ce");
  });

  test("applyFeatureFlags updates flags in place", () => {
    applyFeatureFlags({ cloudAI: true, isLoggedIn: true, userTier: "cloud" });
    expect(FEATURES.cloudAI).toBe(true);
    expect(FEATURES.isLoggedIn).toBe(true);
    expect(FEATURES.userTier).toBe("cloud");
  });

  test("resetFeatures reverts to CE defaults, keeps aiVrasGenerate true", () => {
    applyFeatureFlags({ cloudAI: true, aiVrasGenerate: false });
    resetFeatures();
    expect(FEATURES.cloudAI).toBe(false);
    expect(FEATURES.aiVrasGenerate).toBe(true);
  });
});
