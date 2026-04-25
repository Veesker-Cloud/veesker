// sidecar/src/flow-types.ts
//
// Shared types between flow.ts (capture) and the RPC boundary (consumed
// by Rust + frontend). Keep this file small and dependency-free so the
// RPC schema stays decoupled from oracledb.

export type StackEntry = { name: string; line: number };

export type Variable = {
  name: string;
  type: string;
  value: string;
};

export type PlsqlFrameEvent = {
  kind: "plsql.frame";
  stepIndex: number;
  objectOwner: string;
  objectName: string;
  lineNumber: number;
  sourceLine: string;
  enteredAtMs: number;
  exitedAtMs: number | null;
  stack: StackEntry[];
  variables: Variable[];
  branchTaken?: "then" | "else" | "loop" | "exit";
};

export type ExplainNodeEvent = {
  kind: "explain.node";
  stepIndex: number;
  planId: number;
  operation: string;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinalityEstimated: number | null;
  cardinalityActual: number | null;
  bytesEstimated: number | null;
  elapsedMsActual: number | null;
  bufferGets: number | null;
  childIds: number[];
};

export type TraceEvent = PlsqlFrameEvent | ExplainNodeEvent;

export type TraceResult = {
  kind: "plsql" | "sql";
  startedAt: string;
  totalElapsedMs: number;
  events: TraceEvent[];
  finalResult?: {
    rowCount?: number;
    outBinds?: Record<string, unknown>;
  };
  truncated?: boolean;
  error?: { code: number; message: string; atStep?: number };
};

export type TraceProcParams = {
  owner: string;
  name: string;
  // params is the same shape ProcExecuteParams uses — only IN/INOUT need values;
  // OUT params are looked up from procDescribe metadata.
  params: { name: string; value: string }[];
  maxSteps?: number;
  timeoutMs?: number;
};

export type TraceSqlParams = {
  sql: string;
  withRuntimeStats?: boolean;
};

// Truncation budgets — exposed so tests can verify them.
export const MAX_VAR_VALUE_BYTES = 1024;
export const MAX_STEP_VARIABLES_BYTES = 64 * 1024;
export const SOURCE_LINE_MAX_CHARS = 200;
export const DEFAULT_MAX_STEPS = 5000;
export const DEFAULT_TIMEOUT_MS = 60_000;
