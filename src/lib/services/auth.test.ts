import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FEATURES, resetFeatures, applyFeatureFlags } from "./features";

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

  it("clears token and resets features when /me returns 401", async () => {
    vi.mocked(invoke).mockResolvedValue(makeJwt(FUTURE_EXP));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const { initAuth } = await import("./auth");
    await initAuth();
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush background .then()
    expect(invoke).toHaveBeenCalledWith("auth_token_clear");
    expect(FEATURES.cloudAI).toBe(false);
  });
});

describe("logout", () => {
  beforeEach(() => {
    resetFeatures();
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears keyring, localStorage, and resets features", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    localStorage.setItem("veesker:features", JSON.stringify({ cloudAI: true }));
    applyFeatureFlags({ cloudAI: true, isLoggedIn: true });
    const { logout } = await import("./auth");
    await logout();
    expect(invoke).toHaveBeenCalledWith("auth_token_clear");
    expect(localStorage.getItem("veesker:features")).toBeNull();
    expect(FEATURES.cloudAI).toBe(false);
  });
});
