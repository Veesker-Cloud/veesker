import { parseRequest, makeError } from "./rpc";
import { dispatch, type HandlerMap } from "./handlers";
import { embedText, type EmbedParams } from "./embedding";
import {
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
} from "./oracle";
import { aiChat } from "./ai";

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
    const { embed, owner, tableName, columnName, distanceMetric, limit } = params;
    const vector = await embedText(embed as EmbedParams);
    return vectorSimilaritySearch({ owner, tableName, columnName, vector, distanceMetric: distanceMetric ?? "COSINE", limit: limit ?? 10 });
  },
  "ai.chat": (params) => aiChat(params as any),
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
