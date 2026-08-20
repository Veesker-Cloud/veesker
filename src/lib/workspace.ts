// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { invoke } from "@tauri-apps/api/core";
import type { TableStats, TableIndex } from "$lib/perf/perf-rules";

export type WorkspaceInfo = {
  serverVersion: string;
  currentSchema: string;
  apex?: ApexDetectResult | null;
  user: string;          // L3.5 — uppercase username for StatusBar user@service
  serviceName: string;   // L3.5 — extracted from connectString
};
export type Schema = { name: string; isCurrent: boolean };
export type ObjectKind =
  | "TABLE" | "VIEW" | "SEQUENCE"
  | "PROCEDURE" | "FUNCTION" | "PACKAGE" | "TRIGGER" | "TYPE"
  | "REST_MODULE"
  | "MATERIALIZED_VIEW" | "SYNONYM" | "DB_LINK"
  | "DIRECTORY"
  | "QUEUE"
  | "SCHEDULER_JOB"
  | "DB_USER"
  | "PRIVILEGE";
export type ObjectRef = { name: string };
export type ObjectRefWithStatus = { name: string; status: string };
export type Column = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  dataDefault: string | null;
  comments: string | null;
  isVector?: boolean;
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: Column[];
  indexes: IndexDef[];
  rowCount: number | null;
  lastAnalyzed: string | null;
};

export type TriggerRef     = { name: string; triggerType: string; event: string; status: string; forEach: string };
export type FkOutgoing     = { constraintName: string; columns: string; refOwner: string; refTable: string; refColumns: string; deleteRule: string };
export type FkIncoming     = { fkOwner: string; fkTable: string; constraintName: string; columns: string; deleteRule: string };
export type Dependent      = { owner: string; name: string; type: string };
export type CheckConstraint= { name: string; columns: string; condition: string; type: string; status: string };
export type TableGrant     = { grantor: string; grantee: string; privilege: string; grantable: string };
export type TableRelated   = {
  triggers:    TriggerRef[];
  fksOut:      FkOutgoing[];
  fksIn:       FkIncoming[];
  dependents:  Dependent[];
  constraints: CheckConstraint[];
  grants:      TableGrant[];
};

export type WorkspaceError = { code: number; message: string };

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: WorkspaceError };

export type Loadable<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  | { kind: "err"; message: string };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const workspaceOpen  = (connectionId: string) =>
  call<WorkspaceInfo>("workspace_open", { connectionId });
export const workspaceClose = () => {
  // F-C-001: revoke terminal-session trust on workspace close (defense in depth,
  // pairs with terminal.rs#terminal_revoke_session). Fire-and-forget so a Tauri
  // failure here cannot block the close itself.
  void invoke("terminal_revoke_session").catch(() => {});
  return call<void>("workspace_close");
};
export const schemaList     = () =>
  call<Schema[]>("schema_list");
export const objectsList    = (owner: string, kind: ObjectKind) =>
  call<ObjectRef[]>("objects_list", { owner, kind });
export const tableDescribe  = (owner: string, name: string) =>
  call<TableDetails>("table_describe", { owner, name });
export const tableRelated   = (owner: string, name: string) =>
  call<TableRelated>("table_related", { owner, name });
export const tableCountRows = (owner: string, name: string) =>
  call<{ count: number }>("table_count_rows", { owner, name });

export type SearchResult = { owner: string; name: string; objectType: string };

export const objectsSearch = (query: string) =>
  call<SearchResult[]>("objects_search", { query });

export const schemaKindCounts = (owner: string) =>
  call<{ counts: Record<string, number> }>("schema_kind_counts", { owner });

export const NO_ACTIVE_SESSION = -32010;
export const SESSION_LOST      = -32011;
export const OBJECT_NOT_FOUND  = -32012;
export const ORACLE_ERR        = -32013;

export type CompileError = { line: number; position: number; text: string };

export const compileErrorsGet = (objectType: string, objectName: string) =>
  call<CompileError[]>("compile_errors_get", { objectType, objectName });

export type OrdsDetectResult = {
  installed: boolean;
  userHasAccess: boolean;
  version: string | null;
  currentSchemaEnabled: boolean;
  hasAdminRole: boolean;
  ordsBaseUrl: string | null;
};

export const ordsDetect = () =>
  call<OrdsDetectResult>("ords_detect", {});

export type ApexCapability = {
  view: string;
  minVersion: string;
  enabled: boolean;
};

export type ApexDetectResult = {
  installed: boolean;
  userHasAccess: boolean;
  version: string | null;
  supported: boolean;
  minSupportedVersion: "19.2";
  capabilities: ApexCapability[];
};

export const apexDetect = () =>
  call<ApexDetectResult>("apex_detect", {});

export type ApexWorkspaceRow = {
  workspace: string;
  workspaceId: number | null;
};

export type ApexApplicationRow = {
  workspace: string;
  applicationId: number;
  name: string;
  alias: string | null;
  owner: string | null;
};

export type ApexPageRow = {
  applicationId: number;
  pageId: number;
  name: string;
  alias: string | null;
  pageMode: string | null;
};

export const apexWorkspacesList = () =>
  call<{ workspaces: ApexWorkspaceRow[]; accessDenied: boolean }>("apex_workspaces_list", {});

export const apexApplicationsList = (workspace: string) =>
  call<{ applications: ApexApplicationRow[]; accessDenied: boolean }>("apex_applications_list", { workspace });

export const apexPagesList = (applicationId: number) =>
  call<{ pages: ApexPageRow[]; accessDenied: boolean }>("apex_pages_list", { applicationId });

export type RestModule = {
  name: string;
  basePath: string;
  status: string;
  itemsPerPage: number | null;
  comments: string | null;
};

export type RestHandler = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  sourceType: string;
  source: string;
  itemsPerPage: number | null;
};

export type RestTemplate = {
  uriTemplate: string;
  priority: number;
  handlers: RestHandler[];
};

export type RestPrivilege = {
  name: string;
  roles: string[];
  patterns: string[];
};

export type RestModuleDetail = {
  module: RestModule;
  templates: RestTemplate[];
  privileges: RestPrivilege[];
};

export const ordsModulesList = (owner: string) =>
  call<RestModule[]>("ords_modules_list", { owner });

export const ordsModuleGet = (owner: string, name: string) =>
  call<RestModuleDetail>("ords_module_get", { owner, name });

export const ordsEnableSchema = () =>
  call<void>("ords_enable_schema", {});

export const ordsModuleExportSql = (owner: string, name: string) =>
  call<{ sql: string }>("ords_module_export_sql", { owner, name });

export const ordsRolesList = () =>
  call<{ roles: string[] }>("ords_roles_list", {});

export const ordsGenerateSql = (config: Record<string, unknown>) =>
  call<{ sql: string }>("ords_generate_sql", { config });

export type OrdsApplyResult = { ok: true; sql: string };

/**
 * Apply an ORDS endpoint by passing the same config that was sent to ordsGenerateSql.
 * The server regenerates SQL from the config and executes it — the previewSql shown
 * in the UI is informational only.
 */
export const ordsApply = (config: Record<string, unknown>) =>
  call<OrdsApplyResult>("ords_apply", { config });

export type OrdsTestResult = {
  status: number;
  headers: [string, string][];
  body: string;
  elapsedMs: number;
};

export const ordsTestHttp = (
  method: string,
  url: string,
  headers: [string, string][],
  body: string | null,
  fallbackBaseUrl?: string,
) => call<OrdsTestResult>("ords_test_http", { method, url, headers, body, fallbackBaseUrl });

export type RestClient = {
  name: string;
  description: string | null;
  createdOn: string | null;
};

export const ordsClientsList = () =>
  call<{ clients: RestClient[] }>("ords_clients_list", {});

export const ordsClientsCreate = (name: string, description: string, roles: string[]) =>
  call<{ clientId: string; clientSecret: string }>("ords_clients_create", { name, description, roles });

export const ordsClientsRevoke = (name: string) =>
  call<void>("ords_clients_revoke", { name });

export type AiEndpointSuggestion = {
  type?: "auto-crud" | "custom-sql" | "procedure";
  reasoning?: string;
  sourceObjectName?: string;
  sourceObjectKind?: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION";
  sourceSql?: string;
  routePattern?: string;
  method?: string;
  moduleName?: string;
  basePath?: string;
  authMode?: "none" | "role" | "oauth";
};

export const aiSuggestEndpoint = (params: {
  apiKey: string | null;
  description: string;
  schemaName: string;
  availableTables: string[];
  availableViews: string[];
  availableProcedures: string[];
  availableFunctions: string[];
}) => call<{ suggestion: AiEndpointSuggestion }>("ai_suggest_endpoint", { params });

export const objectsListPlsql = (owner: string, kind: string) =>
  call<ObjectRefWithStatus[]>("objects_list_plsql", { owner, kind });

export type ObjectDdlResult = { ddl: string; spec?: string; body?: string };
export const objectDdlGet = (owner: string, objectType: string, objectName: string) =>
  call<ObjectDdlResult>("object_ddl_get", { owner, objectType, objectName });

export type DataFlowNode = { owner: string; name: string; objectType: string };
export type DataFlowTriggerInfo = { name: string; triggerType: string; event: string; status: string };
export type DataFlowResult = {
  upstream: DataFlowNode[];
  downstream: DataFlowNode[];
  fkParents: DataFlowNode[];
  fkChildren: DataFlowNode[];
  triggers: DataFlowTriggerInfo[];
};

export async function objectDataflowGet(
  owner: string,
  objectType: string,
  objectName: string,
): Promise<Result<DataFlowResult>> {
  try {
    const data = await invoke<DataFlowResult>("object_dataflow_get", { owner, objectType, objectName });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function connectionCommit(): Promise<Result<void>> {
  try {
    await invoke("connection_commit");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function connectionRollback(): Promise<Result<void>> {
  try {
    await invoke("connection_rollback");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export type TxModifyingType = "dml" | "ddl" | "plsql";

export type TxStateView = {
  hasOpenTx: boolean;
  pendingStatements: number;
  lastTxId: string | null;
  lastModifyingAt: number | null;
  lastModifyingType: TxModifyingType | null;
};

// Authoritative TX state — sourced from DBMS_TRANSACTION.LOCAL_TRANSACTION_ID
// in the sidecar. Replaces the broken frontend heuristic that mis-classified
// UPDATE...RETURNING / MERGE OUTPUT / PL/SQL with internal DML / DDL implicit-commit.
export async function connectionTxState(): Promise<Result<TxStateView>> {
  try {
    const data = await invoke<TxStateView>("connection_tx_state");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

// Item #4 Phase C — TX modal contract
//
// The audit `origin` records the user's *decision*; `triggered_by` records
// what *interrupted* (window close, route navigate, etc.). This split lets
// future analytics ask "how often does the user rollback in PROD when
// closing the window?" vs "...when navigating tabs?".
export type TxModalDecision =
  | "tx_modal_commit"
  | "tx_modal_rollback"
  | "tx_modal_keep_open"
  | "tx_modal_close_cancelled"
  | "tx_modal_session_lost";

export type TxModalTriggeredBy =
  | "window_close"
  | "tab_close"
  | "route_navigate"
  | "tray_quit"
  | "session_lost"
  | "manual_check";

export type KeepOpenRecord = {
  connectionId: string;
  openedAt: number;
  expiresAt: number;
  lastTxId: string | null;
  env: string;
};

export async function txKeepOpenRecord(input: {
  connectionId: string;
  env: string;
  lastTxId: string | null;
  openedAt: number;
  expiresAt: number;
}): Promise<Result<KeepOpenRecord>> {
  try {
    const data = await invoke<KeepOpenRecord>("tx_keep_open_record", {
      connectionId: input.connectionId,
      env: input.env,
      lastTxId: input.lastTxId,
      openedAt: input.openedAt,
      expiresAt: input.expiresAt,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function txKeepOpenClear(connectionId: string): Promise<Result<void>> {
  try {
    await invoke("tx_keep_open_clear", { connectionId });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export type TxModalAuditInput = {
  decision: TxModalDecision;
  triggeredBy: TxModalTriggeredBy;
  connectionId: string;
  env: string | null;
  pendingStatements: number;
  lastTxId: string | null;
};

export async function txModalAudit(input: TxModalAuditInput): Promise<Result<void>> {
  try {
    await invoke("tx_modal_audit", { input });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const driverMode = () =>
  call<{ mode: "thin" | "thick" }>("driver_mode");

// ── Vector Search ─────────────────────────────────────────────────────────────

export type EmbedProvider = "ollama" | "openai" | "voyage" | "custom";
export type EmbedConfig = {
  provider: EmbedProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
};

export type VectorColumnRef = { tableName: string; columnName: string };

export const vectorTablesInSchema = (owner: string) =>
  call<{ columns: VectorColumnRef[] }>("vector_tables_in_schema", { owner });

export type VectorIndex = {
  indexName: string;
  targetColumn: string;
  indexType: string;
  distanceMetric: string;
  accuracy: number | null;
  parameters: string | null;
};

export const vectorIndexList = (owner: string, tableName: string) =>
  call<{ indexes: VectorIndex[] }>("vector_index_list", { owner, tableName });

export type VectorSearchResult = {
  columns: Array<{ name: string }>;
  rows: unknown[][];
  scores: number[];
  vectors?: number[][];
  queryVector?: number[];
};

export async function vectorSearch(
  embed: EmbedConfig,
  text: string,
  owner: string,
  tableName: string,
  columnName: string,
  distanceMetric: "COSINE" | "EUCLIDEAN" | "DOT",
  limit: number,
  withVectors = false,
): Promise<Result<VectorSearchResult>> {
  try {
    const data = await invoke<VectorSearchResult>("vector_search", {
      payload: { embed: { ...embed, text }, owner, tableName, columnName, distanceMetric, limit, withVectors },
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const vectorIndexCreate = (payload: {
  owner: string; tableName: string; columnName: string;
  indexName: string; metric: string; accuracy: number; indexType: string;
}) => call<{ created: true }>("vector_index_create", { payload });

export const vectorIndexDrop = (owner: string, indexName: string) =>
  call<{ dropped: true }>("vector_index_drop", { payload: { owner, indexName } });

// ── AI Chat ───────────────────────────────────────────────────────────────────

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiContext = {
  currentSchema?: string;
  selectedOwner?: string;
  selectedName?: string;
  selectedKind?: string;
  activeSql?: string;
  schemaObjects?: string;
};
export type AiChatResult = { content: string; toolsUsed: string[] };

export async function aiChat(
  apiKey: string,
  messages: AiMessage[],
  context: AiContext,
  // PROD-001 (audit 2026-04-30): when the active connection is tagged env='prod',
  // the sidecar refuses unless this flag is true. The UI gates earlier with a
  // per-session unlock modal; the flag is derived from that unlock state.
  acknowledgeProdAi: boolean = false,
): Promise<Result<AiChatResult>> {
  try {
    const res = await invoke<AiChatResult>("ai_chat", {
      payload: { apiKey, messages, context, acknowledgeProdAi },
    });
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const aiApprovalResolve = (
  requestId: string,
  approved: boolean,
  applyToTurn: boolean,
) =>
  call<unknown>("ai_approval_resolve", {
    requestId,
    approved,
    applyToTurn,
  });

export async function aiKeySave(service: string, key: string): Promise<void> {
  await invoke("ai_key_save", { service, key });
}

export async function aiKeyGet(service: string): Promise<string | null> {
  return invoke<string | null>("ai_key_get", { service });
}

export const embedCountPending = (owner: string, tableName: string, vectorColumn: string) =>
  call<{ total: number; pending: number }>("embed_count_pending", {
    payload: { owner, tableName, vectorColumn },
  });

export const embedBatch = (
  owner: string,
  tableName: string,
  textColumn: string,
  vectorColumn: string,
  batchSize: number,
  embed: EmbedConfig,
) =>
  call<{ embedded: number; errors: number }>("embed_batch", {
    payload: { owner, tableName, textColumn, vectorColumn, batchSize, embed },
  });

export type ExplainNode = {
  id: number;
  parentId: number | null;
  operation: string;
  options: string | null;
  objectName: string | null;
  objectOwner: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
};

export const explainPlanGet = (sql: string) =>
  call<{ nodes: ExplainNode[] }>("explain_plan_get", { sql });

// Re-export under the `Perf*` names so existing imports of `PerfTableStats`
// from `$lib/workspace` keep working — they resolve to the same shape.
export type PerfTableIndex = TableIndex;
export type PerfTableStats = TableStats;

export type PerfStatsResult = {
  tables: PerfTableStats[];
};

export const perfStats = (sql: string) =>
  call<PerfStatsResult>("perf_stats", { sql });

export type ProcParam = {
  name: string;
  position: number;
  direction: "IN" | "OUT" | "IN/OUT";
  dataType: string;
};

export type ProcExecuteResult = {
  outParams: { name: string; value: string }[];
  refCursors: { name: string; columns: Array<{ name: string; dataType: string }>; rows: unknown[][] }[];
  dbmsOutput: string[];
};

export const procDescribeGet = (owner: string, name: string) =>
  call<{ params: ProcParam[] }>("proc_describe", { owner, name });

export const procExecuteRun = (payload: {
  owner: string;
  name: string;
  params: { name: string; value: string }[];
}) => call<ProcExecuteResult>("proc_execute", { payload });

// ── Chart Reports ────────────────────────────────────────────────────────────

export type ChartType = "bar" | "bar-h" | "line" | "pie" | "kpi" | "table";
export type ChartAggregation = "none" | "sum" | "avg" | "count" | "max" | "min";

export type ChartConfig = {
  type: ChartType | null;
  xColumn: string | null;
  yColumns: string[];
  aggregation: ChartAggregation;
  title: string | null;
};

export type PreviewData = {
  labels: string[];
  datasets: { label: string; data: number[] }[];
};

export type ChartConfigureResult = {
  config: ChartConfig;
  previewData: PreviewData | null;
  ready: boolean;
};

export const chartConfigureRpc = (payload: {
  sessionId: string;
  patch: Partial<ChartConfig>;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
}) => call<ChartConfigureResult>("chart_configure", { payload });

export const chartResetRpc = (sessionId: string) =>
  call<{ ok: boolean }>("chart_reset", { sessionId });

// ── PL/SQL Debugger ────────────────────────────────────────────────────────

export type ParamDef = {
  name: string;
  dataType: string;
  inOut: "IN" | "OUT" | "IN/OUT";
  position: number;
};

export type DebugBreakpointRef = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type StackFrame = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type VarValue = {
  name: string;
  value: string | null;
};

export type PauseInfo = {
  status: "paused" | "completed" | "error";
  frame: StackFrame | null;
  reason: number;
  errorMessage?: string;
  refCursors?: DebugRunCursor[];
  outBinds?: Record<string, string | null>;
};

export type MemberRef = { name: string; type: "PROCEDURE" | "FUNCTION" };

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: MemberRef[];
  refCursorOutBinds: string[];
};

export type DebugRunCursor = {
  name: string;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
};

export const debugOpenRpc = (
  owner: string,
  objectName: string,
  objectType: string,
  packageName?: string,
) =>
  call<DebugOpenResult>("debug_open", {
    payload: {
      owner,
      objectName,
      objectType,
      packageName: packageName ?? null,
    },
  });

export const debugGetSourceRpc = (
  owner: string,
  objectName: string,
  objectType: string,
) =>
  call<{ lines: string[] }>("debug_get_source", {
    payload: { owner, objectName, objectType },
  });

export const debugStartRpc = (payload: {
  script: string;
  binds: Record<string, unknown>;
  cursorBinds?: string[];
  breakpoints: DebugBreakpointRef[];
  owner: string;
  objectName: string;
  objectType: string;
  packageName?: string | null;
}) => call<PauseInfo>("debug_start", { payload });

export const debugStopRpc = () => call<{ ok: boolean }>("debug_stop");
export const debugStepIntoRpc = () => call<PauseInfo>("debug_step_into");
export const debugStepOverRpc = () => call<PauseInfo>("debug_step_over");
export const debugStepOutRpc = () => call<PauseInfo>("debug_step_out");
export const debugContinueRpc = () => call<PauseInfo>("debug_continue");

export const debugSetBreakpointRpc = (bp: DebugBreakpointRef) =>
  call<{ breakpointId: number }>("debug_set_breakpoint", { payload: bp });

export const debugRemoveBreakpointRpc = (breakpointId: number) =>
  call<{ ok: boolean }>("debug_remove_breakpoint", {
    payload: { breakpointId },
  });

export const debugGetValuesRpc = (varNames: string[]) =>
  call<{ variables: VarValue[] }>("debug_get_values", {
    payload: { varNames },
  });

export const debugGetCallStackRpc = () =>
  call<{ frames: StackFrame[] }>("debug_get_call_stack");

export const debugRunRpc = (payload: {
  script: string;
  binds: Record<string, unknown>;
  cursorBinds?: string[];
}) => call<{
  output: string[];
  elapsedMs: number;
  outBinds: Record<string, string | null>;
  refCursors: DebugRunCursor[];
}>("debug_run", { payload });

// ── Visual Execution Flow ─────────────────────────────────────────────────────

export type StackEntry = { name: string; line: number };

export type FlowVariable = { name: string; type: string; value: string };

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
  variables: FlowVariable[];
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

export type FlowTraceEvent = PlsqlFrameEvent | ExplainNodeEvent;

export type FlowTraceResult = {
  kind: "plsql" | "sql";
  startedAt: string;
  totalElapsedMs: number;
  events: FlowTraceEvent[];
  finalResult?: { rowCount?: number; outBinds?: Record<string, unknown> };
  truncated?: boolean;
  error?: { code: number; message: string; atStep?: number };
};

export const flowTraceProc = (payload: {
  owner: string;
  name: string;
  params: { name: string; value: string }[];
  maxSteps?: number;
  timeoutMs?: number;
}) => call<FlowTraceResult>("flow_trace_proc", { payload });

export const flowTraceSql = (payload: {
  sql: string;
  withRuntimeStats?: boolean;
}) => call<FlowTraceResult>("flow_trace_sql", { payload });

// ── Vision (object dependency graph) ──────────────────────────────────────────

export type VisionNode = {
  id: string;
  name: string;
  owner: string;
  type: string;
  status: string;
  degree: number;
  isOrigin: boolean;
};

export type VisionEdge = {
  source: string;
  target: string;
  kind: "fk" | "dep";
};

export type VisionGraphResult = {
  nodes: VisionNode[];
  edges: VisionEdge[];
  truncated: boolean;
  truncatedAt: number | null;
};

// ── DML dry-run preview ───────────────────────────────────────────────────────

export type DmlPreviewResult = {
  estimatedRows: number | null;
  timedOut: boolean;
  warning?: string;
  tableName?: string;
};

export const dmlPreviewRpc = (sql: string) =>
  call<DmlPreviewResult>("dml_preview", { sql });

// ── Item #1A — MViews, Synonyms, DB Links ─────────────────────────────────────

export type MViewDetails = {
  name: string;
  owner: string;
  refreshMethod: string;
  refreshMode: string;
  lastRefreshDate: string | null;
  staleness: string;
  query: string | null;
};

export const mviewDetailsGet = (owner: string, name: string) =>
  call<{ detail: MViewDetails | null }>("mview_details", { owner, name });

export const mviewRefreshRpc = (
  owner: string,
  name: string,
  method: "FAST" | "COMPLETE" | "FORCE",
  confirmedProdRefresh?: boolean,
) => call<{ ok: true; durationMs: number; envReal: string }>("mview_refresh", { owner, name, method, confirmedProdRefresh });

export type SynonymDetails = {
  name: string;
  owner: string;
  targetSchema: string;
  targetObject: string;
  targetDbLink: string | null;
  ddl: string;
};

export const synonymDetailsGet = (owner: string, name: string) =>
  call<{ detail: SynonymDetails | null }>("synonym_details", { owner, name });

export type DbLinkRow = {
  name: string;
  owner: string;
  username: string | null;
  host: string | null;
  created: string | null;
};

export const dbLinksListGet = (owner: string) =>
  call<{ objects: DbLinkRow[] }>("objects_list_dblinks", { owner });

export const dbLinkDdlGet = (name: string) =>
  call<{ ddl: string }>("object_ddl_dblink", { name });

// schemaKindCounts returns 'MATERIALIZED VIEW' (with space) for the key —
// map it to the ObjectKind 'MATERIALIZED_VIEW' on the frontend side.
// DB_LINK counts are not in ALL_OBJECTS; the count badge is omitted for now
// and will appear only after the section is expanded.

// ── Item #1B — Directories ────────────────────────────────────────────────────

export type DirectoryRow = {
  name: string;
  owner: string;
  path: string;
};

export type DirectoryGrant = {
  grantee: string;
  privilege: string;
};

export type DirectoryDetail = {
  name: string;
  owner: string;
  path: string;
  grants: DirectoryGrant[];
};

export const directoriesListGet = () =>
  call<{ directories: DirectoryRow[] }>("objects_list_directories", {});

export const directoryDetailsGet = (name: string) =>
  call<{ detail: DirectoryDetail | null }>("directory_details", { name });

// ── Item #1B — Queues (AQ) ────────────────────────────────────────────────────

export type QueueRow = {
  name: string;
  owner: string;
  queueTable: string;
  queueType: string;
  maxRetries: number | null;
  retryDelay: number | null;
  retention: number | null;
  userComment: string | null;
  payloadType: string | null;
};

export const queuesListGet = (owner: string) =>
  call<{ queues: QueueRow[] }>("objects_list_queues", { owner });

export const queueDetailsGet = (owner: string, name: string) =>
  call<{ queue: QueueRow | null }>("queue_details", { owner, name });

export const queueDdlGet = (owner: string, name: string) =>
  call<{ ddl: string }>("queue_ddl", { owner, name });

// ── Item #1B T1B.1 — Scheduler Jobs ──────────────────────────────────────────

export type SchedulerJobRow = {
  owner: string;
  name: string;
  jobType: string | null;
  state: string;
  enabled: boolean;
  runCount: number;
  failureCount: number;
  nextRunDate: string | null;
  scheduleName: string | null;
  programName: string | null;
  comments: string | null;
};

export type LegacyJobRow = {
  jobId: number;
  owner: string;
  jobAction: string | null;
  nextDate: string | null;
  broken: boolean;
  failures: number;
  interval: string | null;
};

export type SchedulerJobDetails = {
  owner: string;
  name: string;
  jobType: string | null;
  jobAction: string | null;
  state: string;
  enabled: boolean;
  runCount: number;
  failureCount: number;
  maxFailures: number | null;
  retryCount: number | null;
  maxRuns: number | null;
  lastRunDuration: string | null;
  nextRunDate: string | null;
  startDate: string | null;
  endDate: string | null;
  scheduleName: string | null;
  scheduleType: string | null;
  repeatInterval: string | null;
  programName: string | null;
  programType: string | null;
  jobClass: string | null;
  restartable: boolean;
  loggingLevel: string | null;
  comments: string | null;
};

export type LegacyJobDetails = {
  jobId: number;
  owner: string;
  jobAction: string | null;
  nextDate: string | null;
  nextSec: string | null;
  broken: boolean;
  failures: number;
  interval: string | null;
  lastDate: string | null;
  lastSec: string | null;
};

export type SchedulerProgramDetails = {
  owner: string;
  programName: string;
  programType: string;
  programAction: string;
  numberOfArguments: number;
  enabled: boolean;
  comments: string | null;
};

export type SchedulerScheduleDetails = {
  owner: string;
  scheduleName: string;
  scheduleType: string;
  startDate: string | null;
  repeatInterval: string | null;
  endDate: string | null;
  comments: string | null;
};

export type SchedulerJobPrivs = {
  hasCreateAnyJob: boolean;
  hasManageScheduler: boolean;
};

export const schedulerJobsListGet = (owner: string) =>
  call<{ jobs: SchedulerJobRow[]; legacyJobs: LegacyJobRow[] }>("objects_list_scheduler_jobs", { owner });

export const schedulerJobDetailsGet = (owner: string, name: string) =>
  call<{ job: SchedulerJobDetails | null }>("scheduler_job_details", { owner, name });

export const legacyJobDetailsGet = (jobId: number, owner: string) =>
  call<{ job: LegacyJobDetails | null }>("legacy_job_details", { jobId, owner });

export const schedulerJobDdlGet = (owner: string, name: string, legacy?: boolean) =>
  call<{ ddl: string }>("scheduler_job_ddl", { owner, name, legacy });

export const schedulerProgramDetailsGet = (owner: string, programName: string) =>
  call<{ program: SchedulerProgramDetails | null }>("scheduler_program_details", { owner, programName });

export const schedulerScheduleDetailsGet = (owner: string, scheduleName: string) =>
  call<{ schedule: SchedulerScheduleDetails | null }>("scheduler_schedule_details", { owner, scheduleName });

export const schedulerJobPrivCheckGet = () =>
  call<SchedulerJobPrivs>("scheduler_job_priv_check", {});

export const schedulerJobRunRpc = (owner: string, name: string, confirmedProdRun?: boolean) =>
  call<{ ok: true; durationMs: number }>("scheduler_job_run", { owner, name, confirmedProdRun });

export const schedulerJobEnableRpc = (owner: string, name: string) =>
  call<{ ok: true }>("scheduler_job_enable", { owner, name });

export const schedulerJobDisableRpc = (owner: string, name: string, confirmedProdDisable?: boolean) =>
  call<{ ok: true }>("scheduler_job_disable", { owner, name, confirmedProdDisable });

export const dbmsJobRunRpc = (jobId: number) =>
  call<{ ok: true }>("dbms_job_run", { jobId });

export const dbmsJobBrokenRpc = (jobId: number) =>
  call<{ ok: true }>("dbms_job_broken", { jobId });

export const dbmsJobUnbrokenRpc = (jobId: number) =>
  call<{ ok: true }>("dbms_job_unbroken", { jobId });

// ── Item #1C T1C.1+T1C.2: Users + Sessions ───────────────────────────────────

export type UserDetails = {
  username: string;
  accountStatus: string;
  lockDate: string | null;
  expiryDate: string | null;
  created: string;
  profile: string | null;
  authenticationType: string | null;
  defaultTablespace: string | null;
  temporaryTablespace: string | null;
  fallbackMode: boolean;
};

export type ProfileRow = {
  resourceName: string;
  resourceType: string;
  limit: string;
};

export type QuotaRow = {
  tablespaceName: string;
  bytes: number | null;
  maxBytes: number | null;
  blocks: number | null;
  maxBlocks: number | null;
};

export type SessionRow = {
  sid: number;
  serial: number;
  status: string;
  username: string | null;
  osuser: string | null;
  machine: string | null;
  program: string | null;
  module: string | null;
  logonTime: string | null;
  lastCallEt: number | null;
  blockingSession: number | null;
  blockingSessionStatus: string | null;
  waitClass: string | null;
  event: string | null;
  secondsInWait: number | null;
  sqlId: string | null;
};

export const userDetailsGet = (username: string) =>
  call<UserDetails | null>("user_details", { username });

export const userProfileDetailsGet = (profile: string) =>
  call<{ rows: ProfileRow[]; accessDenied: boolean }>("user_profile_details", { profile });

export const userQuotasGet = (username: string) =>
  call<{ quotas: QuotaRow[]; accessDenied: boolean }>("user_quotas", { username });

export const sessionsListAllGet = () =>
  call<{ sessions: SessionRow[]; accessDenied: boolean }>("sessions_list_all", {});

export const sessionSqlPreviewGet = (sqlId: string) =>
  call<{ sql: string | null }>("session_sql_preview", { sqlId });

export const sessionPrivCheckGet = () =>
  call<{ hasAlterSystem: boolean }>("session_priv_check", {});

export const sessionKillRpc = (sid: number, serial: number, confirmedProdKill?: boolean) =>
  call<{ ok: true }>("session_kill", { sid, serial, confirmedProdKill });

// ── Item #1C T1C.4: Privileges & Grants ───────────────────────────────────────

export type RolePrivRow = { grantedRole: string; adminOption: string; defaultRole: string };
export type SysPrivRow  = { privilege: string; adminOption: string };
export type TabPrivRow  = { owner: string; tableName: string; grantor: string | null; privilege: string; grantable: string; hierarchy: string | null };
export type GrantedToRow= { grantee: string; tableName: string; privilege: string; grantable: string };

export type PrivilegesList = {
  rolePrivs: RolePrivRow[];
  sysPrivs: SysPrivRow[];
  tabPrivs: TabPrivRow[];
  grantedTo: GrantedToRow[];
  tabPrivsAccessDenied: boolean;
  grantedToAccessDenied: boolean;
  fallbackMode: boolean;
};

export const privilegesListGet = (schema: string) =>
  call<PrivilegesList>("privileges_list", { schema });

// ── Item #1C T1C.5: Blocking chain ───────────────────────────────────────────

export type BlockingPair = {
  blockedSid: number;
  blockedSerial: number;
  blockedUser: string | null;
  waitClass: string | null;
  event: string | null;
  secondsInWait: number | null;
  blockerSid: number;
  blockerSerial: number;
  blockerUser: string | null;
  blockerStatus: string | null;
};

export const blockingChainGet = () =>
  call<{ pairs: BlockingPair[]; accessDenied: boolean }>("sessions_blocking_chain", {});

// Item #1E — DDL confirmation gate
export const ddlConfirm = (kind: "ddl" | "destructive_ddl") =>
  call<{ ok: true; expiresAt: number; openedAt: number }>("ddl_confirm", { kind });

export const ddlUnlock = () =>
  call<{ ok: true }>("ddl_unlock", {});

export const auditDdlEvent = (p: {
  riskLevel: string;
  statement: string;
  env: string;
  windowAgeMs: number;
}) => call<void>("audit_ddl_event", {
  riskLevel: p.riskLevel,
  statement: p.statement,
  env: p.env,
  windowAgeMs: p.windowAgeMs,
});

// Item #1D — HMAC chain integrity verification
export type ChainVerifyResult = {
  ok: boolean;
  checked: number;
  skippedLegacy: number;
  subChains: number;
  brokenAt: { index: number; ts: string; reason: string } | null;
};

export const auditVerifyChain = () => call<ChainVerifyResult>("audit_verify_chain", {});
