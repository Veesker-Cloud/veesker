import { describe, expect, it, beforeEach, vi, type MockedFunction } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import QueryHistory from "./QueryHistory.svelte";
import { historyList, historyClear } from "$lib/query-history";
import type { HistoryEntry } from "$lib/query-history";

// ── Polyfill IntersectionObserver for jsdom ───────────────────────────────────
vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

// ── Mock query-history module ──────────────────────────────────────────────────
vi.mock("$lib/query-history", () => ({
  historyList: vi.fn(),
  historyClear: vi.fn(),
  historySave: vi.fn(),
}));

const mockedHistoryList = historyList as MockedFunction<typeof historyList>;
const mockedHistoryClear = historyClear as MockedFunction<typeof historyClear>;

// ── Mock sql-editor store ──────────────────────────────────────────────────────
let mockConnectionId: string | null = "conn-1";
let mockLoadHistoryEntry = vi.fn();

vi.mock("$lib/stores/sql-editor.svelte", () => ({
  sqlEditor: {
    get connectionId() { return mockConnectionId; },
    loadHistoryEntry: (...args: unknown[]) => mockLoadHistoryEntry(...args),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(partial: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: partial.id ?? 1,
    connectionId: partial.connectionId ?? "conn-1",
    sql: partial.sql ?? "SELECT 1 FROM dual",
    success: partial.success ?? true,
    rowCount: partial.rowCount ?? 1,
    elapsedMs: partial.elapsedMs ?? 5,
    errorCode: partial.errorCode ?? null,
    errorMessage: partial.errorMessage ?? null,
    executedAt: partial.executedAt ?? new Date(Date.now() - 60_000).toISOString(),
    ...partial,
  };
}

beforeEach(() => {
  mockConnectionId = "conn-1";
  mockLoadHistoryEntry = vi.fn();
  mockedHistoryList.mockReset();
  mockedHistoryClear.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("QueryHistory", () => {
  it("shows empty state when no entries returned", async () => {
    mockedHistoryList.mockResolvedValue({ ok: true, data: [] });
    render(QueryHistory);
    await waitFor(() => {
      expect(screen.getByText(/No queries yet/)).toBeInTheDocument();
    });
  });

  it("renders skeleton rows while loading (before historyList resolves)", async () => {
    // historyList never resolves during this test
    mockedHistoryList.mockReturnValue(new Promise(() => {}));
    render(QueryHistory);
    // Wait for the debounce (200ms) + effect to fire, which sets loading=true
    await waitFor(() => {
      const skeletons = document.querySelectorAll(".skeleton-row");
      expect(skeletons.length).toBeGreaterThanOrEqual(3);
    }, { timeout: 500 });
  });

  it("renders rows with truncated SQL, status icon, and relative time", async () => {
    const entry = makeEntry({
      id: 1,
      sql: "SELECT id, name, email, role FROM users WHERE active = 1 ORDER BY created_at DESC",
      success: true,
      rowCount: 42,
      executedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2m ago
    });
    mockedHistoryList.mockResolvedValue({ ok: true, data: [entry] });
    render(QueryHistory);
    await waitFor(() => {
      // Status icon for success
      expect(screen.getByText("✓")).toBeInTheDocument();
      // Relative time
      expect(screen.getByText(/2m ago/)).toBeInTheDocument();
      // Row count
      expect(screen.getByText(/42 rows/)).toBeInTheDocument();
      // SQL is truncated to 60 chars + ellipsis
      const truncated = entry.sql.slice(0, 60) + "…";
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });
  });

  it("shows ✗ status icon for failed entries", async () => {
    const entry = makeEntry({
      id: 2,
      sql: "SELECT * FROM nonexistent_table",
      success: false,
      rowCount: null,
      errorMessage: "ORA-00942",
    });
    mockedHistoryList.mockResolvedValue({ ok: true, data: [entry] });
    render(QueryHistory);
    await waitFor(() => {
      expect(screen.getByText("✗")).toBeInTheDocument();
    });
  });

  it("clicking a row calls sqlEditor.loadHistoryEntry with the entry", async () => {
    const entry = makeEntry({ id: 3, sql: "SELECT NOW()" });
    mockedHistoryList.mockResolvedValue({ ok: true, data: [entry] });
    render(QueryHistory);
    await waitFor(() => {
      expect(screen.getByTitle(entry.sql)).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTitle(entry.sql));
    expect(mockLoadHistoryEntry).toHaveBeenCalledWith(entry);
  });

  it("search input triggers a new fetch after debounce", async () => {
    mockedHistoryList.mockResolvedValue({ ok: true, data: [] });
    render(QueryHistory);
    // Initial fetch on mount
    await waitFor(() => expect(mockedHistoryList).toHaveBeenCalledTimes(1));

    const searchInput = screen.getByRole("searchbox", { name: /search history/i });
    await fireEvent.input(searchInput, { target: { value: "SELECT" } });

    // After debounce (200ms), another fetch should be triggered
    await waitFor(() => expect(mockedHistoryList).toHaveBeenCalledTimes(2), { timeout: 500 });
    expect(mockedHistoryList).toHaveBeenLastCalledWith("conn-1", 50, 0, "SELECT");
  });

  it("clear button calls historyClear after confirm and resets entries", async () => {
    const entry = makeEntry({ id: 4, sql: "SELECT 1" });
    mockedHistoryList.mockResolvedValue({ ok: true, data: [entry] });
    mockedHistoryClear.mockResolvedValue({ ok: true, data: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(QueryHistory);
    await waitFor(() => expect(screen.getByText("✓")).toBeInTheDocument());

    const clearBtn = screen.getByRole("button", { name: /clear history/i });
    await fireEvent.click(clearBtn);

    expect(mockedHistoryClear).toHaveBeenCalledWith("conn-1");
    await waitFor(() => {
      expect(screen.getByText(/No queries yet/)).toBeInTheDocument();
    });
  });

  it("shows idle state when connectionId is null", async () => {
    mockConnectionId = null;
    mockedHistoryList.mockResolvedValue({ ok: true, data: [] });
    render(QueryHistory);
    await waitFor(() => {
      expect(screen.getByText(/Connect to a database/)).toBeInTheDocument();
    });
    // historyList should not be called when connectionId is null
    expect(mockedHistoryList).not.toHaveBeenCalled();
  });
});
