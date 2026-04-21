import { describe, expect, test } from "bun:test";
import { parseRequest, makeError, makeResult } from "../src/rpc";

describe("parseRequest", () => {
  test("parses a valid request", () => {
    const req = parseRequest('{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}');
    expect(req).toEqual({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
  });

  test("returns null for invalid JSON", () => {
    expect(parseRequest("not json")).toBeNull();
  });

  test("returns null when jsonrpc field missing or wrong", () => {
    expect(parseRequest('{"id":1,"method":"x"}')).toBeNull();
    expect(parseRequest('{"jsonrpc":"1.0","id":1,"method":"x"}')).toBeNull();
  });

  test("returns null when method missing", () => {
    expect(parseRequest('{"jsonrpc":"2.0","id":1}')).toBeNull();
  });
});

describe("makeResult", () => {
  test("builds a result envelope", () => {
    expect(makeResult(7, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });
});

describe("makeError", () => {
  test("builds an error envelope", () => {
    expect(makeError(7, -32601, "Method not found")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Method not found" },
    });
  });

  test("includes data when provided", () => {
    expect(makeError(7, -32000, "boom", { detail: "x" })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32000, message: "boom", data: { detail: "x" } },
    });
  });

  test("allows null id for parse errors per JSON-RPC §5.1", () => {
    expect(makeError(null, -32700, "Parse error")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});
