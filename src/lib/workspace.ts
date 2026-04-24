import { invoke } from "@tauri-apps/api/core";

export type WorkspaceInfo = { serverVersion: string; currentSchema: string };
export type Schema = { name: string; isCurrent: boolean };
export type ObjectKind =
  | "TABLE" | "VIEW" | "SEQUENCE"
  | "PROCEDURE" | "FUNCTION" | "PACKAGE" | "TRIGGER" | "TYPE";
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
export const workspaceClose = () =>
  call<void>("workspace_close");
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

export const objectsListPlsql = (owner: string, kind: string) =>
  call<ObjectRefWithStatus[]>("objects_list_plsql", { owner, kind });

export const objectDdlGet = (owner: string, objectType: string, objectName: string) =>
  call<string>("object_ddl_get", { owner, objectType, objectName });

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
};
export type AiChatResult = { content: string; toolsUsed: string[] };

export async function aiChat(
  apiKey: string,
  messages: AiMessage[],
  context: AiContext,
): Promise<Result<AiChatResult>> {
  try {
    const res = await invoke<AiChatResult>("ai_chat", {
      payload: { apiKey, messages, context },
    });
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

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
};

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: string[];
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
  breakpoints: DebugBreakpointRef[];
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
}) => call<{ output: string[]; elapsedMs: number }>("debug_run", { payload });
