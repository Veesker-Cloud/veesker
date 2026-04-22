// src/lib/stores/sql-editor.svelte.ts
import { queryExecute, queryExecuteMulti, queryCancel, type QueryResult } from "$lib/sql-query";
import { splitSql } from "$lib/sql-splitter";
import { historySave } from "$lib/query-history";

export type TabResult = {
  id: string;                         // crypto.randomUUID for selection stability
  statementIndex: number;             // 0-based; for display as "Statement N+1"
  sqlPreview: string;                 // first ~80 chars of the statement, single line
  status: "ok" | "error" | "cancelled" | "running";
  result: QueryResult | null;
  error: { code: number; message: string } | null;
  elapsedMs: number;                  // 0 while running
};

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  results: TabResult[];               // replaces `result` + `error`
  activeResultId: string | null;      // which result is shown in the grid
  running: boolean;                   // still useful for the tab badge / cancel overlay
  runningRequestId: string | null;    // for cancel
  splitterError: string | null;       // if the splitter emitted errors, show banner
};

/** Returns the active TabResult for a tab, or null if none. */
export function activeResult(tab: SqlTab): TabResult | null {
  if (tab.activeResultId === null) return null;
  return tab.results.find((r) => r.id === tab.activeResultId) ?? null;
}

/** Truncate sql to first ~80 chars, single line. */
function makeSqlPreview(sql: string): string {
  const single = sql.replace(/\s+/g, " ").trim();
  return single.length > 80 ? single.slice(0, 80) : single;
}

let _tabs = $state<SqlTab[]>([]);
let _activeId = $state<string | null>(null);
let _drawerOpen = $state(false);
let _queryCounter = $state(0);
let _connectionId: string | null = null;

// ── Drawer height ────────────────────────────────────────────────────────────

function loadDrawerHeight(): number {
  if (typeof window === "undefined") return 360;
  try {
    const raw = localStorage.getItem("veesker.sql.drawerHeight");
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 120 && n <= 2000) return n;
    }
  } catch {
    // Safari private mode or restricted environment
  }
  return Math.round(window.innerHeight * 0.4);
}

function loadEditorRatio(): number {
  if (typeof window === "undefined") return 0.35;
  try {
    const raw = localStorage.getItem("veesker.sql.editorRatio");
    if (raw !== null) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n >= 0.15 && n <= 0.85) return n;
    }
  } catch {
    // Safari private mode or restricted environment
  }
  return 0.35;
}

function loadLogCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem("veesker.sql.logCollapsed");
    if (raw !== null) return raw === "true";
  } catch { /* Safari private mode */ }
  return false;
}

let _drawerHeight = $state<number>(loadDrawerHeight());
let _editorRatio = $state<number>(loadEditorRatio());
let _logCollapsed = $state<boolean>(loadLogCollapsed());

// ── Helpers ──────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function nextQueryTitle(): string {
  _queryCounter += 1;
  return `Query ${_queryCounter}`;
}

function makeTab(title: string, sql: string): SqlTab {
  return {
    id: newId(),
    title,
    sql,
    results: [],
    activeResultId: null,
    running: false,
    splitterError: null,
    runningRequestId: null,
  };
}

function findTab(id: string): SqlTab | null {
  return _tabs.find((t) => t.id === id) ?? null;
}

function stripTrailingSemicolon(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.endsWith(";")) return trimmed.slice(0, -1).trim();
  return trimmed;
}

/**
 * Choose which result id to set as activeResultId after a run.
 * Prefer the last ok result that has columns (i.e. a SELECT with rows).
 * Fallback to the last result's id.
 */
function chooseActiveResultId(results: TabResult[]): string | null {
  if (results.length === 0) return null;
  // Find last ok result with columns (SELECT-like)
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r.status === "ok" && r.result !== null && r.result.columns.length > 0) {
      return r.id;
    }
  }
  // Fallback to last result
  return results[results.length - 1].id;
}

/** Fire-and-forget: persist a completed statement to query history. */
function pushHistory(sql: string, r: TabResult): void {
  if (_connectionId === null) return;
  if (r.status === "cancelled") return;
  void historySave({
    connectionId: _connectionId,
    sql,
    success: r.status === "ok",
    rowCount: r.status === "ok" && r.result !== null ? r.result.rowCount : null,
    elapsedMs: r.elapsedMs,
    errorCode: r.status === "error" && r.error !== null ? r.error.code : null,
    errorMessage: r.status === "error" && r.error !== null ? r.error.message : null,
  }).catch((e) => console.warn("history save failed:", e));
}

export const sqlEditor = {
  get tabs() { return _tabs; },
  get activeId() { return _activeId; },
  get drawerOpen() { return _drawerOpen; },
  get active(): SqlTab | null {
    return _activeId === null ? null : findTab(_activeId);
  },
  get connectionId() { return _connectionId; },
  setConnectionId(id: string | null): void { _connectionId = id; },

  // ── Drawer height ──────────────────────────────────────────────────────────
  get drawerHeight() { return _drawerHeight; },
  setDrawerHeight(px: number): void {
    const clamped = Math.max(120, Math.min(2000, px));
    _drawerHeight = clamped;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker.sql.drawerHeight", String(Math.round(clamped)));
      }
    } catch {
      // Safari private mode or restricted environment
    }
  },

  // ── Editor ratio ───────────────────────────────────────────────────────────
  get editorRatio() { return _editorRatio; },
  setEditorRatio(r: number): void {
    const clamped = Math.max(0.15, Math.min(0.85, r));
    _editorRatio = clamped;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker.sql.editorRatio", clamped.toFixed(4));
      }
    } catch {
      // Safari private mode or restricted environment
    }
  },

  // ── Log collapsed ──────────────────────────────────────────────────────────
  get logCollapsed() { return _logCollapsed; },
  toggleLog(): void {
    _logCollapsed = !_logCollapsed;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker.sql.logCollapsed", String(_logCollapsed));
      }
    } catch { /* Safari private mode */ }
  },

  setActiveResult(tabId: string, resultId: string): void {
    const tab = findTab(tabId);
    if (tab === null) return;
    const exists = tab.results.some((r) => r.id === resultId);
    if (!exists) return;
    tab.activeResultId = resultId;
  },

  openBlank(): void {
    const tab = makeTab(nextQueryTitle(), "");
    _tabs.push(tab);
    _activeId = tab.id;
    _drawerOpen = true;
  },

  async openPreview(owner: string, name: string): Promise<void> {
    const sql = `SELECT * FROM "${owner}"."${name}" FETCH FIRST 100 ROWS ONLY`;
    const tab = makeTab(`${owner}.${name}`, sql);
    _tabs.push(tab);
    _activeId = tab.id;
    _drawerOpen = true;
    await this.runActive();
  },

  closeTab(id: string): void {
    const idx = _tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    _tabs.splice(idx, 1);
    if (_activeId === id) {
      if (_tabs.length === 0) {
        _activeId = null;
      } else {
        _activeId = _tabs[Math.max(0, idx - 1)].id;
      }
    }
  },

  setActive(id: string): void {
    if (findTab(id) !== null) _activeId = id;
  },

  updateSql(id: string, sql: string): void {
    const tab = findTab(id);
    if (tab !== null) tab.sql = sql;
  },

  toggleDrawer(): void {
    _drawerOpen = !_drawerOpen;
  },

  /** Run the active tab's full SQL as a single statement (cursor-based or whole-buffer). */
  async runActive(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const sql = stripTrailingSemicolon(tab.sql);
    if (sql === "") return;
    const requestId = crypto.randomUUID();
    const resultId = newId();
    tab.running = true;
    tab.runningRequestId = requestId;
    tab.splitterError = null;
    tab.results = [];
    tab.activeResultId = null;
    try {
      const res = await queryExecute(sql, requestId);
      const tabResult: TabResult = {
        id: resultId,
        statementIndex: 0,
        sqlPreview: makeSqlPreview(sql),
        status: res.ok ? "ok" : "error",
        result: res.ok ? res.data : null,
        error: res.ok ? null : res.error,
        elapsedMs: res.ok ? res.data.elapsedMs : 0,
      };
      tab.results = [tabResult];
      tab.activeResultId = resultId;
      pushHistory(sql, tabResult);
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  /** Run all statements in the active tab using the SQL splitter. */
  async runActiveAll(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const sql = tab.sql;
    if (sql.trim() === "") return;

    // Pre-flight: check splitter on the frontend first to catch errors early.
    const { errors } = splitSql(sql);
    if (errors.length > 0) {
      tab.splitterError = errors.map((e) => `line ${e.line}: ${e.message}`).join("; ");
      tab.results = [];
      tab.activeResultId = null;
      return;
    }

    const requestId = crypto.randomUUID();
    tab.running = true;
    tab.runningRequestId = requestId;
    tab.splitterError = null;
    tab.results = [];
    tab.activeResultId = null;

    try {
      const res = await queryExecuteMulti(sql, requestId);
      if (!res.ok) {
        // Server-side error (e.g. splitter error from sidecar, or session lost)
        const errMsg = res.error?.message ?? "Unknown error";
        // Check if it's a splitter error from the sidecar
        if (typeof res.error?.code === "number" && res.error.code === -32014) {
          tab.splitterError = errMsg.replace(/^Splitter error:\s*/i, "");
        } else {
          // Generic error: create a single error result
          const errResult: TabResult = {
            id: newId(),
            statementIndex: 0,
            sqlPreview: makeSqlPreview(sql),
            status: "error",
            result: null,
            error: res.error ?? { code: -32000, message: errMsg },
            elapsedMs: 0,
          };
          tab.results = [errResult];
          tab.activeResultId = errResult.id;
        }
        return;
      }

      const tabResults: TabResult[] = res.data.results.map((sr) => {
        const id = newId();
        const sqlPreview = makeSqlPreview(sr.sql);
        if (sr.status === "ok") {
          return {
            id,
            statementIndex: sr.statementIndex,
            sqlPreview,
            status: "ok" as const,
            result: { columns: sr.columns, rows: sr.rows, rowCount: sr.rowCount, elapsedMs: sr.elapsedMs },
            error: null,
            elapsedMs: sr.elapsedMs,
          };
        } else if (sr.status === "error") {
          return {
            id,
            statementIndex: sr.statementIndex,
            sqlPreview,
            status: "error" as const,
            result: null,
            error: sr.error,
            elapsedMs: sr.elapsedMs,
          };
        } else {
          // cancelled
          return {
            id,
            statementIndex: sr.statementIndex,
            sqlPreview,
            status: "cancelled" as const,
            result: null,
            error: null,
            elapsedMs: sr.elapsedMs,
          };
        }
      });

      tab.results = tabResults;
      tab.activeResultId = chooseActiveResultId(tabResults);
      for (const tr of tabResults) {
        pushHistory(tr.sqlPreview, tr);
      }
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  /** Run a selection of text as a single statement. */
  async runSelection(selection: string): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const sql = stripTrailingSemicolon(selection);
    if (sql === "") return;
    const requestId = crypto.randomUUID();
    const resultId = newId();
    tab.running = true;
    tab.runningRequestId = requestId;
    tab.splitterError = null;
    tab.results = [];
    tab.activeResultId = null;
    try {
      const res = await queryExecute(sql, requestId);
      const tabResult: TabResult = {
        id: resultId,
        statementIndex: 0,
        sqlPreview: makeSqlPreview(sql),
        status: res.ok ? "ok" : "error",
        result: res.ok ? res.data : null,
        error: res.ok ? null : res.error,
        elapsedMs: res.ok ? res.data.elapsedMs : 0,
      };
      tab.results = [tabResult];
      tab.activeResultId = resultId;
      pushHistory(sql, tabResult);
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  /**
   * Run the statement that contains the cursor position.
   * Splits the document, finds which statement the cursor is inside,
   * and runs just that one. Falls back to running the whole tab if no match.
   */
  async runStatementAtCursor(fullText: string, cursorPos: number): Promise<void> {
    const tab = this.active;
    if (tab === null) return;

    const { statements, errors } = splitSql(fullText);
    if (errors.length > 0 || statements.length === 0) {
      // Can't split — fall back to running whole buffer as single statement
      return this.runActive();
    }

    // Recover each statement's start/end character position in the original text
    // by scanning forward with indexOf from the last match end.
    let searchFrom = 0;
    let matchedSql: string | null = null;

    for (const stmt of statements) {
      const idx = fullText.indexOf(stmt, searchFrom);
      if (idx === -1) continue;
      const stmtEnd = idx + stmt.length;
      if (cursorPos >= idx && cursorPos <= stmtEnd) {
        matchedSql = stmt;
        break;
      }
      searchFrom = stmtEnd;
    }

    if (matchedSql === null) {
      // Cursor is between statements — find the nearest one before cursor
      searchFrom = 0;
      let lastBeforeCursor: string | null = null;
      for (const stmt of statements) {
        const idx = fullText.indexOf(stmt, searchFrom);
        if (idx === -1) continue;
        if (idx <= cursorPos) {
          lastBeforeCursor = stmt;
        }
        searchFrom = idx + stmt.length;
      }
      matchedSql = lastBeforeCursor ?? statements[0];
    }

    const requestId = crypto.randomUUID();
    const resultId = newId();
    tab.running = true;
    tab.runningRequestId = requestId;
    tab.splitterError = null;
    tab.results = [];
    tab.activeResultId = null;

    const sqlToRun = stripTrailingSemicolon(matchedSql);
    try {
      const res = await queryExecute(sqlToRun, requestId);
      const tabResult: TabResult = {
        id: resultId,
        statementIndex: 0,
        sqlPreview: makeSqlPreview(sqlToRun),
        status: res.ok ? "ok" : "error",
        result: res.ok ? res.data : null,
        error: res.ok ? null : res.error,
        elapsedMs: res.ok ? res.data.elapsedMs : 0,
      };
      tab.results = [tabResult];
      tab.activeResultId = resultId;
      pushHistory(sqlToRun, tabResult);
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  async cancelActive(): Promise<void> {
    const tab = this.active;
    if (tab === null || tab.runningRequestId === null) return;
    await queryCancel(tab.runningRequestId);
    // The original run promise will reject with code -2;
    // its finally block will clear running / runningRequestId.
  },

  reset(): void {
    _tabs.splice(0, _tabs.length);
    _activeId = null;
    _drawerOpen = false;
    _queryCounter = 0;
    _logCollapsed = false;
    _connectionId = null;
  },
};
