// Integration test — requires the local Oracle 23ai container started:
//   docker run -d --name oracle23ai -p 1521:1521 -e ORACLE_PASSWORD=Veesker23ai_test gvenzl/oracle-free:23-slim
//
// Skipped automatically if connection fails (so CI without Oracle is OK).

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import oracledb from "oracledb";

const cfg = {
  authType: "basic" as const,
  host: process.env.VEESKER_TEST_HOST ?? "localhost",
  port: Number(process.env.VEESKER_TEST_PORT ?? 1521),
  serviceName: process.env.VEESKER_TEST_SERVICE ?? "FREEPDB1",
  username: process.env.VEESKER_TEST_USER ?? "system",
  password: process.env.VEESKER_TEST_PASS ?? "Veesker23ai_test",
};

const rawCfg = {
  user: cfg.username,
  password: cfg.password,
  connectString: `${cfg.host}:${cfg.port}/${cfg.serviceName}`,
};

let oracleAvailable = false;

async function tryConnect(): Promise<oracledb.Connection | null> {
  try {
    return await oracledb.getConnection({ ...rawCfg, connectTimeout: 5 });
  } catch {
    return null;
  }
}

beforeAll(async () => {
  const c = await tryConnect();
  if (!c) {
    console.warn("[flow.integration] Oracle not reachable — tests will be skipped");
    return;
  }
  oracleAvailable = true;
  for (const stmt of [
    `BEGIN EXECUTE IMMEDIATE 'DROP PROCEDURE veesker_flow_test_proc'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE veesker_flow_test_records PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `CREATE TABLE veesker_flow_test_records (id NUMBER PRIMARY KEY, status VARCHAR2(20))`,
    `INSERT INTO veesker_flow_test_records VALUES (1, 'pending')`,
    `COMMIT`,
    `CREATE OR REPLACE PROCEDURE veesker_flow_test_proc(p_id IN NUMBER) AS
       v_status VARCHAR2(20);
     BEGIN
       SELECT status INTO v_status FROM veesker_flow_test_records WHERE id = p_id;
       IF v_status = 'pending' THEN
         UPDATE veesker_flow_test_records SET status = 'done' WHERE id = p_id;
       END IF;
     END;`,
    `ALTER PROCEDURE veesker_flow_test_proc COMPILE DEBUG`,
  ]) {
    await c.execute(stmt);
  }
  await c.commit();
  await c.close();
});

afterAll(async () => {
  if (!oracleAvailable) return;
  const c = await tryConnect();
  if (!c) return;
  for (const stmt of [
    `BEGIN EXECUTE IMMEDIATE 'DROP PROCEDURE veesker_flow_test_proc'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE veesker_flow_test_records PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `COMMIT`,
  ]) {
    await c.execute(stmt);
  }
  await c.close();
});

describe("flow integration — explainPlanFlow static", () => {
  it("returns events for a simple SELECT", async () => {
    if (!oracleAvailable) return;
    const { openSession, closeSession } = await import("../src/oracle");
    const { explainPlanFlow } = await import("../src/flow");
    await openSession(cfg);
    try {
      const result = await explainPlanFlow({ sql: "SELECT id, status FROM veesker_flow_test_records", withRuntimeStats: false });
      expect(result.kind).toBe("sql");
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      const last = result.events[result.events.length - 1];
      if (last.kind !== "explain.node") throw new Error("expected explain.node");
      expect(last.operation).toMatch(/SELECT STATEMENT/);
    } finally {
      await closeSession();
    }
  });
});
