import { describe, expect, test, beforeEach, mock, afterEach } from "bun:test";
import { setSession, clearSession } from "../src/state";
import { queryExecute, _resetRunning } from "../src/oracle";
import { SPLITTER_ERROR, QUERY_CANCELLED, RpcCodedError } from "../src/errors";

function fakeConn(executeImpl: (...a: any[]) => any) {
  return { execute: mock(executeImpl), break: mock(async () => {}) } as any;
}

function makeSelectResult(rows: any[][] = [[1]], name = "X") {
  return {
    metaData: [{ name, dbTypeName: "NUMBER", precision: 10, scale: 0 }],
    rows,
  };
}

function makeDmlResult(rowsAffected = 1) {
  return { metaData: undefined, rows: undefined, rowsAffected };
}

beforeEach(() => {
  clearSession();
  _resetRunning();
});

afterEach(() => {
  clearSession();
  _resetRunning();
});

describe("queryExecute multi-statement (splitMulti: true)", () => {
  test("comments-only input returns multi: true with empty results", async () => {
    const conn = fakeConn(async () => makeSelectResult());
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "-- just a comment\n/* another */", splitMulti: true });
    expect(r).toEqual({ multi: true, results: [] });
    expect(conn.execute).not.toHaveBeenCalled();
  });

  test("3 statements all succeed returns 3 ok results", async () => {
    let callIdx = 0;
    const conn = fakeConn(async () => {
      callIdx++;
      return makeSelectResult([[callIdx]], `COL${callIdx}`);
    });
    setSession(conn, "SCOTT");
    const sql = "SELECT 1 FROM dual;\nSELECT 2 FROM dual;\nSELECT 3 FROM dual;";
    const r = await queryExecute({ sql, splitMulti: true });
    expect(r).toMatchObject({ multi: true });
    const mr = r as any;
    expect(mr.results).toHaveLength(3);
    expect(mr.results[0].status).toBe("ok");
    expect(mr.results[0].statementIndex).toBe(0);
    expect(mr.results[1].status).toBe("ok");
    expect(mr.results[1].statementIndex).toBe(1);
    expect(mr.results[2].status).toBe("ok");
    expect(mr.results[2].statementIndex).toBe(2);
  });

  test("second statement errors stops iteration with error entry, third not run", async () => {
    let stmtCallIdx = 0;
    const conn = fakeConn(async (sql: string) => {
      // Ignore DBMS_OUTPUT infrastructure calls — only count real statement executes.
      if (typeof sql === "string" && sql.toUpperCase().includes("DBMS_OUTPUT")) {
        return { outBinds: { LINE: null, STATUS: 1 } };
      }
      stmtCallIdx++;
      if (typeof sql === "string" && sql.toLowerCase().includes("nope")) {
        throw new Error("ORA-00942: table or view does not exist");
      }
      return makeSelectResult([[stmtCallIdx]]);
    });
    setSession(conn, "SCOTT");
    const sql = "SELECT 1 FROM dual;\nSELECT * FROM nope;\nSELECT 3 FROM dual;";
    const r = await queryExecute({ sql, splitMulti: true });
    const mr = r as any;
    expect(mr.multi).toBe(true);
    expect(mr.results).toHaveLength(2);
    expect(mr.results[0].status).toBe("ok");
    expect(mr.results[1].status).toBe("error");
    expect(mr.results[1].error.message).toContain("ORA-00942");
    // Third statement should NOT have been executed
    expect(stmtCallIdx).toBe(2);
  });

  test("splitter error (unterminated string) throws SPLITTER_ERROR code -32014", async () => {
    const conn = fakeConn(async () => makeSelectResult());
    setSession(conn, "SCOTT");
    const sql = "SELECT 'unterminated FROM dual;";
    try {
      await queryExecute({ sql, splitMulti: true });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcCodedError);
      expect(e.code).toBe(SPLITTER_ERROR);
      expect(e.message).toContain("Splitter error");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  test("splitMulti: false (default) preserves single-statement behavior", async () => {
    const conn = fakeConn(async () => makeSelectResult([[42]]));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT 42 FROM dual", splitMulti: false });
    // Should return a single QueryResult (no `multi` property)
    expect((r as any).multi).toBeUndefined();
    expect((r as any).columns).toBeDefined();
    expect((r as any).rowCount).toBe(1);
  });

  test("default (no splitMulti param) preserves single-statement behavior", async () => {
    const conn = fakeConn(async () => makeSelectResult([[99]]));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT 99 FROM dual" });
    expect((r as any).multi).toBeUndefined();
    expect((r as any).rowCount).toBe(1);
  });

  test("cancel between statements produces cancelled entry and stops", async () => {
    // We simulate cancel by marking _running.cancelled inside the first real statement
    // execute, so that the inter-statement check fires before the second statement runs.
    // DBMS_OUTPUT infrastructure calls are ignored so they don't interfere with the counter.
    const { _getRunning } = await import("../src/oracle");

    let stmtCallIdx = 0;
    let capturedRequestId: string | null = null;

    const conn = fakeConn(async (sql: string) => {
      // Skip DBMS_OUTPUT calls — return a drain-stop response.
      if (typeof sql === "string" && sql.toUpperCase().includes("DBMS_OUTPUT")) {
        return { outBinds: { LINE: null, STATUS: 1 } };
      }
      stmtCallIdx++;
      if (stmtCallIdx === 1) {
        // Capture requestId and mark cancelled before returning, simulating
        // a cancel that arrives between statements
        const running = _getRunning();
        capturedRequestId = running?.requestId ?? null;
        if (running) running.cancelled = true;
        return makeSelectResult([[1]]);
      }
      // Should never reach here since cancel is checked between iterations
      return makeSelectResult([[2]]);
    });
    setSession(conn, "SCOTT");

    const sql = "SELECT 1 FROM dual;\nSELECT 2 FROM dual;";
    const r = await queryExecute({ sql, splitMulti: true });
    const mr = r as any;
    expect(mr.multi).toBe(true);
    // First result is ok (ran before cancel was detected)
    expect(mr.results[0].status).toBe("ok");
    // Second result should be cancelled (detected between iterations)
    expect(mr.results[1].status).toBe("cancelled");
    expect(mr.results[1].statementIndex).toBe(1);
    // Total: 2 results
    expect(mr.results).toHaveLength(2);
    // only the first real statement was executed (second was skipped due to cancel)
    expect(stmtCallIdx).toBe(1);
  });
});
