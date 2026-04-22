import { describe, expect, test, beforeEach, mock } from "bun:test";
import { setSession, clearSession } from "../src/state";
import { queryExecute, queryCancel, _resetRunning, _getRunning } from "../src/oracle";
import { QUERY_CANCELLED, RpcCodedError } from "../src/errors";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeConn(executeImpl: (...a: any[]) => any, breakImpl?: () => Promise<void>) {
  return {
    execute: mock(executeImpl),
    break: mock(breakImpl ?? (async () => {})),
  } as any;
}

/** Returns a deferred promise whose reject side can be triggered externally. */
function makeDeferred() {
  let reject!: (err: unknown) => void;
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearSession();
  _resetRunning();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("queryCancel — no running query", () => {
  test("returns { cancelled: false } when nothing is running", async () => {
    // No session needed; _running is null.
    const result = await queryCancel({ requestId: "some-id" });
    expect(result).toEqual({ cancelled: false });
  });
});

describe("queryCancel — mismatched requestId", () => {
  test("returns { cancelled: false } when requestId does not match running query", async () => {
    // Simulate a running query with a different ID by manipulating _running via
    // starting an execute and checking before it finishes — but here we just need to
    // verify the mismatch logic. We do this by starting a long-running query in the
    // background with a known requestId, then cancelling with a different ID.
    const deferred = makeDeferred();
    const conn = fakeConn(
      () => deferred.promise,
      async () => {}
    );
    setSession(conn, "SCOTT");

    const executePromise = queryExecute({ sql: "SELECT 1 FROM DUAL", requestId: "req-aaa" });

    // Cancel with wrong ID — should not match.
    const result = await queryCancel({ requestId: "req-bbb" });
    expect(result).toEqual({ cancelled: false });

    // Clean up: resolve the deferred so executePromise settles.
    deferred.resolve({ metaData: [], rows: [], rowsAffected: 0 });
    await executePromise;
  });
});

describe("queryCancel — matching requestId", () => {
  test("returns { cancelled: true, requestId } when requestId matches running query", async () => {
    const deferred = makeDeferred();
    const conn = fakeConn(
      () => deferred.promise,
      async () => {}
    );
    setSession(conn, "SCOTT");

    const executePromise = queryExecute({ sql: "SELECT 1 FROM DUAL", requestId: "req-match" });

    // Cancel with matching ID.
    const result = await queryCancel({ requestId: "req-match" });
    expect(result).toEqual({ cancelled: true, requestId: "req-match" });

    // Resolve the query so it settles normally (break was called but deferred resolves).
    deferred.resolve({ metaData: [], rows: [], rowsAffected: 0 });
    await executePromise;
  });
});

describe("queryCancel — break causes code -2", () => {
  test("when execute is in-flight and break() rejects it, queryExecute throws code -2", async () => {
    const deferred = makeDeferred();
    const conn = fakeConn(
      () => deferred.promise,
      async () => {}
    );
    setSession(conn, "SCOTT");

    const executePromise = queryExecute({ sql: "SELECT 1 FROM DUAL", requestId: "req-cancel" });

    // Cancel — marks cancelled = true and calls break().
    await queryCancel({ requestId: "req-cancel" });

    // Now simulate driver rejecting with ORA-01013 (what break() would cause).
    deferred.reject(new Error("ORA-01013: user requested cancel of current operation"));

    try {
      await executePromise;
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcCodedError);
      expect(e.code).toBe(QUERY_CANCELLED);
      expect(e.message).toBe("Cancelled by user");
    }
  });
});

describe("queryCancel — cancel after completion", () => {
  test("returns { cancelled: false } when query already completed and _running was cleared", async () => {
    const conn = fakeConn(async () => ({
      metaData: [],
      rows: [],
      rowsAffected: 0,
    }));
    setSession(conn, "SCOTT");

    // Run a query to completion — this sets then clears _running.
    await queryExecute({ sql: "SELECT 1 FROM DUAL", requestId: "req-done" });

    // _running should be null now; cancel should return false.
    const result = await queryCancel({ requestId: "req-done" });
    expect(result).toEqual({ cancelled: false });
  });
});

describe("queryExecute — backward compat (no requestId)", () => {
  test("works without a requestId (generates one internally)", async () => {
    const conn = fakeConn(async () => ({
      metaData: [{ name: "X", dbTypeName: "NUMBER", precision: 5, scale: 0 }],
      rows: [[1]],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT 1 FROM DUAL" });
    expect(r.rowCount).toBe(1);
    // _running should be cleared after completion.
    expect(_getRunning()).toBeNull();
  });
});
