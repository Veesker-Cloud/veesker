// src/lib/stores/sql-editor.svelte.ts
import { queryExecute, queryExecuteMulti, queryCancel, type QueryResult } from "$lib/sql-query";
import { splitSql } from "$lib/sql-splitter";
import { historySave, type HistoryEntry } from "$lib/query-history";
import { saveAs, saveExisting, openFile } from "$lib/sql-files";
import { compileErrorsGet, connectionCommit, connectionRollback, explainPlanGet, type ProcExecuteResult } from "$lib/workspace";

export type CompileError = {
  line: number;
  position: number;
  text: string;
};

export type TabResult = {
  id: string;                         // crypto.randomUUID for selection stability
  statementIndex: number;             // 0-based; for display as "Statement N+1"
  sqlPreview: string;                 // first ~80 chars of the statement, single line
  status: "ok" | "error" | "cancelled" | "running" | "explain";
  result: QueryResult | null;
  error: { code: number; message: string } | null;
  elapsedMs: number;                  // 0 while running
  dbmsOutput: string[] | null;        // null = not captured; [] = enabled but nothing printed
  compileErrors: CompileError[] | null; // null = not a compilable stmt; [] = clean
  explainNodes: import("$lib/workspace").ExplainNode[] | null;
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
  filePath: string | null;            // null = never saved
  isDirty: boolean;                   // true when sql !== savedContent
  savedContent: string | null;        // content at last save/load; null if new tab
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

// ── Compile detection ─────────────────────────────────────────────────────────

export const COMPILE_REGEX =
  /^\s*CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE(\s+BODY)?|TYPE(\s+BODY)?)\s+("?\w+"?\.)?"?(\w+)"?/i;

function extractCompilable(sql: string): { objectType: string; objectName: string } | null {
  const m = COMPILE_REGEX.exec(sql);
  if (!m) return null;
  const rawType = m[3].toUpperCase();
  const body = (m[4] || m[5]) ? " BODY" : "";
  const objectType = rawType + body;
  const objectName = (m[7] ?? "").toUpperCase();
  if (!objectName) return null;
  return { objectType, objectName };
}

let _tabs = $state<SqlTab[]>([]);
let _activeId = $state<string | null>(null);
let _drawerOpen = $state(false);
let _queryCounter = $state(0);
let _connectionId: string | null = null;
let _pendingTx = $state(false);
let _editorExpanded = $state(false);

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

function loadHistoryPanelOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem("veesker.sql.historyPanelOpen");
    if (raw !== null) return raw === "true";
  } catch { /* Safari private mode */ }
  return true;
}

let _drawerHeight = $state<number>(loadDrawerHeight());
let _editorRatio = $state<number>(loadEditorRatio());
let _logCollapsed = $state<boolean>(loadLogCollapsed());
let _historyPanelOpen = $state<boolean>(loadHistoryPanelOpen());

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
    filePath: null,
    isDirty: false,
    savedContent: null,
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
  get pendingTx() { return _pendingTx; },
  clearPendingTx(): void { _pendingTx = false; },

  // ── Editor expanded (fullscreen mode) ─────────────────────────────────────
  get editorExpanded() { return _editorExpanded; },
  toggleEditorExpanded(): void { _editorExpanded = !_editorExpanded; },

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

  // ── History panel ──────────────────────────────────────────────────────────
  get historyPanelOpen() { return _historyPanelOpen; },
  toggleHistoryPanel(): void {
    _historyPanelOpen = !_historyPanelOpen;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker.sql.historyPanelOpen", String(_historyPanelOpen));
      }
    } catch { /* Safari private mode */ }
  },

  loadHistoryEntry(entry: HistoryEntry): void {
    const tab = makeTab(nextQueryTitle(), entry.sql);
    _tabs.push(tab);
    _activeId = tab.id;
    _drawerOpen = true;
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

  async openPreview(owner: string, name: string, pkCols?: string[]): Promise<void> {
    const orderBy = pkCols && pkCols.length > 0
      ? ` ORDER BY ${pkCols.map(c => `"${c}"`).join(", ")}`
      : "";
    const sql = `SELECT * FROM "${owner}"."${name}"${orderBy} FETCH FIRST 200 ROWS ONLY`;
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
    if (tab !== null) {
      tab.sql = sql;
      tab.isDirty = tab.savedContent !== null && tab.sql !== tab.savedContent;
    }
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
        dbmsOutput: null,
        compileErrors: null,
        explainNodes: null,
      };
      tab.results = [tabResult];
      tab.activeResultId = resultId;
      pushHistory(sql, tabResult);
      if (tabResult.status === "ok" && tabResult.result !== null && tabResult.result.columns.length === 0 && tabResult.result.rowCount > 0) {
        _pendingTx = true;
      }
      if (tabResult.status === "ok") {
        const compilable = extractCompilable(sql);
        if (compilable) {
          const tabId = tab.id;
          compileErrorsGet(compilable.objectType, compilable.objectName).then((ceRes) => {
            const t = _tabs.find((x) => x.id === tabId);
            if (!t) return;
            const r = t.results.find((x) => x.id === resultId);
            if (r) {
              r.compileErrors = ceRes.ok ? ceRes.data : [];
              _tabs = [..._tabs];
            }
          });
        }
      }
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
            dbmsOutput: null,
            compileErrors: null,
            explainNodes: null,
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
            dbmsOutput: sr.output ?? null,
            compileErrors: null,
            explainNodes: null,
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
            dbmsOutput: sr.output ?? null,
            compileErrors: null,
            explainNodes: null,
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
            dbmsOutput: null,
            compileErrors: null,
            explainNodes: null,
          };
        }
      });

      tab.results = tabResults;
      tab.activeResultId = chooseActiveResultId(tabResults);
      for (const tr of tabResults) {
        pushHistory(tr.sqlPreview, tr);
      }

      // Post-execution compile check for CREATE statements
      const tabId = tab.id;
      for (const sr of res.data.results) {
        if (sr.status !== "ok") continue;
        const compilable = extractCompilable(sr.sql);
        if (!compilable) continue;
        const resultId = tabResults[sr.statementIndex]?.id;
        if (!resultId) continue;
        compileErrorsGet(compilable.objectType, compilable.objectName).then((ceRes) => {
          const t = _tabs.find((x) => x.id === tabId);
          if (!t) return;
          const r = t.results.find((x) => x.id === resultId);
          if (r) {
            r.compileErrors = ceRes.ok ? ceRes.data : [];
            _tabs = [..._tabs];
          }
        });
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
        dbmsOutput: null,
        compileErrors: null,
        explainNodes: null,
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
        dbmsOutput: null,
        compileErrors: null,
        explainNodes: null,
      };
      tab.results = [tabResult];
      tab.activeResultId = resultId;
      pushHistory(sqlToRun, tabResult);
      if (tabResult.status === "ok") {
        const compilable = extractCompilable(sqlToRun);
        if (compilable) {
          const tabId = tab.id;
          compileErrorsGet(compilable.objectType, compilable.objectName).then((ceRes) => {
            const t = _tabs.find((x) => x.id === tabId);
            if (!t) return;
            const r = t.results.find((x) => x.id === resultId);
            if (r) {
              r.compileErrors = ceRes.ok ? ceRes.data : [];
              _tabs = [..._tabs];
            }
          });
        }
      }
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  async saveActive(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    if (tab.filePath === null) {
      await this.saveAsActive();
      return;
    }
    if (!tab.isDirty) return;
    const tabId = tab.id;
    const tabFilePath = tab.filePath;
    const sqlToSave = tab.sql;
    try {
      await saveExisting(tabFilePath, sqlToSave);
      const liveTab = findTab(tabId);
      if (liveTab === null) return;
      liveTab.savedContent = sqlToSave;
      liveTab.isDirty = false;
    } catch (e) {
      alert(`Save failed: ${String(e)}`);
    }
  },

  async saveAsActive(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const defaultName = tab.filePath
      ? tab.filePath.split("/").pop()!.replace(/\.sql$/i, "")
      : tab.title;
    const sqlToSave = tab.sql;
    const tabId = tab.id;
    try {
      const path = await saveAs(sqlToSave, defaultName);
      if (path === null) return;
      const liveTab = findTab(tabId);
      if (liveTab === null) return;
      liveTab.filePath = path;
      const base = path.split("/").pop() ?? path;
      liveTab.title = base.replace(/\.sql$/i, "");
      liveTab.savedContent = sqlToSave;
      liveTab.isDirty = liveTab.sql !== sqlToSave;
    } catch (e) {
      alert(`Save failed: ${String(e)}`);
    }
  },

  async openFromFile(): Promise<void> {
    try {
      const result = await openFile();
      if (result === null) return;
      const base = result.path.split("/").pop() ?? result.path;
      const title = base.replace(/\.sql$/i, "");
      const tab = makeTab(title, result.content);
      tab.filePath = result.path;
      tab.savedContent = result.content;
      tab.isDirty = false;
      _tabs.push(tab);
      _activeId = tab.id;
      _drawerOpen = true;
    } catch (e) {
      alert(`Open failed: ${String(e)}`);
    }
  },

  async cancelActive(): Promise<void> {
    const tab = this.active;
    if (tab === null || tab.runningRequestId === null) return;
    await queryCancel(tab.runningRequestId);
    // The original run promise will reject with code -2;
    // its finally block will clear running / runningRequestId.
  },

  openWithDdl(title: string, ddl: string): void {
    // If a tab with this title already exists, just activate it
    const existing = _tabs.find(t => t.title === title);
    if (existing) {
      _activeId = existing.id;
      if (!_drawerOpen) _drawerOpen = true;
      return;
    }
    const id = crypto.randomUUID();
    const tab: SqlTab = {
      id,
      title,
      sql: ddl,
      results: [],
      activeResultId: null,
      running: false,
      runningRequestId: null,
      splitterError: null,
      filePath: null,
      isDirty: false,
      savedContent: null,
    };
    _tabs = [..._tabs, tab];
    _activeId = id;
    if (!_drawerOpen) _drawerOpen = true;
  },

  async commit(): Promise<void> {
    const res = await connectionCommit();
    if (!res.ok) throw new Error(res.error.message ?? "Commit failed");
    _pendingTx = false;
  },

  async rollback(): Promise<void> {
    const res = await connectionRollback();
    if (!res.ok) throw new Error(res.error.message ?? "Rollback failed");
    _pendingTx = false;
  },

  reset(): void {
    _tabs.splice(0, _tabs.length);
    _activeId = null;
    _drawerOpen = false;
    _queryCounter = 0;
    _logCollapsed = false;
    _connectionId = null;
    _pendingTx = false;
    _editorExpanded = false;
  },
};

export async function runExplain(sql: string): Promise<void> {
  const tab = _tabs.find((t) => t.id === _activeId);
  if (!tab) return;
  const res = await explainPlanGet(sql);
  const resultId = crypto.randomUUID();
  const tabResult: TabResult = {
    id: resultId,
    statementIndex: 0,
    sqlPreview: "EXPLAIN PLAN",
    status: res.ok ? "explain" : "error",
    result: null,
    error: res.ok ? null : res.error,
    elapsedMs: 0,
    dbmsOutput: null,
    compileErrors: null,
    explainNodes: res.ok ? res.data.nodes : null,
  };
  const t = _tabs.find((x) => x.id === _activeId);
  if (!t) return;
  t.results = [...t.results, tabResult];
  t.activeResultId = resultId;
  _tabs = [..._tabs];
}

export function setActiveResult(tabId: string, resultId: string): void {
  const tab = _tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (!tab.results.some((r) => r.id === resultId)) return;
  tab.activeResultId = resultId;
  _tabs = [..._tabs];
}

export function addProcResults(result: ProcExecuteResult): void {
  const tab = _tabs.find((t) => t.id === _activeId);
  if (!tab) {
    console.warn("addProcResults: no active tab to attach results to");
    return;
  }

  const logLines: string[] = [
    ...result.outParams.map((p) => `OUT ${p.name} = ${p.value}`),
    ...result.dbmsOutput,
  ];

  let lastId: string | null = null;

  if (result.refCursors.length > 0) {
    for (const rc of result.refCursors) {
      const id = crypto.randomUUID();
      tab.results = [
        ...tab.results,
        {
          id,
          statementIndex: 0,
          sqlPreview: `REF CURSOR: ${rc.name}`,
          status: "ok",
          result: { columns: rc.columns, rows: rc.rows, rowCount: rc.rows.length, elapsedMs: 0 },
          error: null,
          elapsedMs: 0,
          dbmsOutput: logLines.length > 0 ? logLines : null,
          compileErrors: null,
          explainNodes: null,
        },
      ];
      lastId = id;
    }
  } else {
    const id = crypto.randomUUID();
    tab.results = [
      ...tab.results,
      {
        id,
        statementIndex: 0,
        sqlPreview: "Procedure executed",
        status: "ok",
        result: null,
        error: null,
        elapsedMs: 0,
        dbmsOutput: logLines.length > 0 ? logLines : ["(no output)"],
        compileErrors: null,
        explainNodes: null,
      },
    ];
    lastId = id;
  }

  if (lastId) tab.activeResultId = lastId;
  _tabs = [..._tabs];
}
