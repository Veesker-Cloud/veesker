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
