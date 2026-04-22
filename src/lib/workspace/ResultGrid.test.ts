import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import type { SqlTab } from "$lib/stores/sql-editor.svelte";

function tab(partial: Partial<SqlTab> = {}): SqlTab {
  return {
    id: "t1",
    title: "Query 1",
    sql: "",
    result: null,
    running: false,
    error: null,
    ...partial,
  };
}

describe("ResultGrid", () => {
  it("shows placeholder when tab is null", () => {
    render(ResultGrid, { props: { tab: null } });
    expect(screen.getByText(/run a query/i)).toBeInTheDocument();
  });

  it("shows spinner when tab.running", () => {
    render(ResultGrid, { props: { tab: tab({ running: true }) } });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error banner when tab.error is set", () => {
    render(ResultGrid, {
      props: {
        tab: tab({ error: { code: -32013, message: "ORA-00942: table or view does not exist" } }),
      },
    });
    expect(screen.getByText(/ORA-00942/)).toBeInTheDocument();
  });

  it("shows DDL success message when columns is empty", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: { columns: [], rows: [], rowCount: 3, elapsedMs: 45 },
        }),
      },
    });
    expect(screen.getByText(/Statement executed/)).toBeInTheDocument();
    expect(screen.getByText(/3 rows affected/)).toBeInTheDocument();
    expect(screen.getByText(/45ms/)).toBeInTheDocument();
  });

  it("renders columns header and rows", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [
              { name: "ID", dataType: "NUMBER" },
              { name: "NAME", dataType: "VARCHAR2(50)" },
            ],
            rows: [[1, "Alice"], [2, "Bob"]],
            rowCount: 2,
            elapsedMs: 12,
          },
        }),
      },
    });
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("NAME")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/12ms/)).toBeInTheDocument();
  });

  it("renders empty result with column header and 0 rows footer", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "NUMBER" }],
            rows: [],
            rowCount: 0,
            elapsedMs: 7,
          },
        }),
      },
    });
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText(/0 rows/)).toBeInTheDocument();
  });

  it("renders NULL marker for null cells", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "VARCHAR2" }],
            rows: [[null]],
            rowCount: 1,
            elapsedMs: 1,
          },
        }),
      },
    });
    expect(screen.getByText("<NULL>")).toBeInTheDocument();
  });

  it("truncates long stringified values to 60 chars with ellipsis", () => {
    const long = "A".repeat(200);
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "CLOB" }],
            rows: [[long]],
            rowCount: 1,
            elapsedMs: 1,
          },
        }),
      },
    });
    const cell = screen.getByText(/A{60}…/);
    expect(cell).toBeInTheDocument();
  });
});
