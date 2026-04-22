// src/lib/stores/sql-editor.svelte.ts
import { queryExecute, type QueryResult } from "$lib/sql-query";

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  running: boolean;
  error: { code: number; message: string } | null;
};

let _tabs = $state<SqlTab[]>([]);
let _activeId = $state<string | null>(null);
let _drawerOpen = $state(false);
let _queryCounter = $state(0);

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
    tab.running = true;
    tab.error = null;
    try {
      const res = await queryExecute(sql);
      if (res.ok) {
        tab.result = res.data;
        tab.error = null;
      } else {
        tab.error = res.error;
        tab.result = null;
      }
    } finally {
      tab.running = false;
    }
  },

  reset(): void {
    _tabs.splice(0, _tabs.length);
    _activeId = null;
    _drawerOpen = false;
    _queryCounter = 0;
  },
};
