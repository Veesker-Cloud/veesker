import { describe, it, expect, beforeEach, vi } from "vitest";

const _ls: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _ls[k] ?? null,
  setItem: (k: string, v: string) => { _ls[k] = v; },
  removeItem: (k: string) => { delete _ls[k]; },
  clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};
vi.stubGlobal("localStorage", mockLocalStorage);

beforeEach(() => { mockLocalStorage.clear(); });

describe("theme store", () => {
  it("defaults to light when localStorage is empty", async () => {
    const { theme } = await import("./theme.svelte");
    expect(theme.current).toBe("light");
  });

  it("toggle switches light → dark", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    expect(theme.current).toBe("dark");
  });

  it("toggle switches dark → light", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    theme.toggle();
    expect(theme.current).toBe("light");
  });

  it("toggle persists to localStorage", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    expect(mockLocalStorage.getItem("veesker_theme")).toBe("dark");
  });
});
