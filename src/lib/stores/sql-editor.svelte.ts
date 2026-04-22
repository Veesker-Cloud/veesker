// src/lib/stores/sql-editor.svelte.ts
import { queryExecute, queryCancel, type QueryResult } from "$lib/sql-query";

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  running: boolean;
  error: { code: number; message: string } | null;
  runningRequestId: string | null;
};

let _tabs = $state<SqlTab[]>([]);
let _activeId = $state<string | null>(null);
let _drawerOpen = $state(false);
let _queryCounter = $state(0);

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

let _drawerHeight = $state<number>(loadDrawerHeight());
let _editorRatio = $state<number>(loadEditorRatio());

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
    result: null,
    running: false,
    error: null,
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

export const sqlEditor = {
  get tabs() { return _tabs; },
  get activeId() { return _activeId; },
  get drawerOpen() { return _drawerOpen; },
  get active(): SqlTab | null {
    return _activeId === null ? null : findTab(_activeId);
  },

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

  async runActive(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const sql = stripTrailingSemicolon(tab.sql);
    if (sql === "") return;
    const requestId = crypto.randomUUID();
    tab.running = true;
    tab.runningRequestId = requestId;
    tab.error = null;
    try {
      const res = await queryExecute(sql, requestId);
      if (res.ok) {
        tab.result = res.data;
        tab.error = null;
      } else {
        tab.error = res.error;
        tab.result = null;
      }
    } finally {
      tab.running = false;
      tab.runningRequestId = null;
    }
  },

  async cancelActive(): Promise<void> {
    const tab = this.active;
    if (tab === null || tab.runningRequestId === null) return;
    await queryCancel(tab.runningRequestId);
    // The original runActive promise will reject with code -2;
    // its finally block will clear running / runningRequestId.
  },

  reset(): void {
    _tabs.splice(0, _tabs.length);
    _activeId = null;
    _drawerOpen = false;
    _queryCounter = 0;
  },
};
