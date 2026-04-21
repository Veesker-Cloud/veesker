import { describe, expect, test, beforeEach } from "bun:test";
import { setSession, clearSession, getActiveSession, hasSession, getCurrentSchema } from "../src/state";
import { NO_ACTIVE_SESSION, RpcCodedError } from "../src/errors";

describe("state", () => {
  beforeEach(() => clearSession());

  test("getActiveSession throws RpcCodedError(NO_ACTIVE_SESSION) when empty", () => {
    expect(() => getActiveSession()).toThrow(RpcCodedError);
    try {
      getActiveSession();
    } catch (e: any) {
      expect(e.code).toBe(NO_ACTIVE_SESSION);
    }
  });

  test("setSession stores conn + schema; getCurrentSchema returns it; hasSession reports true", () => {
    const fakeConn = { fake: true } as any;
    setSession(fakeConn, "PDBADMIN");
    expect(hasSession()).toBe(true);
    expect(getCurrentSchema()).toBe("PDBADMIN");
    expect(getActiveSession()).toBe(fakeConn);
  });

  test("clearSession resets state", () => {
    setSession({} as any, "X");
    clearSession();
    expect(hasSession()).toBe(false);
    expect(getCurrentSchema()).toBeNull();
  });
});
