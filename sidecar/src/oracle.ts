// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import oracledb from "oracledb";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { embedText, type EmbedParams } from "./embedding";
import { log } from "./logger";

/** Validate and quote an Oracle identifier for use in double-quoted SQL interpolation. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z0-9_$#]{1,128}$/.test(name)) {
    throw new Error(`Invalid Oracle identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

let _driverMode: "thin" | "thick" = "thin";

function dirHasOracleClientLib(dir: string): boolean {
  try {
    const files = readdirSync(dir);
    if (process.platform === "win32") return files.includes("oci.dll");
    if (process.platform === "darwin")
      return files.some((f) => f === "libclntsh.dylib" || f.startsWith("libclntsh.dylib."));
    return files.some((f) => f === "libclntsh.so" || f.startsWith("libclntsh.so."));
  } catch {
    return false;
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/**
 * Scan well-known filesystem locations for an existing Oracle client install.
 * Most Oracle developer machines already have one (PL/SQL Developer, SQL Developer,
 * sqlplus, full DB client) — we look for it instead of forcing the user to download
 * Instant Client separately or set an env var.
 */
function findInstantClientCandidates(): string[] {
  const found: string[] = [];

  if (process.platform === "win32") {
    // C:\instantclient_*
    for (const sub of listSubdirs("C:\\")) {
      if (basename(sub).toLowerCase().startsWith("instantclient") && dirHasOracleClientLib(sub)) {
        found.push(sub);
      }
    }
    // C:\Oracle\<anything>\bin and C:\Oracle\<anything>\<anything>\bin (covers Middleware/Oracle_Home)
    for (const oraSub of listSubdirs("C:\\Oracle")) {
      const bin = join(oraSub, "bin");
      if (dirHasOracleClientLib(bin)) found.push(bin);
      for (const oraSub2 of listSubdirs(oraSub)) {
        const bin2 = join(oraSub2, "bin");
        if (dirHasOracleClientLib(bin2)) found.push(bin2);
      }
    }
    // C:\app\<user>\product\<version>\(client|dbhome)_<n>\bin (Oracle Universal Installer default)
    for (const userDir of listSubdirs("C:\\app")) {
      const productDir = join(userDir, "product");
      for (const verDir of listSubdirs(productDir)) {
        for (const installRoot of listSubdirs(verDir)) {
          const name = basename(installRoot).toLowerCase();
          if (name.startsWith("client_") || name.startsWith("dbhome_")) {
            const bin = join(installRoot, "bin");
            if (dirHasOracleClientLib(bin)) found.push(bin);
          }
        }
      }
    }
    // C:\Program Files\Oracle\*\bin and (x86)
    for (const root of ["C:\\Program Files\\Oracle", "C:\\Program Files (x86)\\Oracle"]) {
      for (const oraSub of listSubdirs(root)) {
        const bin = join(oraSub, "bin");
        if (dirHasOracleClientLib(bin)) found.push(bin);
      }
    }
  } else if (process.platform === "darwin") {
    for (const root of ["/opt/oracle", "/usr/local/oracle"]) {
      for (const sub of listSubdirs(root)) {
        if (basename(sub).toLowerCase().startsWith("instantclient") && dirHasOracleClientLib(sub)) {
          found.push(sub);
        }
      }
    }
  } else {
    for (const root of ["/opt/oracle", "/usr/local/oracle"]) {
      for (const sub of listSubdirs(root)) {
        if (basename(sub).toLowerCase().startsWith("instantclient") && dirHasOracleClientLib(sub)) {
          found.push(sub);
        }
      }
    }
    for (const verDir of listSubdirs("/usr/lib/oracle")) {
      for (const client of listSubdirs(verDir)) {
        if (basename(client).startsWith("client")) {
          const lib = join(client, "lib");
          if (dirHasOracleClientLib(lib)) found.push(lib);
        }
      }
    }
  }

  return [...new Set(found)];
}

/**
 * Try to enable node-oracledb Thick mode (using Oracle Instant Client). Thick mode
 * supports legacy password verifiers (e.g., 0x939) that pre-12c databases sometimes
 * still hold, while Thin mode rejects them with NJS-116. Once initOracleClient succeeds
 * the entire process is locked into Thick mode and every subsequent getConnection uses it.
 *
 * Resolution order:
 *   1. VEESKER_INSTANT_CLIENT_DIR env var (explicit user override)
 *   2. Default initOracleClient — uses PATH / LD_LIBRARY_PATH / DYLD_LIBRARY_PATH
 *   3. Auto-discovered paths (typical Oracle / Instant Client install locations)
 *
 * Set VEESKER_FORCE_THIN=1 to stay in Thin mode regardless.
 */
export function tryEnableThickMode(): { mode: "thin" | "thick"; libDir?: string; error?: string } {
  if (process.env.VEESKER_FORCE_THIN === "1") {
    process.stderr.write("[oracle] VEESKER_FORCE_THIN=1 — using Thin mode\n");
    _driverMode = "thin";
    return { mode: "thin" };
  }

  // The compiled Bun binary doesn't include oracledb's native .node binding (the loader
  // uses a dynamic require path Bun's bundler can't trace). The Tauri host passes the
  // directory containing the binding via VEESKER_ORACLEDB_BINARY_DIR; we forward it as
  // initOracleClient's `binaryDir` option.
  const binaryDir = process.env.VEESKER_ORACLEDB_BINARY_DIR;
  if (binaryDir) {
    process.stderr.write(`[oracle] using native binding from ${binaryDir}\n`);
  } else {
    process.stderr.write("[oracle] VEESKER_ORACLEDB_BINARY_DIR not set — Thick mode will likely fail with NJS-045\n");
  }

  const attempts: Array<{ libDir?: string; label: string }> = [];
  const explicit = process.env.VEESKER_INSTANT_CLIENT_DIR;
  if (explicit) attempts.push({ libDir: explicit, label: `env VEESKER_INSTANT_CLIENT_DIR=${explicit}` });
  attempts.push({ label: "default search path" });
  for (const dir of findInstantClientCandidates()) {
    attempts.push({ libDir: dir, label: `auto-discovered ${dir}` });
  }

  for (const a of attempts) {
    try {
      const opts: { libDir?: string; binaryDir?: string } = {};
      if (a.libDir) opts.libDir = a.libDir;
      if (binaryDir) opts.binaryDir = binaryDir;
      if (Object.keys(opts).length > 0) oracledb.initOracleClient(opts);
      else oracledb.initOracleClient();
      _driverMode = "thick";
      process.stderr.write(`[oracle] Thick mode enabled — ${a.label}\n`);
      return { mode: "thick", libDir: a.libDir };
    } catch (err) {
      const msg = String(err).split("\n")[0];
      process.stderr.write(`[oracle] Thick init failed (${a.label}): ${msg}\n`);
    }
  }

  process.stderr.write("[oracle] no Oracle client library found, using Thin mode\n");
  _driverMode = "thin";
  return { mode: "thin", error: "no Instant Client available" };
}

export function getDriverMode(): "thin" | "thick" {
  return _driverMode;
}

const NJS_116_HINT =
  "\n\nThis password verifier is unsupported in Thin mode. Install Oracle Instant Client " +
  "(https://www.oracle.com/database/technologies/instant-client/downloads.html) and restart " +
  "Veesker — it will auto-enable Thick mode which supports all verifier types.";

function decorateOracleError(err: unknown): Error {
  if (err instanceof Error && err.message.includes("NJS-116") && _driverMode === "thin") {
    return new Error(err.message + NJS_116_HINT);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export type ConnectionSafety = {
  env?: "dev" | "staging" | "prod";
  readOnly?: boolean;
  /** Per-statement timeout (ms). 0 / undefined = unlimited. */
  statementTimeoutMs?: number;
  warnUnsafeDml?: boolean;
  autoPerfAnalysis?: boolean;
};

export type ConnectionTestParams =
  | {
      authType: "basic";
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
      // Safety fields (flattened) — present on saved-connection params, absent on test
      env?: "dev" | "staging" | "prod";
      readOnly?: boolean;
      statementTimeoutMs?: number;
      warnUnsafeDml?: boolean;
      autoPerfAnalysis?: boolean;
    }
  | {
      authType: "wallet";
      walletDir: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
      env?: "dev" | "staging" | "prod";
      readOnly?: boolean;
      statementTimeoutMs?: number;
      warnUnsafeDml?: boolean;
      autoPerfAnalysis?: boolean;
    };

function safetyFromParams(p: ConnectionTestParams): ConnectionSafety {
  return {
    env: p.env,
    readOnly: p.readOnly === true,
    statementTimeoutMs: p.statementTimeoutMs,
    warnUnsafeDml: p.warnUnsafeDml === true,
    autoPerfAnalysis: p.autoPerfAnalysis !== false,
  };
}

export type ConnectionTestResult = {
  ok: true;
  serverVersion: string;
  elapsedMs: number;
};

export async function connectionTest(
  params: ConnectionTestParams
): Promise<ConnectionTestResult> {
  const started = Date.now();
  let conn: oracledb.Connection;
  try {
    conn =
      params.authType === "basic"
        ? await oracledb.getConnection({
            user: params.username,
            password: params.password,
            connectString: `${params.host}:${params.port}/${params.serviceName}`,
            connectTimeout: 10,
          })
        : await oracledb.getConnection({
            user: params.username,
            password: params.password,
            connectString: params.connectAlias,
            configDir: params.walletDir,
            walletLocation: params.walletDir,
            walletPassword: params.walletPassword,
            connectTimeout: 10,
          });
  } catch (err) {
    throw decorateOracleError(err);
  }
  try {
    const result = await conn.execute<{ V: string }>(
      "SELECT BANNER_FULL AS V FROM V$VERSION WHERE ROWNUM = 1",
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const banner = result.rows?.[0]?.V ?? "Oracle (version unavailable)";
    return {
      ok: true,
      serverVersion: banner,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await conn.close();
  }
}

import {
  setSession,
  clearSession,
  hasSession,
  getActiveSession,
  setSessionParams,
  setSessionSafety,
  getSessionSafety,
  withSessionLock,
} from "./state";
import {
  RpcCodedError,
  SESSION_LOST,
  ORACLE_ERR,
  READ_ONLY_BLOCKED,
  UNSAFE_DML_WARNING,
} from "./errors";
import { classifySql, isReadOnlySafe, isUnsafeBulkDml } from "./sql-kind";

export type OpenSessionParams = ConnectionTestParams;
export type OpenSessionResult = { serverVersion: string; currentSchema: string };

export function isLostSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message || "";
  // node-oracledb thin / Oracle codes that mean "session is gone":
  // NJS-003 connection, NJS-500 driver/connect, ORA-03113 EOF, ORA-03114 not connected
  return (
    m.includes("NJS-003") ||
    m.includes("NJS-500") ||
    m.includes("ORA-03113") ||
    m.includes("ORA-03114") ||
    m.includes("DPI-1010")
  );
}

export async function buildConnection(p: OpenSessionParams): Promise<oracledb.Connection> {
  try {
    if (p.authType === "basic") {
      return await oracledb.getConnection({
        user: p.username,
        password: p.password,
        connectString: `${p.host}:${p.port}/${p.serviceName}`,
        connectTimeout: 15,
      });
    }
    return await oracledb.getConnection({
      user: p.username,
      password: p.password,
      connectString: p.connectAlias,
      configDir: p.walletDir,
      walletLocation: p.walletDir,
      walletPassword: p.walletPassword,
      connectTimeout: 15,
    });
  } catch (err) {
    throw decorateOracleError(err);
  }
}

export async function openSession(p: OpenSessionParams): Promise<OpenSessionResult> {
  return withSessionLock(async () => {
    // Replace any prior session before opening a new one.
    if (hasSession()) {
      try {
        await getActiveSession().close();
      } catch {
        // Best-effort close — old session may already be dead.
      }
      clearSession();
    }

    const conn = await buildConnection(p);
    try {
      const safety = safetyFromParams(p);
      // Apply per-statement timeout. Setting to 0 means no timeout (oracledb default).
      // We only set if > 0, so existing sessions are unaffected.
      if (typeof safety.statementTimeoutMs === "number" && safety.statementTimeoutMs > 0) {
        try {
          conn.callTimeout = safety.statementTimeoutMs;
        } catch (e) {
          // Non-fatal: log but proceed. Old oracledb versions may not have callTimeout.
          log.error(`[oracle] failed to apply callTimeout: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const versionRes = await conn.execute<{ V: string }>(
        "SELECT BANNER_FULL AS V FROM V$VERSION WHERE ROWNUM = 1",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const schemaRes = await conn.execute<{ S: string }>(
        "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS S FROM DUAL",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const serverVersion = versionRes.rows?.[0]?.V ?? "Oracle (version unavailable)";
      const currentSchema = schemaRes.rows?.[0]?.S ?? p.username.toUpperCase();
      setSession(conn, currentSchema);
      setSessionParams(p);
      setSessionSafety(safety);
      return { serverVersion, currentSchema };
    } catch (err) {
      // Failed during the version/schema bootstrap — clean up the half-open session.
      try { await conn.close(); } catch {}
      throw err;
    }
  });
}

export async function closeSession(): Promise<{ closed: true }> {
  return withSessionLock(async () => {
    if (hasSession()) {
      try {
        await getActiveSession().close();
      } catch {
        // Best-effort.
      }
      clearSession();
    }
    return { closed: true };
  });
}

// Helper used by metadata handlers to wrap Oracle errors into coded RPC errors
// and to clear stale session state when the connection is gone.
export async function withActiveSession<T>(
  fn: (conn: oracledb.Connection) => Promise<T>
): Promise<T> {
  const conn = getActiveSession();
  try {
    return await fn(conn);
  } catch (err) {
    // Let already-coded errors (e.g. QUERY_CANCELLED) pass through as-is.
    if (err instanceof RpcCodedError) throw err;
    if (isLostSessionError(err)) {
      clearSession();
      throw new RpcCodedError(SESSION_LOST, (err as Error).message);
    }
    throw new RpcCodedError(
      ORACLE_ERR,
      err instanceof Error ? err.message : String(err)
    );
  }
}

import { OBJECT_NOT_FOUND, QUERY_CANCELLED, SPLITTER_ERROR } from "./errors";
import { splitSql } from "./sql-splitter";

export type SchemaRow = { name: string; isCurrent: boolean };
export type ObjectRef = { name: string };
export type ObjectKind = "TABLE" | "VIEW" | "SEQUENCE";

export type ColumnDef = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  dataDefault: string | null;
  comments: string | null;
  isVector: boolean;
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: ColumnDef[];
  indexes: IndexDef[];
  rowCount: number | null;
  lastAnalyzed: string | null;
};

function formatDataType(
  dataType: string,
  length: number | null,
  precision: number | null,
  scale: number | null
): string {
  const dt = dataType.toUpperCase();
  if (dt === "NUMBER") {
    if (precision != null && scale != null && scale > 0) return `NUMBER(${precision},${scale})`;
    if (precision != null) return `NUMBER(${precision})`;
    return "NUMBER";
  }
  if (dt === "VARCHAR2" || dt === "NVARCHAR2" || dt === "CHAR" || dt === "NCHAR" || dt === "RAW") {
    return length != null ? `${dt}(${length})` : dt;
  }
  if (dt.startsWith("TIMESTAMP")) {
    return scale != null ? `TIMESTAMP(${scale})` : dt;
  }
  return dt;
}

export async function schemaList(): Promise<{ schemas: SchemaRow[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ NAME: string; IS_CURRENT: number }>(
      `SELECT username AS NAME,
              CASE WHEN username = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 1 ELSE 0 END AS IS_CURRENT
         FROM all_users
         ORDER BY (CASE WHEN username = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 0 ELSE 1 END), username`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const schemas: SchemaRow[] = (res.rows ?? []).map((r) => ({
      name: r.NAME,
      isCurrent: r.IS_CURRENT === 1,
    }));
    return { schemas };
  });
}

export async function objectsList(p: {
  owner: string;
  type: ObjectKind;
}): Promise<{ objects: ObjectRef[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ NAME: string }>(
      `SELECT object_name AS NAME
         FROM all_objects
        WHERE owner = :owner AND object_type = :type
        ORDER BY object_name`,
      { owner: p.owner, type: p.type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return { objects: (res.rows ?? []).map((r) => ({ name: r.NAME })) };
  });
}

export async function tableDescribe(p: {
  owner: string;
  name: string;
}): Promise<TableDetails> {
  return withActiveSession(async (conn) => {
    const colsRes = await conn.execute<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      DATA_LENGTH: number | null;
      DATA_PRECISION: number | null;
      DATA_SCALE: number | null;
      NULLABLE: string;
      DATA_DEFAULT: string | null;
      COMMENTS: string | null;
      IS_PK: number;
    }>(
      `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale,
              c.nullable, c.data_default, cc.comments,
              (CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END) AS is_pk
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc
           ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
         LEFT JOIN (
           SELECT acc.owner, acc.table_name, acc.column_name
             FROM all_constraints ac
             JOIN all_cons_columns acc
               ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
            WHERE ac.constraint_type = 'P'
         ) pk
           ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.owner = :owner AND c.table_name = :name
        ORDER BY c.column_id`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if ((colsRes.rows ?? []).length === 0) {
      throw new RpcCodedError(
        OBJECT_NOT_FOUND,
        `Object ${p.owner}.${p.name} has no columns or does not exist.`
      );
    }

    const columns: ColumnDef[] = (colsRes.rows ?? []).map((r) => ({
      name: r.COLUMN_NAME,
      dataType: formatDataType(r.DATA_TYPE, r.DATA_LENGTH, r.DATA_PRECISION, r.DATA_SCALE),
      nullable: r.NULLABLE === "Y",
      isPk: r.IS_PK === 1,
      dataDefault: r.DATA_DEFAULT === null ? null : String(r.DATA_DEFAULT).trim(),
      comments: r.COMMENTS,
      isVector: r.DATA_TYPE.toUpperCase() === "VECTOR",
    }));

    const idxRes = await conn.execute<{
      INDEX_NAME: string;
      UNIQUENESS: string;
      COLUMNS: string;
    }>(
      `SELECT i.index_name, i.uniqueness,
              LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) AS columns
         FROM all_indexes i
         JOIN all_ind_columns ic
           ON ic.index_owner = i.owner AND ic.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :name
        GROUP BY i.index_name, i.uniqueness
        ORDER BY i.index_name`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const indexes: IndexDef[] = (idxRes.rows ?? []).map((r) => ({
      name: r.INDEX_NAME,
      isUnique: r.UNIQUENESS === "UNIQUE",
      columns: r.COLUMNS.split(","),
    }));

    const cntRes = await conn.execute<{ NUM_ROWS: number | null; LAST_ANALYZED: Date | null }>(
      `SELECT num_rows AS NUM_ROWS, last_analyzed AS LAST_ANALYZED
         FROM all_tables WHERE owner = :owner AND table_name = :name`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rowCount = cntRes.rows?.[0]?.NUM_ROWS ?? null;
    const lastAnalyzedRaw = cntRes.rows?.[0]?.LAST_ANALYZED ?? null;
    const lastAnalyzed = lastAnalyzedRaw ? lastAnalyzedRaw.toISOString() : null;

    return { columns, indexes, rowCount, lastAnalyzed };
  });
}

export type QueryColumn = { name: string; dataType: string };
export type QueryResultRow = unknown[];
export type QueryResult = {
  columns: QueryColumn[];
  rows: QueryResultRow[];
  rowCount: number;
  elapsedMs: number;
};

// ── In-flight query tracking ─────────────────────────────────────────────────
// At most one query is running at a time on the shared connection.
type RunningQuery = { requestId: string; cancelled: boolean };
let _running: RunningQuery | null = null;

/** Exposed for tests only — allows resetting module-level state. */
export function _resetRunning(): void {
  _running = null;
}

/** Exposed for tests only — allows inspecting current running state. */
export function _getRunning(): RunningQuery | null {
  return _running;
}

function formatColumnType(m: {
  dbTypeName?: string;
  precision?: number | null;
  scale?: number | null;
  byteSize?: number | null;
}): string {
  const t = (m.dbTypeName ?? "UNKNOWN").toUpperCase();
  if (t === "NUMBER") {
    if (m.precision != null && m.scale != null && m.scale > 0) return `NUMBER(${m.precision},${m.scale})`;
    if (m.precision != null) return `NUMBER(${m.precision})`;
    return "NUMBER";
  }
  if (t === "VARCHAR2" || t === "NVARCHAR2" || t === "CHAR" || t === "NCHAR" || t === "RAW") {
    return m.byteSize != null ? `${t}(${m.byteSize})` : t;
  }
  if (t.startsWith("TIMESTAMP")) {
    return m.scale != null ? `TIMESTAMP(${m.scale})` : t;
  }
  return t;
}

function normalizeCell(v: unknown): unknown {
  if (v instanceof Float32Array || v instanceof Float64Array) return Array.from(v);
  if (v instanceof Int8Array || v instanceof Uint8Array) return Array.from(v);
  return v;
}

function isCancelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message || "";
  // node-oracledb thin driver raises ORA-01013 or NJS-018 when break() is called.
  return m.includes("ORA-01013") || m.includes("NJS-018");
}

async function drainDbmsOutput(conn: oracledb.Connection): Promise<string[] | null> {
  // Use DBMS_OUTPUT.GET_LINES (plural) — fetches up to numlines per round-trip
  // instead of one-line-per-call. Without this, a procedure that prints 10k
  // lines costs 10k Oracle round-trips (potentially several seconds).
  const BATCH = 100;
  const HARD_CAP = 10_000;
  try {
    const lines: string[] = [];
    let total = 0;
    while (total < HARD_CAP) {
      const r = await conn.execute<{ NUM: number; LINES: string[] }>(
        `DECLARE
           v_lines DBMS_OUTPUT.CHARARR;
           v_num   INTEGER := :requested;
         BEGIN
           DBMS_OUTPUT.GET_LINES(v_lines, v_num);
           :num := v_num;
           :lines := v_lines;
         END;`,
        {
          requested: { dir: oracledb.BIND_IN, type: oracledb.NUMBER, val: BATCH },
          num:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          lines:     {
            dir: oracledb.BIND_OUT,
            type: oracledb.STRING,
            maxArraySize: BATCH,
            maxSize: 32767,
          },
        }
      );
      const ob = r.outBinds as { NUM: number; LINES: string[] | null } | undefined;
      const got = ob?.NUM ?? 0;
      if (got <= 0) break;
      const batchLines = ob?.LINES ?? [];
      for (let i = 0; i < got && lines.length < HARD_CAP; i++) {
        lines.push(batchLines[i] ?? "");
      }
      total += got;
      // If the server returned fewer than we asked, the buffer is drained.
      if (got < BATCH) break;
    }
    return lines;
  } catch (e) {
    log.error(`[drainDbmsOutput]: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Discriminated union for multi-statement server results.
export type ServerStatementResult =
  | { status: "ok";        statementIndex: number; sql: string; elapsedMs: number; columns: QueryColumn[]; rows: unknown[][]; rowCount: number; output: string[] | null }
  | { status: "error";     statementIndex: number; sql: string; elapsedMs: number; error: { code: number; message: string }; output: string[] | null }
  | { status: "cancelled"; statementIndex: number; sql: string; elapsedMs: number; output: null };

export type MultiQueryResult = { multi: true; results: ServerStatementResult[] };

// oracledb thin mode detects statement type by first keyword (case-sensitive in some versions).
// Passing outFormat/maxRows also signals "this is a query" and can cause the driver to strip
// the trailing `;` from PL/SQL anonymous blocks, producing ORA-06550. Avoid both problems
// by using empty options for any PL/SQL statement.
// Allow leading -- line comments before PL/SQL keywords (splitter may include them).
const PLSQL_EXEC_RE =
  /^(?:[ \t]*--[^\n]*\n)*[ \t]*(?:BEGIN|DECLARE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|PACKAGE(?:\s+BODY)?|TYPE(?:\s+BODY)?))\b/i;
const PLSQL_ANON_RE = /^(?:[ \t]*--[^\n]*\n)*[ \t]*(?:BEGIN|DECLARE)\b/i;

/** Run a single statement against the active session; returns QueryResult. */
async function executeSingleStatement(
  conn: oracledb.Connection,
  sql: string,
  requestId: string,
  fetchAll: boolean = false
): Promise<QueryResult> {
  const started = Date.now();
  let r: any;
  const isPlsql = PLSQL_EXEC_RE.test(sql);
  // oracledb thin mode strips the trailing `;` from anonymous PL/SQL blocks when
  // any options object is passed (including `{}`), causing ORA-06550.
  // Oracle SQL APIs accept BEGIN...END without the trailing semicolon, so strip it.
  const sqlToSend = PLSQL_ANON_RE.test(sql) ? sql.replace(/;\s*$/, "") : sql;
  try {
    if (isPlsql) {
      // Don't pass a bind array for PL/SQL: thin mode scans the statement body for
      // :name patterns and misidentifies :old/:new trigger references as bind variables.
      r = await conn.execute(sqlToSend);
    } else {
      // maxRows: 0 means unlimited (oracledb convention)
      const opts = fetchAll
        ? { maxRows: 0, outFormat: oracledb.OUT_FORMAT_ARRAY }
        : { maxRows: 100, outFormat: oracledb.OUT_FORMAT_ARRAY };
      r = await conn.execute(sqlToSend, [], opts);
    }
  } catch (execErr) {
    if (_running?.requestId === requestId && _running.cancelled && isCancelError(execErr)) {
      throw new RpcCodedError(QUERY_CANCELLED, "Cancelled by user");
    }
    throw execErr;
  }
  const elapsedMs = Date.now() - started;
  const meta: any[] = r.metaData ?? [];
  const rawRows: any[][] = r.rows ?? [];
  const columns: QueryColumn[] = meta.map((m) => ({
    name: m.name,
    dataType: formatColumnType(m),
  }));
  const rows: QueryResultRow[] = rawRows.map((row) => row.map(normalizeCell));
  const rowCount = rawRows.length > 0 ? rawRows.length : (r.rowsAffected ?? 0);
  return { columns, rows, rowCount, elapsedMs };
}

/**
 * Apply the read-only and unsafe-DML guards to a single statement.
 * Throws RpcCodedError on block, returns void on pass.
 *
 * - acknowledgeUnsafe=true bypasses the unsafe-DML warning (caller already saw it).
 * - Read-only is never bypassed — caller must edit the connection.
 */
function enforceSafetyForStatement(sql: string, opts: { acknowledgeUnsafe?: boolean } = {}): void {
  const safety = getSessionSafety();
  const kind = classifySql(sql);

  if (safety.readOnly === true && !isReadOnlySafe(kind, sql)) {
    throw new RpcCodedError(
      READ_ONLY_BLOCKED,
      `This connection is read-only — ${kind.toUpperCase()} statements are blocked. ` +
        `Edit the connection to disable read-only mode if you need to run ${kind.toUpperCase()}.`
    );
  }

  if (safety.warnUnsafeDml === true && !opts.acknowledgeUnsafe && isUnsafeBulkDml(sql)) {
    throw new RpcCodedError(
      UNSAFE_DML_WARNING,
      "This UPDATE/DELETE has no WHERE clause and will affect ALL rows. " +
        "Confirm you want to run it (the IDE will show a warning modal)."
    );
  }
}

export async function queryExecute(p: {
  sql: string;
  requestId?: string;
  splitMulti?: boolean;
  fetchAll?: boolean;
  acknowledgeUnsafe?: boolean;
}): Promise<QueryResult | MultiQueryResult> {
  if (_running !== null) {
    throw new RpcCodedError(ORACLE_ERR, "Another query is already running on this connection");
  }
  // Assign or generate a requestId so cancellation can be matched.
  const requestId = p.requestId ?? crypto.randomUUID();
  _running = { requestId, cancelled: false };

  // ── Multi-statement path ──────────────────────────────────────────────────
  if (p.splitMulti === true) {
    try {
      const { statements, errors } = splitSql(p.sql);
      if (errors.length > 0) {
        const msg = errors.map((e) => `line ${e.line}: ${e.message}`).join("; ");
        throw new RpcCodedError(SPLITTER_ERROR, `Splitter error: ${msg}`);
      }
      if (statements.length === 0) {
        return { multi: true, results: [] };
      }

      // Enforce read-only / unsafe-DML BEFORE we run anything: if the batch
      // contains a forbidden statement, bail out cleanly so we don't half-execute.
      for (const stmt of statements) {
        enforceSafetyForStatement(stmt, { acknowledgeUnsafe: p.acknowledgeUnsafe });
      }

      const collected: ServerStatementResult[] = [];

      // Enable DBMS_OUTPUT once for the whole multi-statement run.
      // Wrapped in withActiveSession so any session-lost error is mapped consistently.
      try {
        await withActiveSession(async (conn) => {
          await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(1000000); END;`);
        });
      } catch {
        // Non-fatal — DBMS_OUTPUT is best-effort.
      }

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];

        // Check for cancellation between statements.
        if (_running?.requestId === requestId && _running.cancelled) {
          const started = Date.now();
          collected.push({ status: "cancelled", statementIndex: i, sql: stmt, elapsedMs: Date.now() - started, output: null });
          break;
        }

        try {
          let output: string[] | null = null;
          const qr = await withActiveSession(async (conn) => {
            const result = await executeSingleStatement(conn, stmt, requestId);
            output = await drainDbmsOutput(conn);
            return result;
          });
          collected.push({
            status: "ok",
            statementIndex: i,
            sql: stmt,
            elapsedMs: qr.elapsedMs,
            columns: qr.columns,
            rows: qr.rows,
            rowCount: qr.rowCount,
            output,
          });
        } catch (err) {
          if (err instanceof RpcCodedError && err.code === QUERY_CANCELLED) {
            collected.push({ status: "cancelled", statementIndex: i, sql: stmt, elapsedMs: 0, output: null });
          } else {
            const code = err instanceof RpcCodedError ? err.code : (err instanceof Error ? -32013 : -32000);
            const message = err instanceof Error ? err.message : String(err);
            collected.push({ status: "error", statementIndex: i, sql: stmt, elapsedMs: 0, error: { code, message }, output: null });
          }
          break; // Stop on error or cancel
        }
      }

      return { multi: true, results: collected };
    } finally {
      if (_running?.requestId === requestId) {
        _running = null;
      }
    }
  }

  // ── Single-statement path (default, back-compat) ──────────────────────────
  try {
    enforceSafetyForStatement(p.sql, { acknowledgeUnsafe: p.acknowledgeUnsafe });
    return await withActiveSession(async (conn) => {
      return executeSingleStatement(conn, p.sql, requestId, p.fetchAll === true);
    });
  } finally {
    if (_running?.requestId === requestId) _running = null;
  }
}

export type QueryCancelResult = { cancelled: true; requestId: string } | { cancelled: false };

export async function queryCancel(p: { requestId: string }): Promise<QueryCancelResult> {
  if (_running === null || _running.requestId !== p.requestId) {
    return { cancelled: false };
  }
  _running.cancelled = true;
  // Interrupt the in-flight call on the shared connection.
  const conn = getActiveSession();
  try {
    await conn.break();
  } catch {
    // break() may fail if the query already completed; that's fine.
  }
  return { cancelled: true, requestId: p.requestId };
}

export type PlsqlKind = "PROCEDURE" | "FUNCTION" | "PACKAGE" | "PACKAGE BODY" | "TRIGGER" | "TYPE" | "TYPE BODY";
export type CompileErrorRow = { line: number; position: number; text: string };
export type ObjectRefWithStatus = { name: string; status: string };

export async function compileErrors(p: {
  objectType: string;
  objectName: string;
}): Promise<{ errors: CompileErrorRow[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ LINE: number; POSITION: number; TEXT: string }>(
      `SELECT line, position, text
         FROM user_errors
        WHERE name = UPPER(:name)
          AND type = UPPER(:type)
        ORDER BY sequence`,
      { name: p.objectName, type: p.objectType },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return {
      errors: (res.rows ?? []).map((r) => ({
        line: r.LINE,
        position: r.POSITION,
        text: r.TEXT,
      })),
    };
  });
}

export async function objectDdl(p: {
  owner: string;
  objectType: string;
  objectName: string;
}): Promise<{ ddl: string; spec?: string; body?: string }> {
  return withActiveSession(async (conn) => {
    const fetchOpts = {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      fetchTypeHandler: (meta: any) =>
        meta.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined,
    };

    const specRes = await conn.execute<[string]>(
      `SELECT DBMS_METADATA.GET_DDL(UPPER(:type), UPPER(:name), UPPER(:owner)) FROM dual`,
      { type: p.objectType, name: p.objectName, owner: p.owner },
      fetchOpts
    );
    const specDdl: string = (specRes.rows?.[0]?.[0] as string) ?? "";

    if (p.objectType.toUpperCase() === "PACKAGE") {
      let bodyDdl = "";
      try {
        const bodyRes = await conn.execute<[string]>(
          `SELECT DBMS_METADATA.GET_DDL('PACKAGE BODY', UPPER(:name), UPPER(:owner)) FROM dual`,
          { name: p.objectName, owner: p.owner },
          fetchOpts
        );
        bodyDdl = (bodyRes.rows?.[0]?.[0] as string) ?? "";
      } catch {
        // No body exists — body stays ""
      }
      const combined = bodyDdl.trim()
        ? specDdl.trimEnd() + "\n\n" + bodyDdl
        : specDdl;
      return { ddl: combined, spec: specDdl, body: bodyDdl };
    }

    return { ddl: specDdl };
  });
}

export async function objectsListPlsql(p: {
  owner: string;
  kind: PlsqlKind;
}): Promise<{ objects: ObjectRefWithStatus[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ NAME: string; STATUS: string }>(
      `SELECT object_name AS NAME, status AS STATUS
         FROM all_objects
        WHERE owner = :owner AND object_type = :kind
        ORDER BY object_name`,
      { owner: p.owner, kind: p.kind },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return {
      objects: (res.rows ?? []).map((r) => ({ name: r.NAME, status: r.STATUS })),
    };
  });
}

export type DataFlowNode = { owner: string; name: string; objectType: string };
export type DataFlowTriggerInfo = { name: string; triggerType: string; event: string; status: string };
export type DataFlowResult = {
  upstream: DataFlowNode[];
  downstream: DataFlowNode[];
  fkParents: DataFlowNode[];
  fkChildren: DataFlowNode[];
  triggers: DataFlowTriggerInfo[];
};

export async function objectDataflow(p: {
  owner: string;
  objectType: string;
  objectName: string;
}): Promise<DataFlowResult> {
  return withActiveSession(async (conn) => {
    const opts = { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 200 };

    // What this object depends on (upstream)
    const upstreamTypes = p.objectType.toUpperCase() === "PACKAGE"
      ? ["PACKAGE", "PACKAGE BODY"]
      : [p.objectType.toUpperCase()];

    const upstreamPlaceholders = upstreamTypes.map((_, i) => `:t${i}`).join(", ");
    const upstreamBinds: Record<string, string> = { owner: p.owner, name: p.objectName };
    upstreamTypes.forEach((t, i) => { upstreamBinds[`t${i}`] = t; });

    const upRes = await conn.execute<[string, string, string]>(
      `SELECT DISTINCT d.referenced_owner, d.referenced_name, d.referenced_type
       FROM all_dependencies d
       WHERE d.owner = UPPER(:owner) AND d.name = UPPER(:name)
         AND d.type IN (${upstreamPlaceholders})
         AND d.referenced_type NOT IN ('NON-EXISTENT', 'UNDEFINED', 'SYNONYM')
         AND NOT (d.referenced_owner = UPPER(:owner) AND d.referenced_name = UPPER(:name))
       ORDER BY d.referenced_type, d.referenced_name`,
      upstreamBinds,
      opts
    );

    // What depends on this object (downstream)
    const dnRes = await conn.execute<[string, string, string]>(
      `SELECT DISTINCT d.owner, d.name, d.type
       FROM all_dependencies d
       WHERE d.referenced_owner = UPPER(:owner) AND d.referenced_name = UPPER(:name)
         AND d.referenced_type = UPPER(:objectType)
         AND NOT (d.owner = UPPER(:owner) AND d.name = UPPER(:name))
       ORDER BY d.type, d.name`,
      { owner: p.owner, name: p.objectName, objectType: p.objectType },
      opts
    );

    const toNode = (row: [string, string, string]): DataFlowNode => ({
      owner: row[0], name: row[1], objectType: row[2],
    });

    const upstream: DataFlowNode[] = (upRes.rows ?? []).map(toNode);
    const downstream: DataFlowNode[] = (dnRes.rows ?? []).map(toNode);

    let fkParents: DataFlowNode[] = [];
    let fkChildren: DataFlowNode[] = [];
    let triggers: DataFlowTriggerInfo[] = [];

    if (p.objectType.toUpperCase() === "TABLE") {
      // FK parents: tables that this table references
      const parRes = await conn.execute<[string, string]>(
        `SELECT DISTINCT cc.owner, cc.table_name
         FROM all_constraints c
         JOIN all_constraints cc ON cc.constraint_name = c.r_constraint_name AND cc.owner = c.r_owner
         WHERE c.table_name = UPPER(:name) AND c.owner = UPPER(:owner) AND c.constraint_type = 'R'
         ORDER BY cc.table_name`,
        { name: p.objectName, owner: p.owner },
        opts
      );
      fkParents = (parRes.rows ?? []).map(r => ({ owner: r[0], name: r[1], objectType: "TABLE" }));

      // FK children: tables that reference this table
      const chRes = await conn.execute<[string, string]>(
        `SELECT DISTINCT c.owner, c.table_name
         FROM all_constraints c
         JOIN all_constraints rc ON rc.constraint_name = c.r_constraint_name AND rc.owner = c.r_owner
         WHERE rc.table_name = UPPER(:name) AND rc.owner = UPPER(:owner) AND c.constraint_type = 'R'
         ORDER BY c.table_name`,
        { name: p.objectName, owner: p.owner },
        opts
      );
      fkChildren = (chRes.rows ?? []).map(r => ({ owner: r[0], name: r[1], objectType: "TABLE" }));

      // Triggers on this table
      const trgRes = await conn.execute<[string, string, string, string]>(
        `SELECT trigger_name, trigger_type, triggering_event, status
         FROM all_triggers
         WHERE table_name = UPPER(:name) AND owner = UPPER(:owner)
         ORDER BY trigger_name`,
        { name: p.objectName, owner: p.owner },
        opts
      );
      triggers = (trgRes.rows ?? []).map(r => ({
        name: r[0], triggerType: r[1], event: r[2], status: r[3],
      }));
    }

    return { upstream, downstream, fkParents, fkChildren, triggers };
  });
}

// ── Table Related ────────────────────────────────────────────────────────────

export type TriggerRef = {
  name: string;
  triggerType: string; // BEFORE/AFTER/INSTEAD OF
  event: string;       // INSERT OR UPDATE OR DELETE
  status: string;      // ENABLED/DISABLED
  forEach: string;     // ROW / STATEMENT
};

export type FkOutgoing = {
  constraintName: string;
  columns: string;
  refOwner: string;
  refTable: string;
  refColumns: string;
  deleteRule: string;
};

export type FkIncoming = {
  fkOwner: string;
  fkTable: string;
  constraintName: string;
  columns: string;
  deleteRule: string;
};

export type Dependent = {
  owner: string;
  name: string;
  type: string;
};

export type CheckConstraint = {
  name: string;
  columns: string;
  condition: string;
  type: string; // C=check, U=unique
  status: string;
};

export type TableGrant = {
  grantor: string;
  grantee: string;
  privilege: string;
  grantable: string;
};

export type TableRelated = {
  triggers: TriggerRef[];
  fksOut: FkOutgoing[];
  fksIn: FkIncoming[];
  dependents: Dependent[];
  constraints: CheckConstraint[];
  grants: TableGrant[];
};

export async function tableRelated(p: {
  owner: string;
  name: string;
}): Promise<TableRelated> {
  return withActiveSession(async (conn) => {
    const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    const b = { owner: p.owner, name: p.name };

    const safe = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try { return await fn(); } catch { return []; }
    };

    const [triggers, fksOut, fksIn, dependents, constraints, grants] = await Promise.all([
      safe(async () => {
        const r = await conn.execute<{
          TRIGGER_NAME: string; TRIGGER_TYPE: string;
          TRIGGERING_EVENT: string; STATUS: string; ACTION_TYPE: string;
        }>(
          `SELECT trigger_name, trigger_type, triggering_event, status, action_type
             FROM all_triggers
            WHERE owner = :owner AND table_name = :name
            ORDER BY trigger_name`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({
          name: x.TRIGGER_NAME, triggerType: x.TRIGGER_TYPE,
          event: x.TRIGGERING_EVENT, status: x.STATUS, forEach: x.ACTION_TYPE,
        }));
      }),

      safe(async () => {
        const r = await conn.execute<{
          CONSTRAINT_NAME: string; COLUMNS: string; REF_OWNER: string;
          REF_TABLE: string; REF_COLUMNS: string; DELETE_RULE: string;
        }>(
          `SELECT ac.constraint_name,
                  LISTAGG(acc.column_name, ', ') WITHIN GROUP (ORDER BY acc.position) AS columns,
                  arc.owner AS ref_owner, arc.table_name AS ref_table,
                  LISTAGG(arcc.column_name, ', ') WITHIN GROUP (ORDER BY arcc.position) AS ref_columns,
                  ac.delete_rule
             FROM all_constraints ac
             JOIN all_cons_columns acc
               ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
             JOIN all_constraints arc
               ON arc.constraint_name = ac.r_constraint_name AND arc.owner = ac.r_owner
             JOIN all_cons_columns arcc
               ON arcc.owner = arc.owner AND arcc.constraint_name = arc.constraint_name
              AND arcc.position = acc.position
            WHERE ac.owner = :owner AND ac.table_name = :name AND ac.constraint_type = 'R'
            GROUP BY ac.constraint_name, arc.owner, arc.table_name, ac.delete_rule
            ORDER BY ac.constraint_name`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({
          constraintName: x.CONSTRAINT_NAME, columns: x.COLUMNS,
          refOwner: x.REF_OWNER, refTable: x.REF_TABLE,
          refColumns: x.REF_COLUMNS, deleteRule: x.DELETE_RULE,
        }));
      }),

      safe(async () => {
        const r = await conn.execute<{
          FK_OWNER: string; FK_TABLE: string;
          CONSTRAINT_NAME: string; COLUMNS: string; DELETE_RULE: string;
        }>(
          `SELECT ac.owner AS fk_owner, ac.table_name AS fk_table, ac.constraint_name,
                  LISTAGG(acc.column_name, ', ') WITHIN GROUP (ORDER BY acc.position) AS columns,
                  ac.delete_rule
             FROM all_constraints ac
             JOIN all_cons_columns acc
               ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
            WHERE ac.constraint_type = 'R'
              AND ac.r_owner = :owner
              AND ac.r_constraint_name IN (
                SELECT constraint_name FROM all_constraints
                 WHERE owner = :owner AND table_name = :name AND constraint_type = 'P'
              )
            GROUP BY ac.owner, ac.table_name, ac.constraint_name, ac.delete_rule
            ORDER BY ac.table_name, ac.constraint_name`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({
          fkOwner: x.FK_OWNER, fkTable: x.FK_TABLE,
          constraintName: x.CONSTRAINT_NAME, columns: x.COLUMNS, deleteRule: x.DELETE_RULE,
        }));
      }),

      safe(async () => {
        const r = await conn.execute<{ OWNER: string; NAME: string; TYPE: string }>(
          `SELECT DISTINCT d.owner, d.name, d.type
             FROM all_dependencies d
            WHERE d.referenced_owner = :owner
              AND d.referenced_name = :name
              AND d.referenced_type = 'TABLE'
              AND d.type IN ('VIEW','PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER','MATERIALIZED VIEW','TYPE')
              AND NOT (d.owner = :owner AND d.name = :name)
            ORDER BY d.type, d.name`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({ owner: x.OWNER, name: x.NAME, type: x.TYPE }));
      }),

      safe(async () => {
        const r = await conn.execute<{
          CONSTRAINT_NAME: string; CONSTRAINT_TYPE: string;
          COLUMNS: string; SEARCH_CONDITION: string | null; STATUS: string;
        }>(
          `SELECT ac.constraint_name, ac.constraint_type,
                  NVL(LISTAGG(acc.column_name, ', ') WITHIN GROUP (ORDER BY acc.position), '') AS columns,
                  ac.search_condition_vc AS search_condition,
                  ac.status
             FROM all_constraints ac
             LEFT JOIN all_cons_columns acc
               ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
            WHERE ac.owner = :owner AND ac.table_name = :name
              AND ac.constraint_type IN ('C', 'U')
              AND ac.constraint_name NOT LIKE 'SYS\_C%' ESCAPE '\'
            GROUP BY ac.constraint_name, ac.constraint_type, ac.search_condition_vc, ac.status
            ORDER BY ac.constraint_type, ac.constraint_name`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({
          name: x.CONSTRAINT_NAME, type: x.CONSTRAINT_TYPE,
          columns: x.COLUMNS, condition: x.SEARCH_CONDITION ?? "", status: x.STATUS,
        }));
      }),

      safe(async () => {
        const r = await conn.execute<{
          GRANTOR: string; GRANTEE: string; PRIVILEGE: string; GRANTABLE: string;
        }>(
          `SELECT grantor, grantee, privilege, grantable
             FROM all_tab_privs
            WHERE table_schema = :owner AND table_name = :name
            ORDER BY grantee, privilege`,
          b, opts
        );
        return (r.rows ?? []).map((x) => ({
          grantor: x.GRANTOR, grantee: x.GRANTEE,
          privilege: x.PRIVILEGE, grantable: x.GRANTABLE,
        }));
      }),
    ]);

    return { triggers, fksOut, fksIn, dependents, constraints, grants };
  });
}

export async function tableCountRows(p: {
  owner: string;
  name: string;
}): Promise<{ count: number }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<[number]>(
      `SELECT COUNT(*) FROM ${quoteIdent(p.owner)}.${quoteIdent(p.name)}`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    return { count: res.rows?.[0]?.[0] ?? 0 };
  });
}

export async function connectionCommit(): Promise<{ committed: true }> {
  return withActiveSession(async (conn) => {
    await conn.commit();
    return { committed: true as const };
  });
}

export async function connectionRollback(): Promise<{ rolledBack: true }> {
  return withActiveSession(async (conn) => {
    await conn.rollback();
    return { rolledBack: true as const };
  });
}

export type SearchResult = { owner: string; name: string; type: string };

export async function objectsSearch(p: {
  query: string;
}): Promise<{ objects: SearchResult[] }> {
  return withActiveSession(async (conn) => {
    const q = p.query.trim().toUpperCase();
    if (!q) return { objects: [] };
    const res = await conn.execute<[string, string, string]>(
      `SELECT owner, object_name, object_type
         FROM all_objects
        WHERE object_name LIKE '%' || :q || '%'
          AND object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','PACKAGE','SEQUENCE','TRIGGER','TYPE')
        ORDER BY
          CASE WHEN owner = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 0 ELSE 1 END,
          CASE WHEN object_name LIKE :q || '%' THEN 0 ELSE 1 END,
          object_name
        FETCH FIRST 50 ROWS ONLY`,
      { q },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    return {
      objects: (res.rows ?? []).map(([owner, name, type]) => ({ owner, name, type })),
    };
  });
}

export async function schemaKindCounts(p: {
  owner: string;
}): Promise<{ counts: Record<string, number> }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<[string, number]>(
      `SELECT object_type, COUNT(*) AS cnt
         FROM all_objects
        WHERE owner = :owner
          AND object_type IN ('TABLE','VIEW','SEQUENCE','PROCEDURE','FUNCTION','PACKAGE','TRIGGER','TYPE')
        GROUP BY object_type`,
      { owner: p.owner },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    const counts: Record<string, number> = {};
    for (const [type, cnt] of res.rows ?? []) counts[type] = cnt;
    return { counts };
  });
}

// ── Vector Similarity Search (Oracle 23ai+) ──────────────────────────────────

export type VectorSearchResult = {
  columns: Array<{ name: string }>;
  rows: unknown[][];
  scores: number[];
  vectors?: number[][];
  queryVector?: number[];
};

export async function vectorSimilaritySearch(p: {
  owner: string;
  tableName: string;
  columnName: string;
  vector: number[];
  distanceMetric: "COSINE" | "EUCLIDEAN" | "DOT";
  limit: number;
  withVectors?: boolean;
}): Promise<VectorSearchResult> {
  return withActiveSession(async (conn) => {
    const badIdx = p.vector.findIndex(n => !isFinite(n) || isNaN(n));
    if (badIdx >= 0) throw new Error(`Invalid vector value at index ${badIdx}: ${p.vector[badIdx]}`);
    const vecStr = `[${p.vector.map(n => n.toFixed(8)).join(",")}]`;
    const metric = ["COSINE", "EUCLIDEAN", "DOT"].includes(p.distanceMetric)
      ? p.distanceMetric
      : "COSINE";
    const limit = Math.min(Math.max(1, p.limit), 100);

    const colRes = await conn.execute<{ COLUMN_NAME: string }>(
      `SELECT column_name FROM all_tab_columns
        WHERE owner = :owner AND table_name = :tbl
          AND data_type != 'VECTOR'
        ORDER BY column_id`,
      { owner: p.owner, tbl: p.tableName },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const dataCols = (colRes.rows ?? []).map((r) => r.COLUMN_NAME);
    const colList = dataCols.length > 0
      ? dataCols.map((c) => `t.${quoteIdent(c)}`).join(", ")
      : "t.ROWID";

    const qOwner = quoteIdent(p.owner);
    const qTable = quoteIdent(p.tableName);
    const qCol   = quoteIdent(p.columnName);

    // Optionally include the serialized vector for scatter/PCA
    // Use CLOB to avoid ORA-00910 (VARCHAR2 SQL limit is 4000 bytes; vectors exceed it)
    const vecExtra = p.withVectors
      ? `, FROM_VECTOR(t.${qCol} RETURNING CLOB) AS VEC_STR__`
      : "";

    const sql = `
      SELECT ${colList},
             VECTOR_DISTANCE(t.${qCol}, TO_VECTOR(:vecStr), ${metric}) AS VD_SCORE${vecExtra}
        FROM ${qOwner}.${qTable} t
       WHERE t.${qCol} IS NOT NULL
       ORDER BY VECTOR_DISTANCE(t.${qCol}, TO_VECTOR(:vecStr), ${metric})
       FETCH FIRST ${limit} ROWS ONLY`;

    const res = await conn.execute<unknown[]>(sql, { vecStr: { val: vecStr, type: oracledb.STRING, maxSize: Math.max(16000, vecStr.length + 100) } }, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      fetchTypeHandler: (meta: { name: string }) => {
        if (meta.name === "VEC_STR__") return { type: oracledb.STRING };
      },
    });

    const allCols = (res.metaData ?? []).map((m) => ({ name: m.name }));
    const vecStrIdx = allCols.findIndex(c => c.name === "VEC_STR__");
    const metaCols = allCols.filter(c => c.name !== "VEC_STR__");
    const allRows = (res.rows ?? []) as unknown[][];

    // Strip VEC_STR__ from data rows
    const rows = vecStrIdx >= 0
      ? allRows.map(r => (r as unknown[]).filter((_, i) => i !== vecStrIdx))
      : allRows;

    const scoreIdx = metaCols.findIndex((c) => c.name === "VD_SCORE");
    const scores = rows.map((r) => (scoreIdx >= 0 ? Number((r as unknown[])[scoreIdx]) : 0));

    let vectors: number[][] | undefined;
    if (p.withVectors && vecStrIdx >= 0) {
      vectors = allRows.map(r => {
        const s = String((r as unknown[])[vecStrIdx] ?? "");
        try { return JSON.parse(s) as number[]; } catch { return []; }
      });
    }

    return { columns: metaCols, rows, scores, vectors, queryVector: p.withVectors ? p.vector : undefined };
  });
}

// ── Vector metadata ───────────────────────────────────────────────────────────

export type VectorColumnRef = { tableName: string; columnName: string };

export async function vectorTablesInSchema(p: {
  owner: string;
}): Promise<{ columns: VectorColumnRef[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ TABLE_NAME: string; COLUMN_NAME: string }>(
      `SELECT table_name AS TABLE_NAME, column_name AS COLUMN_NAME
         FROM all_tab_columns
        WHERE owner = :owner AND data_type = 'VECTOR'
        ORDER BY table_name, column_name`,
      { owner: p.owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return {
      columns: (res.rows ?? []).map((r) => ({
        tableName: r.TABLE_NAME,
        columnName: r.COLUMN_NAME,
      })),
    };
  });
}

export type VectorIndex = {
  indexName: string;
  targetColumn: string;
  indexType: string;
  distanceMetric: string;
  accuracy: number | null;
  parameters: string | null;
};

export async function vectorIndexList(p: {
  owner: string;
  tableName: string;
}): Promise<{ indexes: VectorIndex[] }> {
  return withActiveSession(async (conn) => {
    try {
      const res = await conn.execute<{
        INDEX_NAME: string;
        TARGET_COLUMN: string;
        INDEX_TYPE: string;
        DISTANCE_METRIC: string;
        ACCURACY: number | null;
        PARAMETERS: string | null;
      }>(
        `SELECT index_name AS INDEX_NAME,
                target_column AS TARGET_COLUMN,
                index_type AS INDEX_TYPE,
                distance_metric AS DISTANCE_METRIC,
                accuracy AS ACCURACY,
                parameters AS PARAMETERS
           FROM all_vector_indexes
          WHERE owner = :owner AND target_table = :tableName
          ORDER BY index_name`,
        { owner: p.owner, tableName: p.tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return {
        indexes: (res.rows ?? []).map((r) => ({
          indexName: r.INDEX_NAME,
          targetColumn: r.TARGET_COLUMN,
          indexType: r.INDEX_TYPE,
          distanceMetric: r.DISTANCE_METRIC,
          accuracy: r.ACCURACY,
          parameters: r.PARAMETERS,
        })),
      };
    } catch {
      // ALL_VECTOR_INDEXES doesn't exist on Oracle < 23ai
      return { indexes: [] };
    }
  });
}

// ── Vector Index Management ───────────────────────────────────────────────────

export async function vectorCreateIndex(p: {
  owner: string;
  tableName: string;
  columnName: string;
  indexName: string;
  metric: "COSINE" | "EUCLIDEAN" | "DOT";
  accuracy: number;
  indexType: "hnsw" | "ivf";
}): Promise<{ created: true }> {
  return withActiveSession(async (conn) => {
    const qOwner = quoteIdent(p.owner);
    const qTable = quoteIdent(p.tableName);
    const qCol   = quoteIdent(p.columnName);
    const qIdx   = quoteIdent(p.indexName);
    const metric = ["COSINE", "EUCLIDEAN", "DOT"].includes(p.metric) ? p.metric : "COSINE";
    const accuracy = Math.min(100, Math.max(50, Math.round(p.accuracy)));
    const org = p.indexType === "ivf" ? "NEIGHBOR PARTITIONS" : "INMEMORY NEIGHBOR GRAPH";
    await conn.execute(
      `CREATE VECTOR INDEX ${qIdx} ON ${qOwner}.${qTable}(${qCol})
       ORGANIZATION ${org}
       DISTANCE ${metric}
       WITH TARGET ACCURACY ${accuracy}`
    );
    await conn.commit();
    return { created: true };
  });
}

export async function vectorDropIndex(p: {
  owner: string;
  indexName: string;
}): Promise<{ dropped: true }> {
  return withActiveSession(async (conn) => {
    const qOwner = quoteIdent(p.owner);
    const qIdx   = quoteIdent(p.indexName);
    await conn.execute(`DROP INDEX ${qIdx}`);
    await conn.commit();
    return { dropped: true };
  });
}

// ── Embedding generation ──────────────────────────────────────────────────────

export async function embedCountPending(p: {
  owner: string;
  tableName: string;
  vectorColumn: string;
}): Promise<{ total: number; pending: number }> {
  return withActiveSession(async (conn) => {
    const qOwner = quoteIdent(p.owner);
    const qTable = quoteIdent(p.tableName);
    const qVec   = quoteIdent(p.vectorColumn);
    const res = await conn.execute<[number, number]>(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN ${qVec} IS NULL THEN 1 END) AS pending
         FROM ${qOwner}.${qTable}`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    const row = res.rows?.[0] ?? [0, 0];
    return { total: Number(row[0]), pending: Number(row[1]) };
  });
}

export async function embedBatch(p: {
  owner: string;
  tableName: string;
  textColumn: string;
  vectorColumn: string;
  batchSize: number;
  embed: EmbedParams;
}): Promise<{ embedded: number; errors: number }> {
  return withActiveSession(async (conn) => {
    const qOwner = quoteIdent(p.owner);
    const qTable = quoteIdent(p.tableName);
    const qText  = quoteIdent(p.textColumn);
    const qVec   = quoteIdent(p.vectorColumn);
    const limit  = Math.min(Math.max(1, p.batchSize ?? 20), 200);

    const res = await conn.execute<[string, string]>(
      `SELECT ROWIDTOCHAR(ROWID) AS ROWID_CHAR, ${qText}
         FROM ${qOwner}.${qTable}
        WHERE ${qVec} IS NULL
        FETCH FIRST ${limit} ROWS ONLY`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );

    const rows = (res.rows ?? []) as [string, string][];
    let embedded = 0;
    let errors = 0;

    for (const [rowid, text] of rows) {
      try {
        const vector = await embedText({ ...p.embed, text: String(text ?? "") });
        const vecStr = `[${vector.map(n => n.toFixed(8)).join(",")}]`;
        await conn.execute(
          `UPDATE ${qOwner}.${qTable} SET ${qVec} = TO_VECTOR(:v) WHERE ROWID = CHARTOROWID(:rowid)`,
          { v: { val: vecStr, type: oracledb.STRING, maxSize: Math.max(16000, vecStr.length + 100) }, rowid }
        );
        embedded++;
      } catch (err) {
        log.error(`[embedBatch] row ${rowid} failed: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    if (embedded > 0) await conn.commit();
    return { embedded, errors };
  });
}

// ── Explain Plan ──────────────────────────────────────────────────────────────

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

export async function explainPlan(p: { sql: string }): Promise<{ nodes: ExplainNode[] }> {
  // Defense in depth: EXPLAIN PLAN concatenates p.sql into the dynamic statement.
  // Reject anything that splits into >1 statement to prevent appended DDL/DML side effects.
  const split = splitSql(p.sql);
  const stmts = split.statements.filter((s) => s.trim().length > 0);
  if (stmts.length === 0) {
    throw { code: -32602, message: "EXPLAIN PLAN: no statement" };
  }
  if (stmts.length > 1) {
    throw { code: -32602, message: "EXPLAIN PLAN: only single-statement queries allowed" };
  }
  // Reject DDL — EXPLAIN PLAN is only for queries and DML.
  const head = stmts[0]
    .replace(/^\s*\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--[^\n]*\n?/g, "")
    .trim()
    .slice(0, 32)
    .toUpperCase();
  if (/^(CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|RENAME|BEGIN|DECLARE)\b/.test(head)) {
    throw { code: -32602, message: "EXPLAIN PLAN: only SELECT/INSERT/UPDATE/DELETE/MERGE statements allowed" };
  }
  return withActiveSession(async (conn) => {
    const sid = `V${crypto.randomUUID().replace(/-/g, "").slice(0, 29)}`;
    // EXPLAIN PLAN requires STATEMENT_ID as a string literal — Oracle does not accept a bind variable here (ORA-01780).
    // sid is generated internally so direct interpolation is safe.
    await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${sid}' FOR ${stmts[0]}`);
    let res: oracledb.Result<{
      ID: number;
      PARENT_ID: number | null;
      OPERATION: string;
      OPTIONS: string | null;
      OBJECT_NAME: string | null;
      OBJECT_OWNER: string | null;
      COST: number | null;
      CARDINALITY: number | null;
      BYTES: number | null;
      ACCESS_PREDICATES: string | null;
      FILTER_PREDICATES: string | null;
    }>;
    try {
      res = await conn.execute<{
        ID: number;
        PARENT_ID: number | null;
        OPERATION: string;
        OPTIONS: string | null;
        OBJECT_NAME: string | null;
        OBJECT_OWNER: string | null;
        COST: number | null;
        CARDINALITY: number | null;
        BYTES: number | null;
        ACCESS_PREDICATES: string | null;
        FILTER_PREDICATES: string | null;
      }>(
        `SELECT id               AS ID,
                parent_id        AS PARENT_ID,
                operation        AS OPERATION,
                options          AS OPTIONS,
                object_name      AS OBJECT_NAME,
                object_owner     AS OBJECT_OWNER,
                cost             AS COST,
                cardinality      AS CARDINALITY,
                bytes            AS BYTES,
                access_predicates  AS ACCESS_PREDICATES,
                filter_predicates  AS FILTER_PREDICATES
           FROM plan_table
          WHERE statement_id = :sid
          START WITH id = 0
          CONNECT BY PRIOR id = parent_id
          ORDER SIBLINGS BY id`,
        { sid },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
    } finally {
      await conn.execute(`DELETE FROM plan_table WHERE statement_id = :sid`, { sid });
    }
    const nodes: ExplainNode[] = (res!.rows ?? []).map((r) => ({
      id: r.ID,
      parentId: r.PARENT_ID ?? null,
      operation: r.OPERATION,
      options: r.OPTIONS ?? null,
      objectName: r.OBJECT_NAME ?? null,
      objectOwner: r.OBJECT_OWNER ?? null,
      cost: r.COST ?? null,
      cardinality: r.CARDINALITY ?? null,
      bytes: r.BYTES ?? null,
      accessPredicates: r.ACCESS_PREDICATES ?? null,
      filterPredicates: r.FILTER_PREDICATES ?? null,
    }));
    return { nodes };
  });
}

// ── Procedure / Function Execution ────────────────────────────────────────────

export type ProcParam = {
  name: string;
  position: number;
  direction: "IN" | "OUT" | "IN/OUT";
  dataType: string;
};

async function _procDescribeConn(conn: oracledb.Connection, owner: string, name: string): Promise<ProcParam[]> {
  // ALL_ARGUMENTS without subprogram_id filtering merges overloaded overloads — standalone procedures only.
  const res = await conn.execute<{
    NAME: string;
    POSITION: number;
    DIRECTION: string;
    DATA_TYPE: string;
  }>(
    `SELECT argument_name AS NAME,
            position      AS POSITION,
            in_out        AS DIRECTION,
            data_type     AS DATA_TYPE
       FROM all_arguments
      WHERE owner       = :owner
        AND object_name = :name
        AND data_level  = 0
      ORDER BY position`,
    { owner: owner.toUpperCase(), name: name.toUpperCase() },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return (res.rows ?? []).map((r) => ({
    name: r.NAME ?? "RETURN",
    position: r.POSITION,
    direction: (r.DIRECTION as ProcParam["direction"]) ?? "IN",
    dataType: r.DATA_TYPE ?? "VARCHAR2",
  }));
}

export async function procDescribe(p: {
  owner: string;
  name: string;
}): Promise<{ params: ProcParam[] }> {
  return withActiveSession(async (conn) => {
    return { params: await _procDescribeConn(conn, p.owner, p.name) };
  });
}

export type ProcExecuteResult = {
  outParams: { name: string; value: string }[];
  refCursors: { name: string; columns: QueryColumn[]; rows: QueryResultRow[] }[];
  dbmsOutput: string[];
};

export function oracleTypeFor(dataType: string): number {
  const t = dataType.toUpperCase();
  if (t.includes("NUMBER") || t.includes("INTEGER") || t.includes("FLOAT")) return oracledb.NUMBER;
  if (t.includes("DATE") || t.includes("TIMESTAMP")) return oracledb.DATE;
  return oracledb.STRING;
}

export function convertInputValue(v: string, dataType: string): unknown {
  if (!v || v.toUpperCase() === "NULL") return null;
  const t = dataType.toUpperCase();
  if (t.includes("NUMBER") || t.includes("INTEGER") || t.includes("FLOAT")) return Number(v);
  if (t.includes("DATE") || t.includes("TIMESTAMP")) return new Date(v);
  return v;
}

export async function procExecute(p: {
  owner: string;
  name: string;
  params: { name: string; value: string }[];
}): Promise<ProcExecuteResult> {
  return withActiveSession(async (conn) => {
    const paramMeta = await _procDescribeConn(conn, p.owner, p.name);

    const binds: Record<string, oracledb.BindDefinition> = {};
    const callArgs: string[] = [];

    // Defense in depth: pm.name comes from ALL_ARGUMENTS but a malicious DBA could in theory
    // store an identifier with dollar/hash combinations that, while legal Oracle, would behave
    // oddly when concatenated below. Reject anything outside a strict Oracle identifier shape.
    const ORACLE_IDENT_RE = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;

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

    const callExpr = `${quoteIdent(p.owner)}.${quoteIdent(p.name)}(${callArgs.join(", ")})`;
    const block = `BEGIN ${callExpr}; END;`;

    await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);
    const result = await conn.execute(block, binds, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });
    const ob = (result.outBinds ?? {}) as Record<string, unknown>;

    const outParams: { name: string; value: string }[] = [];
    const refCursors: { name: string; columns: QueryColumn[]; rows: QueryResultRow[] }[] = [];

    for (const pm of paramMeta) {
      const isRefCursor = pm.dataType === "REF CURSOR";
      if (pm.direction === "OUT" && !isRefCursor) {
        const val = ob[`o_${pm.name}`];
        outParams.push({
          name: pm.name,
          value: val === null || val === undefined ? "NULL" : String(val),
        });
      } else if (pm.direction === "IN/OUT") {
        const val = ob[`io_${pm.name}`];
        outParams.push({
          name: pm.name,
          value: val === null || val === undefined ? "NULL" : String(val),
        });
      } else if (pm.direction === "OUT" && isRefCursor) {
        const rs = ob[`o_${pm.name}`] as oracledb.ResultSet<unknown[]> | null;
        if (rs) {
          const meta = (rs.metaData ?? []) as Array<{ name: string; fetchType?: number }>;
          const columns: QueryColumn[] = meta.map((m) => ({
            name: m.name,
            dataType: formatColumnType(m as any),
          }));
          const rows: unknown[][] = [];
          let row: unknown[] | undefined;
          let rowCount = 0;
          while ((row = (await rs.getRow()) as unknown[] | undefined) && rowCount < 1000) {
            rows.push(row.map(normalizeCell));
            rowCount++;
          }
          await rs.close();
          refCursors.push({ name: pm.name, columns, rows });
        } else {
          refCursors.push({ name: pm.name, columns: [], rows: [] });
        }
      }
    }

    const dbmsOutput = (await drainDbmsOutput(conn)) ?? [];
    return { outParams, refCursors, dbmsOutput };
  });
}
