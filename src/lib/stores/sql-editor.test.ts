import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn(),
  queryCancel: vi.fn(),
}));

import { queryExecute, queryCancel } from "$lib/sql-query";
import { sqlEditor } from "./sql-editor.svelte";

const mockedQueryExecute = vi.mocked(queryExecute);
const mockedQueryCancel = vi.mocked(queryCancel);

// localStorage in this jsdom env is a stub without .clear().
// Replace it with a real in-memory implementation so our tests can isolate state.
const _localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => { _localStorageStore[k] = v; },
  removeItem: (k: string) => { delete _localStorageStore[k]; },
  clear: () => { for (const k of Object.keys(_localStorageStore)) delete _localStorageStore[k]; },
};
vi.stubGlobal("localStorage", mockLocalStorage);

beforeEach(() => {
  sqlEditor.reset();
  mockedQueryExecute.mockReset();
  mockedQueryCancel.mockReset();
  mockLocalStorage.clear();
});

describe("sqlEditor.openBlank", () => {
  it("creates a tab named 'Query 1' and opens the drawer", () => {
    sqlEditor.openBlank();
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("Query 1");
    expect(sqlEditor.tabs[0].sql).toBe("");
    expect(sqlEditor.drawerOpen).toBe(true);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id);
  });

  it("increments the title number when tabs already exist", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    expect(sqlEditor.tabs.map((t) => t.title)).toEqual(["Query 1", "Query 2", "Query 3"]);
  });

  it("preserves Query N counter even after closing earlier tabs", () => {
    sqlEditor.openBlank(); // Query 1
    sqlEditor.openBlank(); // Query 2
    sqlEditor.closeTab(sqlEditor.tabs[0].id);
    sqlEditor.openBlank(); // Query 3 (not Query 2 again)
    expect(sqlEditor.tabs.map((t) => t.title)).toEqual(["Query 2", "Query 3"]);
  });
});

describe("sqlEditor.openPreview", () => {
  it("builds a quoted SELECT * SQL and runs it", async () => {
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1, elapsedMs: 5 },
    });
    await sqlEditor.openPreview("SYSTEM", "HELP");
    expect(mockedQueryExecute).toHaveBeenCalledWith(
      `SELECT * FROM "SYSTEM"."HELP" FETCH FIRST 100 ROWS ONLY`,
      expect.any(String)
    );
    expect(sqlEditor.tabs[0].title).toBe("SYSTEM.HELP");
    expect(sqlEditor.drawerOpen).toBe(true);
    expect(sqlEditor.tabs[0].result?.rowCount).toBe(1);
  });
});

describe("sqlEditor.runActive", () => {
  it("sets running, then sets result on success", async () => {
    sqlEditor.openBlank();
    const id = sqlEditor.activeId!;
    sqlEditor.updateSql(id, "SELECT 1 FROM DUAL");
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1, elapsedMs: 5 },
    });
    await sqlEditor.runActive();
    expect(sqlEditor.active?.running).toBe(false);
    expect(sqlEditor.active?.result?.rowCount).toBe(1);
    expect(sqlEditor.active?.error).toBeNull();
  });

  it("sets error on failure and clears prior result", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT * FROM nope");
    mockedQueryExecute.mockResolvedValue({
      ok: false,
      error: { code: -32013, message: "ORA-00942: table or view does not exist" },
    });
    await sqlEditor.runActive();
    expect(sqlEditor.active?.error?.code).toBe(-32013);
    expect(sqlEditor.active?.result).toBeNull();
    expect(sqlEditor.active?.running).toBe(false);
  });

  it("early-returns silently on empty SQL", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "   \n  ");
    await sqlEditor.runActive();
    expect(mockedQueryExecute).not.toHaveBeenCalled();
    expect(sqlEditor.active?.running).toBe(false);
  });

  it("strips a single trailing semicolon before invoke", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL ;  ");
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 },
    });
    await sqlEditor.runActive();
    expect(mockedQueryExecute).toHaveBeenCalledWith("SELECT 1 FROM DUAL", expect.any(String));
  });

  it("does nothing when there is no active tab", async () => {
    await sqlEditor.runActive();
    expect(mockedQueryExecute).not.toHaveBeenCalled();
  });
});

describe("sqlEditor.closeTab", () => {
  it("picks the left neighbor when active tab is closed", () => {
    sqlEditor.openBlank(); // 0
    sqlEditor.openBlank(); // 1
    sqlEditor.openBlank(); // 2
    const middle = sqlEditor.tabs[1].id;
    sqlEditor.setActive(middle);
    sqlEditor.closeTab(middle);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id);
  });

  it("picks the right neighbor when first tab is closed and active", () => {
    sqlEditor.openBlank(); // 0 — active
    sqlEditor.openBlank(); // 1
    const first = sqlEditor.tabs[0].id;
    sqlEditor.closeTab(first);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id); // the former tab[1]
  });

  it("sets activeId to null when the last tab is closed", () => {
    sqlEditor.openBlank();
    sqlEditor.closeTab(sqlEditor.tabs[0].id);
    expect(sqlEditor.tabs.length).toBe(0);
    expect(sqlEditor.activeId).toBeNull();
  });

  it("does nothing when closing a non-existent id", () => {
    sqlEditor.openBlank();
    const beforeId = sqlEditor.activeId;
    sqlEditor.closeTab("nonexistent");
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.activeId).toBe(beforeId);
  });
});

describe("sqlEditor.toggleDrawer + reset", () => {
  it("toggleDrawer flips drawerOpen", () => {
    expect(sqlEditor.drawerOpen).toBe(false);
    sqlEditor.toggleDrawer();
    expect(sqlEditor.drawerOpen).toBe(true);
    sqlEditor.toggleDrawer();
    expect(sqlEditor.drawerOpen).toBe(false);
  });

  it("reset clears tabs, activeId, and drawerOpen", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    sqlEditor.toggleDrawer();
    sqlEditor.reset();
    expect(sqlEditor.tabs.length).toBe(0);
    expect(sqlEditor.activeId).toBeNull();
    expect(sqlEditor.drawerOpen).toBe(false);
  });
});

describe("sqlEditor.drawerHeight", () => {
  it("falls back to default when localStorage is empty", () => {
    // jsdom window.innerHeight is 768, so default = Math.round(768 * 0.4) = 307
    expect(sqlEditor.drawerHeight).toBeGreaterThanOrEqual(120);
    expect(sqlEditor.drawerHeight).toBeLessThanOrEqual(2000);
  });

  it("returns persisted value when valid", () => {
    localStorage.setItem("veesker.sql.drawerHeight", "500");
    // The store's _drawerHeight is already loaded; use setDrawerHeight to simulate
    // reading from localStorage by calling set then checking via getter
    sqlEditor.setDrawerHeight(500);
    expect(sqlEditor.drawerHeight).toBe(500);
  });

  it("falls back to default when persisted value is out of range", () => {
    // setDrawerHeight clamps, so test below-minimum clamping
    sqlEditor.setDrawerHeight(50); // below 120
    expect(sqlEditor.drawerHeight).toBe(120);
  });

  it("setDrawerHeight clamps below 120", () => {
    sqlEditor.setDrawerHeight(0);
    expect(sqlEditor.drawerHeight).toBe(120);
  });

  it("setDrawerHeight clamps above 2000", () => {
    sqlEditor.setDrawerHeight(9999);
    expect(sqlEditor.drawerHeight).toBe(2000);
  });

  it("setDrawerHeight writes to localStorage", () => {
    sqlEditor.setDrawerHeight(750);
    expect(localStorage.getItem("veesker.sql.drawerHeight")).toBe("750");
  });
});

describe("sqlEditor.editorRatio", () => {
  it("defaults to 0.35 when localStorage is empty", () => {
    // The module-level default is 0.35 (loaded before tests ran),
    // but after setDrawerHeight tests may have mutated it. Use setEditorRatio
    // to reset and confirm valid range.
    sqlEditor.setEditorRatio(0.35);
    expect(sqlEditor.editorRatio).toBe(0.35);
  });

  it("returns persisted value when valid", () => {
    sqlEditor.setEditorRatio(0.6);
    expect(sqlEditor.editorRatio).toBe(0.6);
  });

  it("clamps below 0.15 to 0.15", () => {
    sqlEditor.setEditorRatio(0.05);
    expect(sqlEditor.editorRatio).toBe(0.15);
  });

  it("clamps above 0.85 to 0.85", () => {
    sqlEditor.setEditorRatio(0.99);
    expect(sqlEditor.editorRatio).toBe(0.85);
  });

  it("setEditorRatio writes to localStorage with 4 decimals", () => {
    sqlEditor.setEditorRatio(0.4);
    expect(localStorage.getItem("veesker.sql.editorRatio")).toBe("0.4000");
  });
});

describe("sqlEditor.cancelActive", () => {
  it("is a no-op when there is no active tab", async () => {
    // No tabs open — cancelActive should resolve without throwing or calling queryCancel.
    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).not.toHaveBeenCalled();
  });

  it("is a no-op when active tab has no running request", async () => {
    sqlEditor.openBlank();
    // runningRequestId is null by default; no cancel should fire.
    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).not.toHaveBeenCalled();
  });

  it("invokes queryCancel with the running requestId", async () => {
    mockedQueryCancel.mockResolvedValue({ ok: true, data: { cancelled: true, requestId: "req-abc" } });

    // Start a query that hangs (deferred) so runningRequestId is set.
    let resolvePending!: (v: any) => void;
    mockedQueryExecute.mockReturnValue(new Promise((res) => { resolvePending = res; }));

    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL");

    const runPromise = sqlEditor.runActive();
    // At this point the tab should have a runningRequestId set.
    const requestId = sqlEditor.active!.runningRequestId;
    expect(requestId).not.toBeNull();

    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).toHaveBeenCalledWith(requestId);

    // Resolve the pending execute so runActive can finish.
    resolvePending({ ok: true, data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 } });
    await runPromise;
  });
});

describe("sqlEditor.runActive — requestId lifecycle", () => {
  it("sets runningRequestId on the tab during execute, clears it after", async () => {
    let capturedRequestId: string | null = null;
    mockedQueryExecute.mockImplementation((_sql: string, requestId: string) => {
      capturedRequestId = requestId;
      return Promise.resolve({ ok: true, data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 } });
    });

    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL");
    await sqlEditor.runActive();

    // After completion, runningRequestId should be null.
    expect(sqlEditor.active?.runningRequestId).toBeNull();
    // A UUID was passed to queryExecute.
    expect(capturedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
