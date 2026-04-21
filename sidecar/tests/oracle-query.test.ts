import { describe, expect, test, beforeEach, mock } from "bun:test";
import { setSession, clearSession } from "../src/state";
import { queryExecute } from "../src/oracle";
import { NO_ACTIVE_SESSION, ORACLE_ERR, RpcCodedError } from "../src/errors";

function fakeConn(executeImpl: (...a: any[]) => any) {
  return { execute: mock(executeImpl) } as any;
}

describe("queryExecute", () => {
  beforeEach(() => clearSession());

  test("throws NO_ACTIVE_SESSION when no session is set", async () => {
    await expect(queryExecute({ sql: "SELECT 1 FROM DUAL" })).rejects.toThrow(RpcCodedError);
    try { await queryExecute({ sql: "SELECT 1 FROM DUAL" }); }
    catch (e: any) { expect(e.code).toBe(NO_ACTIVE_SESSION); }
  });

  test("returns columns + rows for SELECT", async () => {
    const conn = fakeConn(async () => ({
      metaData: [
        { name: "ID", dbTypeName: "NUMBER", precision: 10, scale: 0 },
        { name: "NAME", dbTypeName: "VARCHAR2", byteSize: 50 },
      ],
      rows: [[1, "Alice"], [2, "Bob"]],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT id, name FROM users" });
    expect(r.columns).toEqual([
      { name: "ID", dataType: "NUMBER(10)" },
      { name: "NAME", dataType: "VARCHAR2(50)" },
    ]);
    expect(r.rows).toEqual([[1, "Alice"], [2, "Bob"]]);
    expect(r.rowCount).toBe(2);
    expect(typeof r.elapsedMs).toBe("number");
  });

  test("maps DDL/DML response to rowsAffected", async () => {
    const conn = fakeConn(async () => ({
      metaData: undefined,
      rows: undefined,
      rowsAffected: 3,
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "UPDATE users SET name='X'" });
    expect(r.columns).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.rowCount).toBe(3);
  });

  test("maps DDL response with no rowsAffected to 0", async () => {
    const conn = fakeConn(async () => ({
      metaData: undefined,
      rows: undefined,
      rowsAffected: undefined,
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "CREATE TABLE t (id NUMBER)" });
    expect(r.rowCount).toBe(0);
  });

  test("passes maxRows: 100 and OUT_FORMAT_ARRAY to driver", async () => {
    const exec = mock(async () => ({ metaData: [], rows: [] }));
    setSession({ execute: exec } as any, "SCOTT");
    await queryExecute({ sql: "SELECT * FROM t" });
    const opts = exec.mock.calls[0][2];
    expect(opts.maxRows).toBe(100);
    expect(typeof opts.outFormat).toBe("number");
  });

  test("normalizes Float32Array cells (VECTOR) to plain arrays", async () => {
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    const conn = fakeConn(async () => ({
      metaData: [{ name: "EMB", dbTypeName: "VECTOR" }],
      rows: [[vec]],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT emb FROM v" });
    expect(Array.isArray(r.rows[0][0])).toBe(true);
    expect((r.rows[0][0] as number[]).length).toBe(3);
    expect((r.rows[0][0] as number[])[0]).toBeCloseTo(0.1, 5);
  });

  test("throws ORACLE_ERR when driver rejects with ORA-message", async () => {
    const conn = fakeConn(async () => { throw new Error("ORA-00942: table or view does not exist"); });
    setSession(conn, "SCOTT");
    try {
      await queryExecute({ sql: "SELECT * FROM nope" });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcCodedError);
      expect(e.code).toBe(ORACLE_ERR);
      expect(e.message).toContain("ORA-00942");
    }
  });

  test("formats NUMBER(p,s), TIMESTAMP(s), VARCHAR2(byteSize), CLOB", async () => {
    const conn = fakeConn(async () => ({
      metaData: [
        { name: "PRICE", dbTypeName: "NUMBER", precision: 10, scale: 2 },
        { name: "TS", dbTypeName: "TIMESTAMP", scale: 6 },
        { name: "TXT", dbTypeName: "VARCHAR2", byteSize: 100 },
        { name: "DOC", dbTypeName: "CLOB" },
      ],
      rows: [],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT * FROM t" });
    expect(r.columns).toEqual([
      { name: "PRICE", dataType: "NUMBER(10,2)" },
      { name: "TS", dataType: "TIMESTAMP(6)" },
      { name: "TXT", dataType: "VARCHAR2(100)" },
      { name: "DOC", dataType: "CLOB" },
    ]);
  });
});
