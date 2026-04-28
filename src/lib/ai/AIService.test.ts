import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/services/features", () => ({
  FEATURES: { cloudAI: false },
}));

vi.mock("./providers/BYOKProvider", () => ({
  BYOKProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: true, data: { content: "byok response", toolsUsed: [] } }),
  })),
}));

vi.mock("./providers/CloudProvider", () => ({
  CloudProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_NOT_IMPLEMENTED", message: "coming soon" } }),
  })),
}));

import { FEATURES } from "$lib/services/features";
import { CloudProvider } from "./providers/CloudProvider";
import { AIService } from "./AIService";

const baseParams = {
  apiKey: "sk-test",
  messages: [{ role: "user" as const, content: "hello" }],
  context: { activeSql: "SELECT 1 FROM DUAL" },
};

describe("AIService", () => {
  beforeEach(() => {
    (FEATURES as any).cloudAI = false;
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_NOT_IMPLEMENTED", message: "coming soon" } }),
    }));
  });

  test("uses BYOKProvider when cloudAI=false", async () => {
    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.content).toBe("byok response");
  });

  test("uses CloudProvider when cloudAI=true", async () => {
    (FEATURES as any).cloudAI = true;
    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_NOT_IMPLEMENTED");
  });

  test("falls back to BYOK on CLOUD_UNAVAILABLE when apiKey present", async () => {
    (FEATURES as any).cloudAI = true;
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "down" } }),
    }));

    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.content).toBe("byok response");
  });

  test("does NOT fall back on 401 Unauthorized", async () => {
    (FEATURES as any).cloudAI = true;
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "UNAUTHORIZED", message: "expired" } }),
    }));

    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
  });

  test("does NOT fall back on 402 Payment Required", async () => {
    (FEATURES as any).cloudAI = true;
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "PAYMENT_REQUIRED", message: "no credits" } }),
    }));

    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
  });

  test("does NOT fall back when apiKey is absent even on fallback error code", async () => {
    (FEATURES as any).cloudAI = true;
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "down" } }),
    }));

    const result = await AIService.chat({ ...baseParams, apiKey: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_UNAVAILABLE");
  });
});
