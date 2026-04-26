import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ExecutionLog from "./ExecutionLog.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";
import type { SqlTab, TabResult } from "$lib/stores/sql-editor.svelte";

beforeEach(() => sqlEditor.reset());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(partial: Partial<TabResult> = {}): TabResult {
  return {
    id: partial.id ?? crypto.randomUUID(),
    statementIndex: partial.statementIndex ?? 0,
    sqlPreview: partial.sqlPreview ?? "SELECT 1 FROM dual",
    sqlOriginal: partial.sqlOriginal ?? "SELECT 1 FROM dual",
    status: partial.status ?? "ok",
    result: partial.result ?? null,
    error: partial.error ?? null,
    elapsedMs: partial.elapsedMs ?? 0,
    dbmsOutput: partial.dbmsOutput ?? null,
    compileErrors: partial.compileErrors ?? null,
    explainNodes: partial.explainNodes ?? null,
    fetchedAll: partial.fetchedAll ?? false,
    ...partial,
  };
}

function makeTab(partial: Partial<SqlTab> = {}): SqlTab {
  return {
    id: partial.id ?? "t1",
    title: partial.title ?? "Query 1",
    sql: partial.sql ?? "",
    results: partial.results ?? [],
    activeResultId: partial.activeResultId ?? null,
    running: partial.running ?? false,
    splitterError: partial.splitterError ?? null,
    runningRequestId: partial.runningRequestId ?? null,
    filePath: partial.filePath ?? null,
    isDirty: partial.isDirty ?? false,
    savedContent: partial.savedContent ?? null,
    ...partial,
  };
}

// ── Render tests ───────────────────────────────────────────────────────────────

describe("ExecutionLog", () => {
  it("renders nothing when tab.results is empty", () => {
    const tab = makeTab({ results: [], activeResultId: null });
    render(ExecutionLog, { props: { tab } });
    // When results is empty, no header or rows should exist
    expect(screen.queryByText(/statement/)).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("renders header but no rows when tab.results.length === 1", () => {
    const r = makeResult({ id: "r1", statementIndex: 0 });
    const tab = makeTab({ results: [r], activeResultId: r.id });
    render(ExecutionLog, { props: { tab } });
    // header visible with count chip
    expect(screen.getByText(/1 statement$/)).toBeInTheDocument();
    // rows are auto-collapsed — no listbox
    expect(screen.queryByRole("listbox")).toBeNull();
    // no toggle button since length <= 1
    expect(screen.queryByRole("button", { name: /expand log|collapse log/i })).toBeNull();
  });

  it("renders rows when tab.results.length > 1", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByText("Statement 1")).toBeInTheDocument();
    expect(screen.getByText("Statement 2")).toBeInTheDocument();
  });

  it("shows correct count label for multiple results", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0 });
    const r2 = makeResult({ id: "r2", statementIndex: 1 });
    const r3 = makeResult({ id: "r3", statementIndex: 2 });
    const tab = makeTab({ results: [r1, r2, r3], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByText(/3 statements/)).toBeInTheDocument();
  });

  it("active row has aria-selected=true and non-active has false", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("clicking a row calls sqlEditor.setActiveResult with correct ids", async () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    // Insert a real tab into the store so setActiveResult can find it
    sqlEditor.openBlank();
    const storeTab = sqlEditor.active!;
    storeTab.results = [r1, r2];
    storeTab.activeResultId = r1.id;

    render(ExecutionLog, { props: { tab: storeTab } });
    const options = screen.getAllByRole("option");
    await fireEvent.click(options[1]);
    expect(storeTab.activeResultId).toBe("r2");
  });

  it("status icon is ✓ for ok", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    const icons = screen.getAllByText("✓");
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it("status icon is ✗ for error", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({
      id: "r2",
      statementIndex: 1,
      status: "error",
      error: { code: -32013, message: "ORA-00942" },
    });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByText("✗")).toBeInTheDocument();
  });

  it("status icon is ⏸ for cancelled", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "cancelled" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByText("⏸")).toBeInTheDocument();
  });

  it("status icon is ⟳ for running", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "running" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByText("⟳")).toBeInTheDocument();
  });

  it("collapse toggle button is shown for multi-result tabs", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    const toggle = screen.getByRole("button", { name: /collapse log/i });
    expect(toggle).toBeInTheDocument();
  });

  it("clicking collapse toggle hides rows", async () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    // rows are visible initially
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /collapse log/i });
    await fireEvent.click(toggle);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("sqlPreview is truncated to 60 chars with ellipsis when longer", () => {
    const longSql = "SELECT " + "A".repeat(80) + " FROM dual";
    const r1 = makeResult({ id: "r1", statementIndex: 0, sqlPreview: longSql });
    const r2 = makeResult({ id: "r2", statementIndex: 1, sqlPreview: "SELECT 1" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    // The 60-char preview truncated version should appear
    const truncated = longSql.slice(0, 60) + "…";
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it("shows ⊞ icon (not ✓) when a result has dbmsOutput entries", () => {
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok" });
    const r2 = makeResult({
      id: "r2",
      statementIndex: 1,
      status: "ok",
      dbmsOutput: ["Hello from PL/SQL"],
    });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    expect(screen.getByText("⊞")).toBeInTheDocument();
    // r1 has no dbmsOutput so its icon is ✓
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders all dbmsOutput lines and no toggle when there are ≤5 lines", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok", dbmsOutput: lines });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    for (const line of lines) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /show \d+ more/i })).toBeNull();
  });

  it("shows only 5 lines and a 'show N more' button when dbmsOutput has >5 lines", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g"];
    const r1 = makeResult({ id: "r1", statementIndex: 0, status: "ok", dbmsOutput: lines });
    const r2 = makeResult({ id: "r2", statementIndex: 1, status: "ok" });
    const tab = makeTab({ results: [r1, r2], activeResultId: r1.id });
    render(ExecutionLog, { props: { tab } });
    // First 5 lines visible
    for (const line of lines.slice(0, 5)) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    // Lines beyond 5 are hidden initially
    for (const line of lines.slice(5)) {
      expect(screen.queryByText(line)).toBeNull();
    }
    // Toggle button shows the count of hidden lines (7 - 5 = 2)
    expect(screen.getByRole("button", { name: /show 2 more/i })).toBeInTheDocument();
  });
});
