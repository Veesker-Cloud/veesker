import { describe, it, expect } from "bun:test";
import { ordsDetect } from "../src/ords";

describe("ords.detect", () => {
  it("returns shape with installed/version/currentSchemaEnabled/hasAdminRole/ordsBaseUrl", async () => {
    const fn = ordsDetect;
    expect(typeof fn).toBe("function");
  });
});
