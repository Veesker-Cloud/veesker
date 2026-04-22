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

import { OBJECT_NOT_FOUND, QUERY_CANCELLED } from "./errors";

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

export async function queryExecute(p: { sql: string; requestId?: string }): Promise<QueryResult> {
  // Assign or generate a requestId so cancellation can be matched.
  const requestId = p.requestId ?? crypto.randomUUID();
  _running = { requestId, cancelled: false };
  try {
    return await withActiveSession(async (conn) => {
      const started = Date.now();
      let r: any;
      try {
        r = await conn.execute(p.sql, [], {
          maxRows: 100,
          outFormat: oracledb.OUT_FORMAT_ARRAY,
        });
      } catch (execErr) {
        // If we were cancelled and this looks like a break error, raise code -2.
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
    });
  } finally {
    // Clear only if this request is still current (avoid clobbering a newer query).
    if (_running?.requestId === requestId) {
      _running = null;
    }
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
