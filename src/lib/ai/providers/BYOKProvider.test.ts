import { describe, test, expect, vi } from "vitest";
import { BYOKProvider } from "./BYOKProvider";

vi.mock("$lib/workspace", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "$lib/workspace";

describe("BYOKProvider", () => {
  const provider = BYOKProvider();

  test("delegates to aiChat with correct params", async () => {
    vi.mocked(aiChat).mockResolvedValue({ ok: true, data: { content: "hello", toolsUsed: [] } });

    const result = await provider.chat({
      apiKey: "sk-test",
      messages: [{ role: "user", content: "explain this" }],
      context: { activeSql: "SELECT 1 FROM DUAL" },
    });

    expect(aiChat).toHaveBeenCalledWith(
      "sk-test",
      [{ role: "user", content: "explain this" }],
      { activeSql: "SELECT 1 FROM DUAL" },
    );
    expect(result).toEqual({ ok: true, data: { content: "hello", toolsUsed: [] } });
  });

  test("returns error result when aiChat fails", async () => {
    vi.mocked(aiChat).mockResolvedValue({ ok: false, error: { message: "no key" } });

    const result = await provider.chat({
      apiKey: "",
      messages: [{ role: "user", content: "hi" }],
      context: {},
    });

    expect(result.ok).toBe(false);
  });
});
