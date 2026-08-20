// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseRequest, makeError, makeNotification } from "./rpc";
import { dispatch, type HandlerMap } from "./handlers";
import { log } from "./logger";
import { resolveSandboxTmpDir, defaultAppDataDir } from "./sandbox-cloud/cache";
import { clearAllSessions } from "./sandbox-cloud/session";
import { createLastSeenStore } from "./sandbox-cloud/last-seen";
import { embedText, type EmbedParams } from "./embedding";
import {
  tryEnableThickMode,
  getDriverMode,
  connectionTest,
  openSession,
  closeSession,
  setSessionAction,
  schemaList,
  objectsList,
  tableDescribe,
  queryExecute,
  queryCancel,
  compileErrors,
  objectDdl,
  objectsListPlsql,
  objectDataflow,
  visionGraph,
  connectionCommit,
  connectionRollback,
  connectionTxState,
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
  dmlPreview,
  querySessionSelf,
  enableDbmsOutputForActiveSession,
  unlockUnsafeDml,
} from "./oracle";
import { aiChat, aiSuggestEndpoint } from "./ai";
import { resolveApproval } from "./ai-approval-state";
// L2.1: read session safety (PSDPM flag) and reject embed.batch when active.
import { getSessionSafety } from "./state";
import { RpcCodedError, PSDPM_BLOCKED, APPROVAL_UNKNOWN_REQUEST_ID, ENV_REQUIRED } from "./errors";
import { chartConfigure, chartReset } from "./chart";
import { ordsDetect, ordsModulesList, ordsModuleGet, ordsEnableSchema, ordsModuleExportSql, ordsRolesList, ordsGenerateSql, ordsApply, ordsClientsList, ordsClientsCreate, ordsClientsRevoke } from "./ords";
import { apexApplicationsList, apexDetect, apexPagesList, apexWorkspacesList } from "./apex";
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
import { traceProc, explainPlanFlow } from "./flow";
import { tablesStats } from "./perf-stats";
import {
  handleSandboxBuild,
  handleSandboxComputeFkClosure,
  handleSandboxListSchemaTables,
  handleSandboxDiscoverPlsql,
} from "./sandbox.handler";
import {
  handleSandboxPublish,
  handleSandboxRepublishProduction,
  handleSandboxPull,
  handleSandboxGrant,
  handleSandboxRevoke,
  handleSandboxList,
  handleSandboxOpen,
  handleSandboxQuery,
  handleSandboxClose,
  handleSandboxListCached,
  handleSandboxEnsureKeypair,
  handleSandboxSweepBuilds,
  handleSandboxDelete,
  handleSandboxLeave,
} from "./sandbox-cloud/handlers";

const SANDBOXES_LAST_SEEN_PATH = join(
  defaultAppDataDir(),
  "sandboxes-last-seen.json",
);
const lastSeenStore = createLastSeenStore(SANDBOXES_LAST_SEEN_PATH);

const handlers: HandlerMap = {
  "connection.test": (params) => connectionTest(params as any),
  "workspace.open": async (params) => {
    // Security item #1: every connection must declare an env before connecting.
    // The sidecar is the last line of defence — the UI should never call this
    // without an env, but we enforce it here so no UI bypass is possible.
    const envValue = (params as any)?.env;
    const validEnvs = ["dev", "staging", "prod", "local"];
    if (!envValue || !validEnvs.includes(envValue)) {
      throw new RpcCodedError(
        ENV_REQUIRED,
        "Connection has no environment tag. Set env to dev / staging / prod / local before connecting."
      );
    }
    const result = await openSession(params as any);
    // L3.3 — wire DBMS_OUTPUT on every fresh session so PUT_LINE works without
    // a separate user gesture. Best-effort: failures here never break the open.
    await enableDbmsOutputForActiveSession();
    return result;
  },
  "workspace.close": () => closeSession(),
  "workspace.unlockUnsafeDml": (params) => unlockUnsafeDml(params as any),
  "oracle.session_dbms_output_enable": async () => {
    await enableDbmsOutputForActiveSession();
    return { ok: true };
  },
  "session.setAction": async (params: any) => {
    const action = String(params?.action ?? "SQL Editor");
    await setSessionAction(action);
    return { ok: true };
  },
  "schema.list": () => schemaList(),
  "objects.list": (params) => objectsList(params as any),
  "table.describe": (params) => tableDescribe(params as any),
  "query.execute": (params) => queryExecute(params as any),
  "query.cancel": (params) => queryCancel(params as any),
  "compile.errors": (params) => compileErrors(params as any),
  "object.ddl": (params) => objectDdl(params as any),
  "objects.list.plsql": (params) => objectsListPlsql(params as any),
  "object.dataflow": (params) => objectDataflow(params as any),
  "vision.graph": (params) => visionGraph(params as any),
  "table.related": (params) => tableRelated(params as any),
  "table.count_rows": (params) => tableCountRows(params as any),
  "connection.commit": () => connectionCommit(),
  "connection.rollback": () => connectionRollback(),
  "connection.txState": () => connectionTxState(),
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
  // L2.1 PSDPM: embed batches issue UPDATE statements per row; refuse them
  // when the active connection is in PL/SQL Developer Parity Mode. The user
  // must disable PSDPM (or run the embed UI manually, statement by statement)
  // to vectorise rows on a locked connection.
  "embed.batch": (params) => {
    if (getSessionSafety()?.psdpm === true) {
      return Promise.reject(
        new RpcCodedError(
          PSDPM_BLOCKED,
          "PSDPM mode active — embed.batch issues background UPDATEs and is blocked. Disable PSDPM to run vector embedding."
        )
      );
    }
    return embedBatch(params as any);
  },
  "ai.chat": (params) => aiChat(params as any, false),
  "ai.suggest_endpoint": (params) => aiSuggestEndpoint(params as any),
  // L3.6 (Sprint C Onda 3): host UI calls this once the user has clicked
  // Approve / Approve-for-turn / Deny on a pending tool-call. The matching
  // requestApproval Promise inside the AI tool-use loop unblocks. Unknown
  // requestIds (already resolved or timed out) raise -32036 so the renderer
  // can surface a clean error rather than a silent no-op.
  "ai.approval.resolve": async (params: any) => {
    const requestId = String(params?.requestId ?? "");
    const approved = !!params?.approved;
    const applyToTurn = !!params?.applyToTurn;
    if (!requestId) {
      throw new RpcCodedError(
        APPROVAL_UNKNOWN_REQUEST_ID,
        "approval_unknown_request_id"
      );
    }
    const found = resolveApproval(requestId, { approved, applyToTurn });
    if (!found) {
      throw new RpcCodedError(
        APPROVAL_UNKNOWN_REQUEST_ID,
        "approval_unknown_request_id"
      );
    }
    return { ok: true };
  },
  "explain.plan": (params) => explainPlan(params as any),
  "oracle.session_self": () => querySessionSelf(),
  "proc.describe": (params) => procDescribe(params as any),
  "proc.execute": (params) => procExecute(params as any),
  "chart.configure": (params) => chartConfigure(params as any),
  "chart.reset":     (params) => Promise.resolve(chartReset(params as any)),
  "ords.detect":        (params) => ordsDetect(params as any),
  "ords.modules.list":  (params) => ordsModulesList(params as any),
  "ords.module.get":    (params) => ordsModuleGet(params as any),
  "ords.enable_schema": (params) => ordsEnableSchema(params as any),
  "ords.module.export_sql": (params) => ordsModuleExportSql(params as any),
  "ords.roles.list":     (params) => ordsRolesList(params as any),
  "ords.generate_sql":   (params) => ordsGenerateSql(params as any),
  "ords.apply":          (params) => ordsApply(params as any),
  "ords.clients.list":   (params) => ordsClientsList(params as any),
  "ords.clients.create": (params) => ordsClientsCreate(params as any),
  "ords.clients.revoke": (params) => ordsClientsRevoke(params as any),
  "apex.detect":         () => apexDetect(),
  "apex.workspaces.list":    () => apexWorkspacesList(),
  "apex.applications.list":  (params) => apexApplicationsList(params as any),
  "apex.pages.list":         (params) => apexPagesList(params as any),
  "debug.open":              (params) => debugOpen(params as any),
  "debug.get_source":        (params) => debugGetSource(params as any),
  "debug.start":             (params) => debugStart(params as any),
  "debug.stop":              () => Promise.resolve(debugStop()),
  "debug.step_into":         () => debugStepInto(),
  "debug.step_over":         () => debugStepOver(),
  "debug.step_out":          () => debugStepOut(),
  "debug.continue":          () => debugContinue(),
  "debug.set_breakpoint":    (params) => debugSetBreakpoint(params as any),
  "debug.remove_breakpoint": (params) => debugRemoveBreakpoint(params as any),
  "debug.get_values":        (params) => debugGetValues(params as any),
  "debug.get_call_stack":    () => debugGetCallStack(),
  "debug.run":               (params) => debugRun(params as any),
  "flow.trace_proc": (params) => traceProc(params as any),
  "flow.trace_sql":  (params) => explainPlanFlow(params as any),
  "perf.stats": (params) => tablesStats(params as any),
  "dml.preview": async (p) => dmlPreview((p as any).sql ?? ""),
  "driver.mode": async () => ({ mode: getDriverMode() }),
  "sandbox.build": (params) => handleSandboxBuild(params as any),
  "sandbox.list-schema-tables": (params) => handleSandboxListSchemaTables(params as any),
  "sandbox.compute-fk-closure": (params) => handleSandboxComputeFkClosure(params as any),
  "sandbox.discover_plsql": (params) => handleSandboxDiscoverPlsql(params as any),
  "sandbox.publish": (params) =>
    handleSandboxPublish(params as any, { dispatchNotification }),
  "sandbox.republish": (params) =>
    handleSandboxRepublishProduction(params as Parameters<typeof handleSandboxRepublishProduction>[0]),
  "sandbox.pull":    (params) => handleSandboxPull(params as any),
  "sandbox.grant":   (params) => handleSandboxGrant(params as any),
  "sandbox.revoke":  (params) => handleSandboxRevoke(params as any),
  "sandbox.list":    (params) => handleSandboxList(params as any, { lastSeenStore }),
  "sandbox.delete":  (params) => handleSandboxDelete(params as any),
  "sandbox.leave":   (params) => handleSandboxLeave(params as any),
  "sandbox.open":         (params) => handleSandboxOpen(params as any, dispatchNotification),
  "sandbox.query":        (params) => handleSandboxQuery(params as any),
  "sandbox.close":        (params) => handleSandboxClose(params as any),
  "sandbox.list-cached":  (params) => handleSandboxListCached(params as any),
  "sandbox.ensureKeypair": (params) => handleSandboxEnsureKeypair(params as any),
  "sandbox.sweep-builds":  (params) => handleSandboxSweepBuilds(params as any),
  "sandbox.markSeen": async (params: any) => {
    if (!Array.isArray(params?.ids)) {
      throw new Error("sandbox.markSeen: 'ids' must be an array of strings");
    }
    await lastSeenStore.markSeen(params.ids);
    return { ok: true };
  },
  "sandbox.listLastSeen": async () => {
    const ids = await lastSeenStore.loadLastSeenIds();
    return { ids };
  },
  ping: async () => ({ pong: true }),
};

function writeMessage(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function dispatchNotification(n: { method: string; params: unknown }): void {
  writeMessage(makeNotification(n.method, n.params));
}

function cleanupOrphanTmpFiles(): void {
  const tmpDir = resolveSandboxTmpDir();
  if (!existsSync(tmpDir)) return;
  for (const f of readdirSync(tmpDir)) {
    const p = join(tmpDir, f);
    try {
      if (statSync(p).isFile()) unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}

// Enable Thick mode at startup if Oracle Instant Client is available; falls back
// to Thin mode silently if not. Thick mode supports legacy password verifiers
// (NJS-116 errors) that older databases (9i/10g/11g) may still expose.
tryEnableThickMode();

// Sweep stale sandbox tmp files left behind by a previous crashed/killed process.
cleanupOrphanTmpFiles();

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
        writeMessage(makeError(null, -32700, "Parse error"));
        continue;
      }
      // Fire-and-forget: allows debug.stop to interrupt a blocking debug.start
      dispatch(handlers, req)
        .then(writeMessage)
        .catch((err) => writeMessage(makeError(req.id, -32603, String(err))));
    }
  }
}

main()
  .then(() => gracefulExit(0))
  .catch((err) => {
    log.error(`sidecar fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    gracefulExit(1);
  });

let _exiting = false;
async function gracefulExit(code: number): Promise<never> {
  if (_exiting) process.exit(code);
  _exiting = true;
  // Best-effort: close the active Oracle session so it doesn't linger
  // server-side until the idle timeout. Bounded to 2s so a hung close
  // doesn't keep the sidecar alive.
  try {
    await Promise.race([
      closeSession(),
      new Promise((res) => setTimeout(res, 2000)),
    ]);
  } catch {
    // closeSession is already best-effort internally.
  }
  // Drop any open sandbox-cloud sessions and remove their decrypted tmp files.
  try {
    await clearAllSessions();
  } catch {
    /* best effort */
  }
  process.exit(code);
}

process.on("SIGTERM", () => { void gracefulExit(0); });
process.on("SIGINT",  () => { void gracefulExit(0); });
