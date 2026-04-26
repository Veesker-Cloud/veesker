import { explainPlanGet, perfStats, type ExplainNode, type PerfTableStats } from "$lib/workspace";
import {
  classifyCost,
  detectRedFlags,
  detectStaleStats,
  type RedFlag,
  type StaleStat,
  type CostClass,
} from "$lib/perf/perf-rules";

export type AnalysisState =
  | { kind: "idle" }
  | { kind: "analyzing"; reqId: string; sql: string }
  | { kind: "analyzed"; reqId: string; sql: string; plan: ExplainNode[];
      stats: PerfTableStats[]; redFlags: RedFlag[]; costClass: CostClass;
      staleStats: StaleStat[] }
  | { kind: "skipped"; reason: "ddl" | "plsql" | "empty" | "disabled" | "session-busy" }
  | { kind: "error"; message: string; oraCode?: string };

export type PerfAnalyzer = {
  readonly state: AnalysisState;
  scheduleAnalysis(sql: string): void;
  setEnabled(enabled: boolean): void;
  setSessionBusy(busy: boolean): void;
  reset(): void;
};

const DEBOUNCE_MS = 500;
const CACHE_MAX = 64;
const CACHE_TTL_MS = 5 * 60 * 1000;

function isAnalyzableSql(sql: string): { kind: "ok" } | { kind: "skip"; reason: "ddl" | "plsql" | "empty" } {
  const trimmed = sql.trim().replace(/^(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)+/g, "").trimStart();
  if (trimmed === "") return { kind: "skip", reason: "empty" };
  const head = trimmed.toUpperCase();
  if (/^(BEGIN|DECLARE)\b/.test(head)) return { kind: "skip", reason: "plsql" };
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b/.test(head)) {
    return { kind: "skip", reason: "plsql" };
  }
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT)\b/.test(head)) {
    return { kind: "skip", reason: "ddl" };
  }
  if (!/^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|EXPLAIN)\b/.test(head)) {
    return { kind: "skip", reason: "ddl" };
  }
  return { kind: "ok" };
}

export function createPerfAnalyzer(): PerfAnalyzer {
  let _state = $state<AnalysisState>({ kind: "idle" });
  let _enabled = $state(true);
  let _sessionBusy = $state(false);
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _abort: AbortController | null = null;
  let _pendingSql: string | null = null;
  const _cache = new Map<string, { ts: number; result: AnalysisState }>();

  function cacheKey(sql: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < sql.length; i++) {
      h ^= sql.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function evictExpired() {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (now - v.ts > CACHE_TTL_MS) _cache.delete(k);
    }
    while (_cache.size > CACHE_MAX) {
      const k = _cache.keys().next().value;
      if (k === undefined) break;
      _cache.delete(k);
    }
  }

  async function runAnalysis(sql: string, reqId: string): Promise<void> {
    _state = { kind: "analyzing", reqId, sql };

    const ac = new AbortController();
    _abort?.abort();
    _abort = ac;

    const [planRes, statsRes] = await Promise.all([
      explainPlanGet(sql),
      perfStats(sql),
    ]);

    if (ac.signal.aborted) return;

    if (!planRes.ok) {
      _state = {
        kind: "error",
        message: planRes.error?.message ?? "Unknown error",
        oraCode: extractOraCode(planRes.error?.message),
      };
      return;
    }

    const plan = planRes.data.nodes;
    const stats = statsRes.ok ? statsRes.data.tables : [];

    const redFlags = detectRedFlags(plan, stats, sql);
    const costClass = classifyCost(plan[0]?.cost ?? null);
    const staleStats = detectStaleStats(stats);

    const result: AnalysisState = {
      kind: "analyzed", reqId, sql, plan, stats,
      redFlags, costClass, staleStats,
    };

    _cache.set(cacheKey(sql), { ts: Date.now(), result });
    evictExpired();
    _state = result;
  }

  function extractOraCode(msg?: string): string | undefined {
    if (!msg) return undefined;
    const m = msg.match(/(ORA-\d{5})/);
    return m ? m[1] : undefined;
  }

  function fire(sql: string): void {
    const checked = isAnalyzableSql(sql);
    if (checked.kind === "skip") {
      if (checked.reason === "empty") {
        _state = { kind: "idle" };
      } else {
        _state = { kind: "skipped", reason: checked.reason };
      }
      return;
    }
    if (!_enabled) {
      _state = { kind: "skipped", reason: "disabled" };
      return;
    }
    if (_sessionBusy) {
      _state = { kind: "skipped", reason: "session-busy" };
      _pendingSql = sql;
      return;
    }
    const cached = _cache.get(cacheKey(sql));
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      _state = cached.result;
      return;
    }
    const reqId = crypto.randomUUID();
    void runAnalysis(sql, reqId);
  }

  return {
    get state() { return _state; },
    scheduleAnalysis(sql: string) {
      if (_debounceTimer !== null) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        fire(sql);
      }, DEBOUNCE_MS);
    },
    setEnabled(enabled: boolean) {
      _enabled = enabled;
      if (!enabled) {
        if (_debounceTimer !== null) {
          clearTimeout(_debounceTimer);
          _debounceTimer = null;
        }
        _abort?.abort();
        _state = { kind: "skipped", reason: "disabled" };
      }
    },
    setSessionBusy(busy: boolean) {
      _sessionBusy = busy;
      if (!busy && _pendingSql !== null) {
        const sql = _pendingSql;
        _pendingSql = null;
        fire(sql);
      }
    },
    reset() {
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
      _abort?.abort();
      _abort = null;
      _pendingSql = null;
      _cache.clear();
      _state = { kind: "idle" };
    },
  };
}
