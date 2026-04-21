import { describe, expect, test } from "bun:test";
import { dispatch } from "../src/handlers";

describe("dispatch", () => {
  test("calls registered handler and returns its result", async () => {
    const handlers = {
      "math.add": async (params: any) => params.a + params.b,
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 1,
      method: "math.add",
      params: { a: 2, b: 3 },
    });
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, result: 5 });
  });

  test("returns method-not-found error", async () => {
    const res = await dispatch({}, {
      jsonrpc: "2.0",
      id: 2,
      method: "nope",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found: nope" },
    });
  });

  test("catches handler throws and wraps as internal error", async () => {
    const handlers = {
      boom: async () => {
        throw new Error("kaboom");
      },
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 3,
      method: "boom",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "kaboom" },
    });
  });

  test("uses err.code when handler throws an error with a numeric code", async () => {
    const handlers = {
      coded: async () => {
        const e: any = new Error("custom failure");
        e.code = -32010;
        throw e;
      },
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 4,
      method: "coded",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32010, message: "custom failure" },
    });
  });
});
