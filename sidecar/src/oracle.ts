import oracledb from "oracledb";

export type ConnectionTestParams = {
  host: string;
  port: number;
  serviceName: string;
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
  const connectString = `${params.host}:${params.port}/${params.serviceName}`;
  const started = Date.now();
  const conn = await oracledb.getConnection({
    user: params.username,
    password: params.password,
    connectString,
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
