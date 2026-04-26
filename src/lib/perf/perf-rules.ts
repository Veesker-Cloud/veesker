import type { ExplainNode } from "$lib/workspace";

export type CostClass = "green" | "yellow" | "red" | "unknown";

// Single source of truth for the table-stats shape used by both the analyzer
// and the rule functions. Re-exported from `$lib/workspace` as `PerfTableStats`
// in Task 5 — those are the same type.
export type TableStats = {
  owner: string;
  name: string;
  numRows: number | null;
  lastAnalyzed: string | null;
  blocks: number | null;
  indexes: TableIndex[];
};

export type TableIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  status: string;
};

export type RedFlag = {
  id: string;
  severity: "critical" | "warn" | "info";
  message: string;
  suggestion?: string;
  line?: number | null;
  context: {
    table?: string;
    column?: string;
    operation?: string;
    cost?: number;
  };
};

export type StaleStat = {
  table: string;
  lastAnalyzed: string | null;
  ageDays: number | null;
};

const BIG_TABLE_THRESHOLD = 100_000;
const HIGH_COST_THRESHOLD = 100_000;
const STALE_STATS_DAYS = 30;

export function classifyCost(cost: number | null): CostClass {
  if (cost === null) return "unknown";
  if (cost < 1000) return "green";
  if (cost < HIGH_COST_THRESHOLD) return "yellow";
  return "red";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function detectStaleStats(stats: TableStats[], now: Date = new Date()): StaleStat[] {
  const out: StaleStat[] = [];
  for (const s of stats) {
    const fqn = `${s.owner}.${s.name}`;
    if (s.lastAnalyzed === null) {
      out.push({ table: fqn, lastAnalyzed: null, ageDays: null });
      continue;
    }
    const last = new Date(s.lastAnalyzed);
    if (Number.isNaN(last.getTime())) continue;
    const ageDays = Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
    if (ageDays > STALE_STATS_DAYS) {
      out.push({ table: fqn, lastAnalyzed: s.lastAnalyzed, ageDays });
    }
  }
  return out;
}

export function detectRedFlags(
  plan: ExplainNode[],
  stats: TableStats[],
  _sql: string,
  now: Date = new Date(),
): RedFlag[] {
  const flags: RedFlag[] = [];
  if (plan.length === 0) return flags;

  const statsByName = new Map(stats.map((s) => [s.name.toUpperCase(), s] as const));

  // R003 — High overall cost (root node cost)
  const rootCost = plan[0].cost;
  if (rootCost !== null && rootCost >= HIGH_COST_THRESHOLD) {
    flags.push({
      id: "R003", severity: "warn",
      message: `Estimated cost: ${rootCost.toLocaleString("en-US")}`,
      suggestion: "Heavy analysis — confirm before running in prod",
      context: { cost: rootCost },
    });
  }

  for (const node of plan) {
    // R001 — FULL TABLE SCAN on big table (or unknown size)
    if (node.operation === "TABLE ACCESS" && node.options === "FULL" && node.objectName) {
      const tableName = node.objectName.toUpperCase();
      const tableStats = statsByName.get(tableName);
      const numRows = tableStats?.numRows ?? null;
      const isBig = numRows === null || numRows > BIG_TABLE_THRESHOLD;
      if (isBig) {
        const sizeNote = numRows !== null
          ? ` (${numRows.toLocaleString("en-US")} rows)`
          : " (size unknown)";
        flags.push({
          id: "R001", severity: "critical",
          message: `FULL TABLE SCAN on \`${tableName}\`${sizeNote}`,
          suggestion: "Consider an index on the WHERE/JOIN columns",
          context: { table: tableName, operation: "TABLE ACCESS FULL" },
        });
      }
    }

    // R002 — Cartesian product
    const isCartesianMerge = node.operation === "MERGE JOIN" && node.options === "CARTESIAN";
    const isCartesianNL =
      node.operation === "NESTED LOOPS" &&
      !node.accessPredicates &&
      !node.filterPredicates;
    if (isCartesianMerge || isCartesianNL) {
      flags.push({
        id: "R002", severity: "critical",
        message: "CARTESIAN PRODUCT detected",
        suggestion: "Add the missing JOIN condition between tables",
        context: { operation: node.operation },
      });
    }
  }

  // R004 / R005 — stats freshness on tables referenced by FULL SCAN nodes
  // (only flag stats issues for tables we actually access — avoid noise)
  const accessedTables = new Set(
    plan
      .filter((n) => n.operation === "TABLE ACCESS" && n.objectName)
      .map((n) => n.objectName!.toUpperCase()),
  );
  for (const tableName of accessedTables) {
    const s = statsByName.get(tableName);
    if (!s) continue;
    if (s.lastAnalyzed === null) {
      flags.push({
        id: "R005", severity: "warn",
        message: `No stats on \`${tableName}\` — optimizer is guessing`,
        suggestion: `DBMS_STATS.GATHER_TABLE_STATS('${s.owner}', '${tableName}')`,
        context: { table: tableName },
      });
    } else {
      const last = new Date(s.lastAnalyzed);
      if (!Number.isNaN(last.getTime())) {
        const ageDays = Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
        if (ageDays > STALE_STATS_DAYS) {
          flags.push({
            id: "R004", severity: "warn",
            message: `Stats stale on \`${tableName}\` (${ageDays} days old)`,
            suggestion: `DBMS_STATS.GATHER_TABLE_STATS('${s.owner}', '${tableName}')`,
            context: { table: tableName },
          });
        }
      }
    }
  }

  return flags;
}
