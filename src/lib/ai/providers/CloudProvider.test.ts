import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { CloudProvider } from "./CloudProvider";

const mockParams = {
  apiKey: "",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }],
  context: { activeSql: "" },
};

describe("CloudProvider", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(globalThis, "fetch").mockReset();
  });

  it("returns UNAUTHORIZED when no token in keyring", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED on 401 response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("returns PAYMENT_REQUIRED on 402 response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 402 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAYMENT_REQUIRED");
  });

  it("returns CLOUD_UNAVAILABLE on 5xx response", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_UNAVAILABLE");
  });

  it("returns CLOUD_UNAVAILABLE on 404 (endpoint not yet live)", async () => {
    vi.mocked(invoke).mockResolvedValue("jwt.token.here");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    const result = await CloudProvider().chat(mockParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOUD_UNAVAILABLE");
  });
});
