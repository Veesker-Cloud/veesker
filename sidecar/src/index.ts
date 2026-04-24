import { parseRequest, makeError } from "./rpc";
import { dispatch, type HandlerMap } from "./handlers";
import { embedText, type EmbedParams } from "./embedding";
import {
  connectionTest,
  openSession,
  closeSession,
  schemaList,
  objectsList,
  tableDescribe,
  queryExecute,
  queryCancel,
  compileErrors,
  objectDdl,
  objectsListPlsql,
  objectDataflow,
  connectionCommit,
  connectionRollback,
  tableRelated,
  tableCountRows,
  objectsSearch,
  schemaKindCounts,
  vectorTablesInSchema,
  vectorIndexList,
  vectorSimilaritySearch,
  vectorCreateIndex,
  vectorDropIndex,
  embedCountPending,
  embedBatch,
  explainPlan,
  procDescribe,
  procExecute,
} from "./oracle";
import { aiChat } from "./ai";
import { chartConfigure, chartReset } from "./chart";
import {
  debugOpen,
  debugGetSource,
  debugStart,
  debugStop,
  debugStepInto,
  debugStepOver,
  debugStepOut,
  debugContinue,
  debugSetBreakpoint,
  debugRemoveBreakpoint,
  debugGetValues,
  debugGetCallStack,
  debugRun,
} from "./debug";

const handlers: HandlerMap = {
  "connection.test": (params) => connectionTest(params as any),
  "workspace.open": (params) => openSession(params as any),
  "workspace.close": () => closeSession(),
  "schema.list": () => schemaList(),
  "objects.list": (params) => objectsList(params as any),
  "table.describe": (params) => tableDescribe(params as any),
  "query.execute": (params) => queryExecute(params as any),
  "query.cancel": (params) => queryCancel(params as any),
  "compile.errors": (params) => compileErrors(params as any),
  "object.ddl": (params) => objectDdl(params as any),
  "objects.list.plsql": (params) => objectsListPlsql(params as any),
  "object.dataflow": (params) => objectDataflow(params as any),
  "table.related": (params) => tableRelated(params as any),
  "table.count_rows": (params) => tableCountRows(params as any),
  "connection.commit": () => connectionCommit(),
  "connection.rollback": () => connectionRollback(),
  "objects.search": (params) => objectsSearch(params as any),
  "schema.kind_counts": (params) => schemaKindCounts(params as any),
  "vector.tables_in_schema": (params) => vectorTablesInSchema(params as any),
  "vector.index_list": (params) => vectorIndexList(params as any),
  "vector.search": async (params: any) => {
    const { embed, owner, tableName, columnName, distanceMetric, limit, withVectors } = params;
    const vector = await embedText(embed as EmbedParams);
    return vectorSimilaritySearch({ owner, tableName, columnName, vector, distanceMetric: distanceMetric ?? "COSINE", limit: limit ?? 10, withVectors: !!withVectors });
  },
  "vector.create_index": (params) => vectorCreateIndex(params as any),
  "vector.drop_index": (params) => vectorDropIndex(params as any),
  "embed.count_pending": (params) => embedCountPending(params as any),
  "embed.batch": (params) => embedBatch(params as any),
  "ai.chat": (params) => aiChat(params as any),
  "explain.plan": (params) => explainPlan(params as any),
  "proc.describe": (params) => procDescribe(params as any),
  "proc.execute": (params) => procExecute(params as any),
  "chart.configure": (params) => chartConfigure(params as any),
  "chart.reset":     (params) => chartReset(params as any),
  "debug.open":              (params) => debugOpen(params as any),
  "debug.get_source":        (params) => debugGetSource(params as any),
  "debug.start":             (params) => debugStart(params as any),
  "debug.stop":              () => debugStop(),
  "debug.step_into":         () => debugStepInto(),
  "debug.step_over":         () => debugStepOver(),
  "debug.step_out":          () => debugStepOut(),
  "debug.continue":          () => debugContinue(),
  "debug.set_breakpoint":    (params) => debugSetBreakpoint(params as any),
  "debug.remove_breakpoint": (params) => debugRemoveBreakpoint(params as any),
  "debug.get_values":        (params) => debugGetValues(params as any),
  "debug.get_call_stack":    () => debugGetCallStack(),
  "debug.run":               (params) => debugRun(params as any),
  ping: async () => ({ pong: true }),
};

function writeLine(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of process.stdin as any) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const req = parseRequest(line);
      if (!req) {
        writeLine(makeError(null, -32700, "Parse error"));
        continue;
      }
      const res = await dispatch(handlers, req);
      writeLine(res);
    }
  }
}

main().catch((err) => {
  console.error("sidecar fatal:", err);
  process.exit(1);
});
