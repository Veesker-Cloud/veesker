// sidecar/src/flow.ts
//
// Visual execution flow capture — produces a complete TraceResult that
// the frontend replays locally without further Oracle round-trips.
//
// Reuses the existing DBMS_DEBUG_JDWP infrastructure in debug.ts for
// PL/SQL traces, and the EXPLAIN PLAN path in oracle.ts for SQL traces.

import {
  MAX_VAR_VALUE_BYTES,
  MAX_STEP_VARIABLES_BYTES,
  SOURCE_LINE_MAX_CHARS,
  type Variable,
} from "./flow-types";

export function truncateValue(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  if (s.length <= MAX_VAR_VALUE_BYTES) return s;
  const totalBytes = s.length;
  const head = s.slice(0, MAX_VAR_VALUE_BYTES);
  return `${head}…(${totalBytes} total, truncated)`;
}

export function truncateSourceLine(s: string): string {
  if (s.length <= SOURCE_LINE_MAX_CHARS) return s;
  return s.slice(0, SOURCE_LINE_MAX_CHARS) + "…";
}

export function truncateVariablesForStep(vars: Variable[]): Variable[] {
  let used = 0;
  const out: Variable[] = [];
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    const truncatedValue = truncateValue(v.value);
    const size = v.name.length + v.type.length + truncatedValue.length;
    if (used + size > MAX_STEP_VARIABLES_BYTES) {
      const remaining = vars.length - i;
      out.push({
        name: "__truncated__",
        type: "marker",
        value: `${remaining} more variables omitted`,
      });
      return out;
    }
    used += size;
    out.push({ ...v, value: truncatedValue });
  }
  return out;
}

import type { StackEntry, TraceResult, PlsqlFrameEvent, TraceProcParams } from "./flow-types";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS } from "./flow-types";
import { DebugSession as RealDebugSession } from "./debug";
import oracledb from "oracledb";
import { procDescribe, oracleTypeFor, convertInputValue } from "./oracle";

// BREAK_ANY_CALL = step-into (line + descend into any sub-call).
// Spec wording suggested BREAK_ANY_LINE which would step over calls — but for a
// visual-flow tool the user wants to see calls into other procedures rendered as
// frames in the trace, which is what step-into delivers. This produces longer
// traces in heavily-nested procedures, capped by maxSteps (5000).
const BREAK_ANY_CALL = 6;

type DebugSessionFactory = () => Promise<any> | any;
let _debugSessionFactoryForTest: DebugSessionFactory | null = null;
export function setTraceProcDebugSessionFactoryForTest(f: DebugSessionFactory | null): void {
  _debugSessionFactoryForTest = f;
}

async function createDebugSession() {
  if (_debugSessionFactoryForTest) {
    return await _debugSessionFactoryForTest();
  }
  return await RealDebugSession.create();
}

type ProcDescribeFn = (p: { owner: string; name: string }) => Promise<{ params: any[] }>;
let _procDescribeForTest: ProcDescribeFn | null = null;
export function setProcDescribeForTest(fn: ProcDescribeFn | null): void {
  _procDescribeForTest = fn;
}

export async function traceProc(p: TraceProcParams): Promise<TraceResult> {
  const maxSteps = p.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const events: PlsqlFrameEvent[] = [];

  const session = await createDebugSession();
  let traceTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let traceTimedOut = false;

  try {
    try {
      await session.initialize();
    } catch (e) {
      // Cleanly tear down before propagating — initialize failure means no
      // further session operations are valid. Re-throw so callers see the Oracle error.
      session.stop();
      await session.closingPromise();
      throw e;
    }
    await session.setBreakpoint(p.owner.toUpperCase(), p.name.toUpperCase(), "PROCEDURE", 1);

    // Fetch procedure metadata so we can build a typed bind map matching ALL params
    // (Oracle requires every parameter — IN, OUT, IN/OUT — to appear in named-arg calls).
    const procDescribeFn = _procDescribeForTest ?? procDescribe;
    const desc = await procDescribeFn({ owner: p.owner, name: p.name });
    const paramMeta = (desc.params ?? []) as Array<{ name: string; dataType: string; direction: string }>;

    const ORACLE_IDENT_RE = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
    const binds: Record<string, oracledb.BindDefinition> = {};
    const callArgs: string[] = [];
    const cursorBindNames: string[] = [];

    for (const pm of paramMeta) {
      if (!ORACLE_IDENT_RE.test(pm.name)) {
        throw { code: -32602, message: `Invalid parameter name from ALL_ARGUMENTS: ${pm.name}` };
      }
      const isRefCursor = pm.dataType === "REF CURSOR";
      if (pm.direction === "IN") {
        const v = p.params.find((x) => x.name === pm.name);
        binds[`i_${pm.name}`] = {
          dir: oracledb.BIND_IN,
          val: convertInputValue(v?.value ?? "", pm.dataType),
        };
        callArgs.push(`${pm.name} => :i_${pm.name}`);
      } else if (pm.direction === "OUT" && !isRefCursor) {
        binds[`o_${pm.name}`] = {
          dir: oracledb.BIND_OUT,
          type: oracleTypeFor(pm.dataType),
          maxSize: 32767,
        };
        callArgs.push(`${pm.name} => :o_${pm.name}`);
      } else if (pm.direction === "OUT" && isRefCursor) {
        binds[`o_${pm.name}`] = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
        cursorBindNames.push(`o_${pm.name}`);
        callArgs.push(`${pm.name} => :o_${pm.name}`);
      } else if (pm.direction === "IN/OUT") {
        const v = p.params.find((x) => x.name === pm.name);
        binds[`io_${pm.name}`] = {
          dir: oracledb.BIND_INOUT,
          val: convertInputValue(v?.value ?? "", pm.dataType),
          type: oracleTypeFor(pm.dataType),
          maxSize: 32767,
        };
        callArgs.push(`${pm.name} => :io_${pm.name}`);
      }
    }

    const block = callArgs.length > 0
      ? `BEGIN ${p.owner}.${p.name}(${callArgs.join(", ")}); END;`
      : `BEGIN ${p.owner}.${p.name}; END;`;
    session.startTarget(block, binds, cursorBindNames);

    let info = await session.synchronizeWithTimeout(30_000);

    traceTimeoutHandle = setTimeout(() => { traceTimedOut = true; }, timeoutMs);

    // MVP variable strategy: poll IN/IN-OUT parameter names at every step.
    // Local v_* discovery requires PL/Scope (ALL_IDENTIFIERS) which is deferred to v0.4.
    const candidateNames = paramMeta
      .filter((pm) => pm.direction === "IN" || pm.direction === "IN/OUT")
      .map((pm) => pm.name);

    let stepIndex = 0;
    while (info.status === "paused" && info.frame !== null) {
      if (traceTimedOut) break;
      if (events.length >= maxSteps) break;

      const frame = info.frame;
      const vars = await safeGetVars(session, candidateNames);
      const stack = await safeGetCallStack(session);
      const sourceLine = "";

      const event: PlsqlFrameEvent = {
        kind: "plsql.frame",
        stepIndex,
        objectOwner: frame.owner,
        objectName: frame.objectName,
        lineNumber: frame.line,
        sourceLine: truncateSourceLine(sourceLine),
        enteredAtMs: Date.now() - startedAtMs,
        exitedAtMs: null,
        stack,
        variables: truncateVariablesForStep(vars),
      };
      if (events.length > 0) {
        events[events.length - 1].exitedAtMs = event.enteredAtMs;
      }
      events.push(event);
      stepIndex++;

      info = await session.continueExecution(BREAK_ANY_CALL);
    }
  } finally {
    if (traceTimeoutHandle !== null) clearTimeout(traceTimeoutHandle);
    session.stop();
    await session.closingPromise();
  }

  const totalElapsedMs = Date.now() - startedAtMs;
  const truncated = events.length >= maxSteps;
  const result: TraceResult = {
    kind: "plsql",
    startedAt,
    totalElapsedMs,
    events,
  };
  if (truncated) result.truncated = true;
  if (traceTimedOut) {
    result.error = { code: -32004, message: `Trace timed out after ${timeoutMs}ms`, atStep: events.length };
  }
  return result;
}

async function safeGetVars(
  session: any,
  candidateNames: string[],
): Promise<Variable[]> {
  if (candidateNames.length === 0) return [];
  try {
    const vals = await session.getValuesForVars(candidateNames);
    // Type label is hardcoded "VARCHAR2" because DBMS_DEBUG.GET_VALUE returns the
    // value as a coerced string and does not expose the original PL/SQL type.
    // Fetching ALL_ARGUMENTS for accurate types is deferred to v0.4 to keep this
    // hot loop fast (one round-trip per step is already the bottleneck).
    return (vals ?? []).map((v: any) => ({
      name: v.name,
      type: "VARCHAR2",
      value: v.value === null || v.value === undefined ? "" : String(v.value),
    }));
  } catch {
    return [];
  }
}

async function safeGetCallStack(session: any): Promise<StackEntry[]> {
  try {
    const frames = await session.getCallStack();
    return frames.map((f: any) => ({ name: f.objectName, line: f.line }));
  } catch {
    return [];
  }
}

import type { ExplainNodeEvent, TraceSqlParams } from "./flow-types";
import { explainPlan as realExplainPlan } from "./oracle";

type ExplainPlanFn = (p: { sql: string }) => Promise<{ nodes: any[] }>;
let _explainPlanForTest: ExplainPlanFn | null = null;
export function setExplainPlanForTest(fn: ExplainPlanFn | null): void {
  _explainPlanForTest = fn;
}

function planExecutionOrder(nodes: any[]): any[] {
  const childrenOf = new Map<number | null, any[]>();
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n);
    childrenOf.set(n.parentId, arr);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.id - b.id);

  const out: any[] = [];
  function visit(node: any): void {
    const kids = childrenOf.get(node.id) ?? [];
    for (const k of kids) visit(k);
    out.push(node);
  }
  const roots = childrenOf.get(null) ?? [];
  for (const r of roots) visit(r);
  return out;
}

type RuntimeStatsResult = {
  perPlanId: Map<number, { cardinalityActual: number | null; elapsedMsActual: number | null; bufferGets: number | null }>;
};

type RuntimeStatsRunner = (sql: string) => Promise<RuntimeStatsResult>;
let _runtimeStatsRunnerForTest: RuntimeStatsRunner | null = null;
export function setRuntimeStatsRunnerForTest(fn: RuntimeStatsRunner | null): void {
  _runtimeStatsRunnerForTest = fn;
}

async function gatherRuntimeStats(sql: string): Promise<RuntimeStatsResult> {
  if (_runtimeStatsRunnerForTest) return _runtimeStatsRunnerForTest(sql);
  // Real implementation — runs the SQL with hint, then queries V$SQL_PLAN_STATISTICS_ALL.
  // Connection access is via withActiveSession from oracle.ts.
  const { withActiveSession } = await import("./oracle");
  return withActiveSession(async (conn) => {
    // Safety: `sql` was already validated by realExplainPlan upstream (splitSql + DDL reject).
    // Hints cannot be passed as bind variables, so direct interpolation is required here.
    await conn.execute(`/*+ GATHER_PLAN_STATISTICS */ ${sql}`);
    const sqlIdRes = await conn.execute<{ SQL_ID: string; CHILD_NUMBER: number }>(
      `SELECT prev_sql_id AS SQL_ID, prev_child_number AS CHILD_NUMBER
         FROM V$SESSION
        WHERE audsid = USERENV('SESSIONID')`,
      [],
      { outFormat: 4002 /* OUT_FORMAT_OBJECT */ },
    );
    const ident = sqlIdRes.rows?.[0];
    if (!ident) return { perPlanId: new Map() };
    const stats = await conn.execute<{ ID: number; LAST_OUTPUT_ROWS: number; LAST_ELAPSED_TIME: number; LAST_CR_BUFFER_GETS: number }>(
      `SELECT id AS ID,
              last_output_rows  AS LAST_OUTPUT_ROWS,
              last_elapsed_time AS LAST_ELAPSED_TIME,
              last_cr_buffer_gets AS LAST_CR_BUFFER_GETS
         FROM V$SQL_PLAN_STATISTICS_ALL
        WHERE sql_id = :sid AND child_number = :cn`,
      { sid: ident.SQL_ID, cn: ident.CHILD_NUMBER },
      { outFormat: 4002 },
    );
    const perPlanId = new Map<number, { cardinalityActual: number | null; elapsedMsActual: number | null; bufferGets: number | null }>();
    for (const r of stats.rows ?? []) {
      perPlanId.set(r.ID, {
        cardinalityActual: r.LAST_OUTPUT_ROWS ?? null,
        elapsedMsActual: r.LAST_ELAPSED_TIME != null ? Math.round(r.LAST_ELAPSED_TIME / 1000) : null,
        bufferGets: r.LAST_CR_BUFFER_GETS ?? null,
      });
    }
    return { perPlanId };
  });
}

export async function explainPlanFlow(p: TraceSqlParams): Promise<TraceResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const explainFn = _explainPlanForTest ?? realExplainPlan;

  const { nodes } = await explainFn({ sql: p.sql });
  const ordered = planExecutionOrder(nodes);

  const childrenOf = new Map<number | null, number[]>();
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }

  let stats: RuntimeStatsResult = { perPlanId: new Map() };
  if (p.withRuntimeStats) {
    try {
      stats = await gatherRuntimeStats(p.sql);
    } catch {
      // Privilege denied or transient failure — silently fall back to static.
      stats = { perPlanId: new Map() };
    }
  }

  const events: ExplainNodeEvent[] = ordered.map((n, idx) => {
    const s = stats.perPlanId.get(n.id);
    return {
      kind: "explain.node",
      stepIndex: idx,
      planId: n.id,
      operation: [n.operation, n.options].filter(Boolean).join(" "),
      objectOwner: n.objectOwner ?? null,
      objectName: n.objectName ?? null,
      cost: n.cost ?? null,
      cardinalityEstimated: n.cardinality ?? null,
      cardinalityActual: s?.cardinalityActual ?? null,
      bytesEstimated: n.bytes ?? null,
      elapsedMsActual: s?.elapsedMsActual ?? null,
      bufferGets: s?.bufferGets ?? null,
      childIds: childrenOf.get(n.id) ?? [],
    };
  });

  return {
    kind: "sql",
    startedAt,
    totalElapsedMs: Date.now() - startedAtMs,
    events,
  };
}
