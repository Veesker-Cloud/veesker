import oracledb from "oracledb";

export type ConnectionTestParams =
  | {
      authType: "basic";
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
    }
  | {
      authType: "wallet";
      walletDir: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
    };

export type ConnectionTestResult = {
  ok: true;
  serverVersion: string;
  elapsedMs: number;
};

export async function connectionTest(
  params: ConnectionTestParams
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const conn =
    params.authType === "basic"
      ? await oracledb.getConnection({
          user: params.username,
          password: params.password,
          connectString: `${params.host}:${params.port}/${params.serviceName}`,
        })
      : await oracledb.getConnection({
          user: params.username,
          password: params.password,
          connectString: params.connectAlias,
          configDir: params.walletDir,
          walletLocation: params.walletDir,
          walletPassword: params.walletPassword,
        });
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

import { setSession, clearSession, hasSession, getActiveSession } from "./state";
import { RpcCodedError, SESSION_LOST, ORACLE_ERR } from "./errors";

export type OpenSessionParams = ConnectionTestParams;
export type OpenSessionResult = { serverVersion: string; currentSchema: string };

function isLostSessionError(err: unknown): boolean {
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

async function buildConnection(p: OpenSessionParams): Promise<oracledb.Connection> {
  if (p.authType === "basic") {
    return await oracledb.getConnection({
      user: p.username,
      password: p.password,
      connectString: `${p.host}:${p.port}/${p.serviceName}`,
    });
  }
  return await oracledb.getConnection({
    user: p.username,
    password: p.password,
    connectString: p.connectAlias,
    configDir: p.walletDir,
    walletLocation: p.walletDir,
    walletPassword: p.walletPassword,
  });
}

export async function openSession(p: OpenSessionParams): Promise<OpenSessionResult> {
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
    return { serverVersion, currentSchema };
  } catch (err) {
    // Failed during the version/schema bootstrap — clean up the half-open session.
    try { await conn.close(); } catch {}
    throw err;
  }
}

export async function closeSession(): Promise<{ closed: true }> {
  if (hasSession()) {
    try {
      await getActiveSession().close();
    } catch {
      // Best-effort.
    }
    clearSession();
  }
  return { closed: true };
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
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: ColumnDef[];
  indexes: IndexDef[];
  rowCount: number | null;
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

    const cntRes = await conn.execute<{ NUM_ROWS: number | null }>(
      `SELECT num_rows AS NUM_ROWS FROM all_tables WHERE owner = :owner AND table_name = :name`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rowCount = cntRes.rows?.[0]?.NUM_ROWS ?? null;

    return { columns, indexes, rowCount };
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
  try {
    const lines: string[] = [];
    let iterations = 0;
    const MAX_LINES = 10_000;
    while (iterations < MAX_LINES) {
      iterations++;
      const r = await conn.execute<{ LINE: string; STATUS: number }>(
        `BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;`,
        {
          line:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
          status: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }
      );
      const ob = r.outBinds as { LINE: string | null; STATUS: number };
      if (ob.STATUS !== 0) break;
      lines.push(ob.LINE ?? "");
    }
    return lines;
  } catch {
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
const PLSQL_EXEC_RE =
  /^\s*(?:BEGIN|DECLARE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|PACKAGE(?:\s+BODY)?|TYPE(?:\s+BODY)?))\b/i;
const PLSQL_ANON_RE = /^\s*(?:BEGIN|DECLARE)\b/i;

/** Run a single statement against the active session; returns QueryResult. */
async function executeSingleStatement(
  conn: oracledb.Connection,
  sql: string,
  requestId: string
): Promise<QueryResult> {
  const started = Date.now();
  let r: any;
  const isPlsql = PLSQL_EXEC_RE.test(sql);
  // oracledb thin mode strips the trailing `;` from anonymous PL/SQL blocks when
  // any options object is passed (including `{}`), causing ORA-06550.
  // Oracle SQL APIs accept BEGIN...END without the trailing semicolon, so strip it.
  const sqlToSend = PLSQL_ANON_RE.test(sql) ? sql.replace(/;\s*$/, "") : sql;
  try {
    r = await conn.execute(
      sqlToSend,
      [],
      isPlsql ? {} : { maxRows: 100, outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
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

export async function queryExecute(p: { sql: string; requestId?: string; splitMulti?: boolean }): Promise<QueryResult | MultiQueryResult> {
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

      const collected: ServerStatementResult[] = [];

      try {
        await getActiveSession().execute(`BEGIN DBMS_OUTPUT.ENABLE(1000000); END;`);
      } catch {
        // Non-fatal
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
    return await withActiveSession(async (conn) => {
      return executeSingleStatement(conn, p.sql, requestId);
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
    await (conn as any).break();
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
}): Promise<{ ddl: string }> {
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

    // For PACKAGE, also fetch the body (may not exist — ORA-31603 is non-fatal)
    if (p.objectType.toUpperCase() === "PACKAGE") {
      try {
        const bodyRes = await conn.execute<[string]>(
          `SELECT DBMS_METADATA.GET_DDL('PACKAGE BODY', UPPER(:name), UPPER(:owner)) FROM dual`,
          { name: p.objectName, owner: p.owner },
          fetchOpts
        );
        const bodyDdl: string = (bodyRes.rows?.[0]?.[0] as string) ?? "";
        if (bodyDdl.trim()) {
          return { ddl: specDdl.trimEnd() + "\n\n" + bodyDdl };
        }
      } catch {
        // No body exists — return spec only
      }
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
