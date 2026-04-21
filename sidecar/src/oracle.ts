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
