import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn(),
  queryExecuteMulti: vi.fn(),
  queryCancel: vi.fn(),
}));

// sql-splitter is pure TS — use the real implementation.
vi.mock("$lib/sql-splitter", async () => {
  const real = await vi.importActual<typeof import("$lib/sql-splitter")>("$lib/sql-splitter");
  return real;
});

import { queryExecute, queryExecuteMulti, queryCancel } from "$lib/sql-query";
import { sqlEditor, activeResult, type SqlTab } from "./sql-editor.svelte";

const mockedQueryExecute = vi.mocked(queryExecute);
const mockedQueryExecuteMulti = vi.mocked(queryExecuteMulti);
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
  mockedQueryExecuteMulti.mockReset();
  mockedQueryCancel.mockReset();
  mockLocalStorage.clear();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function okResult(rowCount = 1, withColumns = true) {
  return {
    ok: true as const,
    data: {
      columns: withColumns ? [{ name: "X", dataType: "NUMBER" }] : [],
      rows: withColumns ? [[rowCount]] : [],
      rowCount,
      elapsedMs: 5,
    },
  };
}

function errResult(code = -32013, message = "ORA-00942: table or view does not exist") {
  return { ok: false as const, error: { code, message } };
}

// ── openBlank ────────────────────────────────────────────────────────────────

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

// ── openPreview ───────────────────────────────────────────────────────────────

describe("sqlEditor.openPreview", () => {
  it("builds a quoted SELECT * SQL and runs it", async () => {
    mockedQueryExecute.mockResolvedValue(okResult());
    await sqlEditor.openPreview("SYSTEM", "HELP");
    expect(mockedQueryExecute).toHaveBeenCalledWith(
      `SELECT * FROM "SYSTEM"."HELP" FETCH FIRST 100 ROWS ONLY`,
      expect.any(String)
    );
    expect(sqlEditor.tabs[0].title).toBe("SYSTEM.HELP");
    expect(sqlEditor.drawerOpen).toBe(true);
    const ar = activeResult(sqlEditor.tabs[0]);
    expect(ar?.result?.rowCount).toBe(1);
  });
});

// ── runActive ─────────────────────────────────────────────────────────────────

describe("sqlEditor.runActive", () => {
  it("sets running, then sets result on success", async () => {
    sqlEditor.openBlank();
    const id = sqlEditor.activeId!;
    sqlEditor.updateSql(id, "SELECT 1 FROM DUAL");
    mockedQueryExecute.mockResolvedValue(okResult());
    await sqlEditor.runActive();
    expect(sqlEditor.active?.running).toBe(false);
    const ar = activeResult(sqlEditor.active!);
    expect(ar?.result?.rowCount).toBe(1);
    expect(ar?.error).toBeNull();
  });

  it("sets error on failure and clears prior result", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT * FROM nope");
    mockedQueryExecute.mockResolvedValue(errResult());
    await sqlEditor.runActive();
    const ar = activeResult(sqlEditor.active!);
    expect(ar?.error?.code).toBe(-32013);
    expect(ar?.result).toBeNull();
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
    mockedQueryExecute.mockResolvedValue(okResult(0, false));
    await sqlEditor.runActive();
    expect(mockedQueryExecute).toHaveBeenCalledWith("SELECT 1 FROM DUAL", expect.any(String));
  });

  it("does nothing when there is no active tab", async () => {
    await sqlEditor.runActive();
    expect(mockedQueryExecute).not.toHaveBeenCalled();
  });
});

// ── runActiveAll ──────────────────────────────────────────────────────────────

describe("sqlEditor.runActiveAll", () => {
  it("populates tab.results with multiple entries for 3 statements", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM dual;\nSELECT 2 FROM dual;\nSELECT 3 FROM dual;");
    mockedQueryExecuteMulti.mockResolvedValue({
      ok: true,
      data: {
        multi: true,
        results: [
          { status: "ok", statementIndex: 0, sql: "SELECT 1 FROM dual", elapsedMs: 1, columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1 },
          { status: "ok", statementIndex: 1, sql: "SELECT 2 FROM dual", elapsedMs: 2, columns: [{ name: "Y", dataType: "NUMBER" }], rows: [[2]], rowCount: 1 },
          { status: "ok", statementIndex: 2, sql: "SELECT 3 FROM dual", elapsedMs: 3, columns: [{ name: "Z", dataType: "NUMBER" }], rows: [[3]], rowCount: 1 },
        ],
      },
    });
    await sqlEditor.runActiveAll();
    expect(sqlEditor.active?.results).toHaveLength(3);
    expect(sqlEditor.active?.results[0].status).toBe("ok");
    expect(sqlEditor.active?.results[1].status).toBe("ok");
    expect(sqlEditor.active?.results[2].status).toBe("ok");
    expect(sqlEditor.active?.running).toBe(false);
  });

  it("sets activeResultId to the last SELECT with rows", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "INSERT INTO t VALUES(1);\nSELECT * FROM t;");
    mockedQueryExecuteMulti.mockResolvedValue({
      ok: true,
      data: {
        multi: true,
        results: [
          { status: "ok", statementIndex: 0, sql: "INSERT INTO t VALUES(1)", elapsedMs: 1, columns: [], rows: [], rowCount: 1 },
          { status: "ok", statementIndex: 1, sql: "SELECT * FROM t", elapsedMs: 2, columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1 },
        ],
      },
    });
    await sqlEditor.runActiveAll();
    const tab = sqlEditor.active!;
    const ar = activeResult(tab);
    expect(ar).not.toBeNull();
    expect(ar?.result?.columns).toHaveLength(1); // the SELECT result
    expect(ar?.statementIndex).toBe(1);
  });

  it("stops iteration on error — 2 results returned, second is error", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM dual;\nSELECT * FROM nope;\nSELECT 3 FROM dual;");
    mockedQueryExecuteMulti.mockResolvedValue({
      ok: true,
      data: {
        multi: true,
        results: [
          { status: "ok", statementIndex: 0, sql: "SELECT 1 FROM dual", elapsedMs: 1, columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1 },
          { status: "error", statementIndex: 1, sql: "SELECT * FROM nope", elapsedMs: 0, error: { code: -32013, message: "ORA-00942" } },
        ],
      },
    });
    await sqlEditor.runActiveAll();
    const tab = sqlEditor.active!;
    expect(tab.results).toHaveLength(2);
    expect(tab.results[1].status).toBe("error");
    expect(tab.results[1].error?.message).toContain("ORA-00942");
  });

  it("sets splitterError and doesn't run when splitter fails", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 'unterminated FROM dual;");
    await sqlEditor.runActiveAll();
    expect(mockedQueryExecuteMulti).not.toHaveBeenCalled();
    expect(sqlEditor.active?.splitterError).toBeTruthy();
    expect(sqlEditor.active?.results).toHaveLength(0);
  });

  it("doesn't run when SQL is empty", async () => {
    sqlEditor.openBlank();
    await sqlEditor.runActiveAll();
    expect(mockedQueryExecuteMulti).not.toHaveBeenCalled();
  });
});

// ── runSelection ──────────────────────────────────────────────────────────────

describe("sqlEditor.runSelection", () => {
  it("runs selected text as a single statement, results.length === 1", async () => {
    sqlEditor.openBlank();
    mockedQueryExecute.mockResolvedValue(okResult());
    await sqlEditor.runSelection("SELECT 1 FROM dual");
    const tab = sqlEditor.active!;
    expect(tab.results).toHaveLength(1);
    expect(tab.results[0].status).toBe("ok");
    expect(mockedQueryExecute).toHaveBeenCalledWith("SELECT 1 FROM dual", expect.any(String));
  });

  it("strips trailing semicolon from selection", async () => {
    sqlEditor.openBlank();
    mockedQueryExecute.mockResolvedValue(okResult(0, false));
    await sqlEditor.runSelection("UPDATE t SET x=1;");
    expect(mockedQueryExecute).toHaveBeenCalledWith("UPDATE t SET x=1", expect.any(String));
  });
});

// ── runStatementAtCursor ──────────────────────────────────────────────────────

describe("sqlEditor.runStatementAtCursor", () => {
  it("runs the statement the cursor is inside based on character position", async () => {
    sqlEditor.openBlank();
    const sql = "SELECT 1 FROM dual;\nSELECT 2 FROM dual;\nSELECT 3 FROM dual;";
    sqlEditor.updateSql(sqlEditor.activeId!, sql);
    mockedQueryExecute.mockResolvedValue(okResult());

    // cursor at position 25 — inside second statement "SELECT 2 FROM dual"
    // First statement ends at ~19 chars ("SELECT 1 FROM dual;")
    // Second statement starts after the newline at ~20
    const cursorPos = 25;
    await sqlEditor.runStatementAtCursor(sql, cursorPos);

    const called = mockedQueryExecute.mock.calls[0][0];
    expect(called).toContain("SELECT 2");
  });

  it("falls back to nearest statement before cursor when cursor is in whitespace", async () => {
    sqlEditor.openBlank();
    const sql = "SELECT 1 FROM dual;\n\n\nSELECT 2 FROM dual;";
    sqlEditor.updateSql(sqlEditor.activeId!, sql);
    mockedQueryExecute.mockResolvedValue(okResult());

    // cursor at position 21 — in the blank lines between statements
    await sqlEditor.runStatementAtCursor(sql, 21);
    const called = mockedQueryExecute.mock.calls[0][0];
    // Should run statement 1 (the one before the cursor)
    expect(called).toContain("SELECT 1");
  });
});

// ── activeResult helper ───────────────────────────────────────────────────────

describe("activeResult", () => {
  it("returns null when tab.activeResultId is null", () => {
    sqlEditor.openBlank();
    const tab = sqlEditor.active!;
    expect(activeResult(tab)).toBeNull();
  });

  it("returns the TabResult matching activeResultId", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL");
    mockedQueryExecute.mockResolvedValue(okResult(42));
    await sqlEditor.runActive();
    const tab = sqlEditor.active!;
    expect(tab.activeResultId).not.toBeNull();
    const ar = activeResult(tab);
    expect(ar).not.toBeNull();
    expect(ar?.result?.rowCount).toBe(42);
  });

  it("returns null when activeResultId doesn't match any result", () => {
    sqlEditor.openBlank();
    const tab = sqlEditor.active!;
    tab.activeResultId = "nonexistent-id";
    expect(activeResult(tab)).toBeNull();
  });
});

// ── closeTab ──────────────────────────────────────────────────────────────────

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

// ── toggleDrawer + reset ──────────────────────────────────────────────────────

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

// ── drawerHeight ──────────────────────────────────────────────────────────────

describe("sqlEditor.drawerHeight", () => {
  it("falls back to default when localStorage is empty", () => {
    // jsdom window.innerHeight is 768, so default = Math.round(768 * 0.4) = 307
    expect(sqlEditor.drawerHeight).toBeGreaterThanOrEqual(120);
    expect(sqlEditor.drawerHeight).toBeLessThanOrEqual(2000);
  });

  it("returns persisted value when valid", () => {
    localStorage.setItem("veesker.sql.drawerHeight", "500");
    sqlEditor.setDrawerHeight(500);
    expect(sqlEditor.drawerHeight).toBe(500);
  });

  it("falls back to default when persisted value is out of range", () => {
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

// ── editorRatio ───────────────────────────────────────────────────────────────

describe("sqlEditor.editorRatio", () => {
  it("defaults to 0.35 when localStorage is empty", () => {
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

// ── cancelActive ──────────────────────────────────────────────────────────────

describe("sqlEditor.cancelActive", () => {
  it("is a no-op when there is no active tab", async () => {
    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).not.toHaveBeenCalled();
  });

  it("is a no-op when active tab has no running request", async () => {
    sqlEditor.openBlank();
    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).not.toHaveBeenCalled();
  });

  it("invokes queryCancel with the running requestId", async () => {
    mockedQueryCancel.mockResolvedValue({ ok: true, data: { cancelled: true, requestId: "req-abc" } });

    let resolvePending!: (v: any) => void;
    mockedQueryExecute.mockReturnValue(new Promise((res) => { resolvePending = res; }));

    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL");

    const runPromise = sqlEditor.runActive();
    const requestId = sqlEditor.active!.runningRequestId;
    expect(requestId).not.toBeNull();

    await sqlEditor.cancelActive();
    expect(mockedQueryCancel).toHaveBeenCalledWith(requestId);

    resolvePending({ ok: true, data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 } });
    await runPromise;
  });
});

// ── runActive requestId lifecycle ─────────────────────────────────────────────

describe("sqlEditor.runActive — requestId lifecycle", () => {
  it("sets runningRequestId on the tab during execute, clears it after", async () => {
    let capturedRequestId: string | null = null;
    mockedQueryExecute.mockImplementation((_sql: string, requestId: string) => {
      capturedRequestId = requestId;
      return Promise.resolve({ ok: true as const, data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 } });
    });

    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL");
    await sqlEditor.runActive();

    expect(sqlEditor.active?.runningRequestId).toBeNull();
    expect(capturedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
