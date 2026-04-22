import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn(),
}));

import { queryExecute } from "$lib/sql-query";
import { sqlEditor } from "./sql-editor.svelte";

const mockedQueryExecute = vi.mocked(queryExecute);

beforeEach(() => {
  sqlEditor.reset();
  mockedQueryExecute.mockReset();
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
      `SELECT * FROM "SYSTEM"."HELP" FETCH FIRST 100 ROWS ONLY`
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
    expect(mockedQueryExecute).toHaveBeenCalledWith("SELECT 1 FROM DUAL");
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
