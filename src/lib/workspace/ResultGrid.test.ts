import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import type { SqlTab, TabResult } from "$lib/stores/sql-editor.svelte";

const noopCancel = () => {};

function makeResult(partial: Partial<TabResult> = {}): TabResult {
  const id = partial.id ?? "r1";
  return {
    id,
    statementIndex: 0,
    sqlPreview: "SELECT 1 FROM dual",
    status: "ok",
    result: null,
    error: null,
    elapsedMs: 0,
    ...partial,
  };
}

function tab(partial: Partial<SqlTab> = {}): SqlTab {
  return {
    id: "t1",
    title: "Query 1",
    sql: "",
    results: [],
    activeResultId: null,
    running: false,
    splitterError: null,
    runningRequestId: null,
    filePath: null,
    isDirty: false,
    savedContent: null,
    ...partial,
  };
}

function tabWithResult(result: TabResult, extra: Partial<SqlTab> = {}): SqlTab {
  return tab({ results: [result], activeResultId: result.id, ...extra });
}

describe("ResultGrid", () => {
  it("shows placeholder when tab is null", () => {
    render(ResultGrid, { props: { tab: null, onCancel: noopCancel } });
    expect(screen.getByText(/run a query/i)).toBeInTheDocument();
  });

  it("shows placeholder when tab has no results and is not running", () => {
    render(ResultGrid, { props: { tab: tab(), onCancel: noopCancel } });
    expect(screen.getByText(/run a query/i)).toBeInTheDocument();
  });

  it("shows spinner when tab.running", () => {
    render(ResultGrid, { props: { tab: tab({ running: true }), onCancel: noopCancel } });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows splitter error banner when tab.splitterError is set", () => {
    render(ResultGrid, {
      props: {
        tab: tab({ splitterError: "line 1: Unterminated string literal" }),
        onCancel: noopCancel,
      },
    });
    expect(screen.getByText(/Couldn't split/)).toBeInTheDocument();
    expect(screen.getByText(/Unterminated string literal/)).toBeInTheDocument();
    expect(screen.getByText(/No statements run/)).toBeInTheDocument();
  });

  it("shows cancelled banner when active result is cancelled", () => {
    const r = makeResult({ status: "cancelled" });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText(/Cancelled by user/)).toBeInTheDocument();
  });

  it("shows error banner when active result has error status", () => {
    const r = makeResult({
      status: "error",
      error: { code: -32013, message: "ORA-00942: table or view does not exist" },
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText(/ORA-00942/)).toBeInTheDocument();
  });

  it("shows DDL success message when columns is empty", () => {
    const r = makeResult({
      status: "ok",
      result: { columns: [], rows: [], rowCount: 3, elapsedMs: 45 },
      elapsedMs: 45,
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText(/Statement executed/)).toBeInTheDocument();
    expect(screen.getByText(/3 rows affected/)).toBeInTheDocument();
    expect(screen.getByText(/45ms/)).toBeInTheDocument();
  });

  it("renders columns header and rows", () => {
    const r = makeResult({
      status: "ok",
      result: {
        columns: [
          { name: "ID", dataType: "NUMBER" },
          { name: "NAME", dataType: "VARCHAR2(50)" },
        ],
        rows: [[1, "Alice"], [2, "Bob"]],
        rowCount: 2,
        elapsedMs: 12,
      },
      elapsedMs: 12,
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("NAME")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/12ms/)).toBeInTheDocument();
  });

  it("renders empty result with column header and 0 rows footer", () => {
    const r = makeResult({
      status: "ok",
      result: {
        columns: [{ name: "X", dataType: "NUMBER" }],
        rows: [],
        rowCount: 0,
        elapsedMs: 7,
      },
      elapsedMs: 7,
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText(/0 rows/)).toBeInTheDocument();
  });

  it("renders NULL marker for null cells", () => {
    const r = makeResult({
      status: "ok",
      result: {
        columns: [{ name: "X", dataType: "VARCHAR2" }],
        rows: [[null]],
        rowCount: 1,
        elapsedMs: 1,
      },
      elapsedMs: 1,
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    expect(screen.getByText("<NULL>")).toBeInTheDocument();
  });

  it("truncates long stringified values to 60 chars with ellipsis", () => {
    const long = "A".repeat(200);
    const r = makeResult({
      status: "ok",
      result: {
        columns: [{ name: "X", dataType: "CLOB" }],
        rows: [[long]],
        rowCount: 1,
        elapsedMs: 1,
      },
      elapsedMs: 1,
    });
    render(ResultGrid, {
      props: { tab: tabWithResult(r), onCancel: noopCancel },
    });
    const cell = screen.getByText(/A{60}…/);
    expect(cell).toBeInTheDocument();
  });
});
