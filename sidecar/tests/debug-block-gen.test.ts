import { describe, expect, test } from "bun:test";
import { generateTestBlock, type ParamDef } from "../src/debug";

describe("generateTestBlock", () => {
  test("generates a simple IN-only call", () => {
    const params: ParamDef[] = [
      { name: "P_ID", dataType: "NUMBER", inOut: "IN", position: 1 },
      { name: "P_NAME", dataType: "VARCHAR2", inOut: "IN", position: 2 },
    ];
    const block = generateTestBlock("MYSCHEMA", "MY_PROC", null, params);
    expect(block).toContain("BEGIN");
    expect(block).toContain("MYSCHEMA.MY_PROC(");
    expect(block).toContain("p_id => :p_id");
    expect(block).toContain("p_name => :p_name");
    expect(block).toContain("END;");
  });

  test("declares local variable for OUT param and assigns bind after call", () => {
    const params: ParamDef[] = [
      { name: "P_IN", dataType: "NUMBER", inOut: "IN", position: 1 },
      { name: "P_OUT", dataType: "VARCHAR2", inOut: "OUT", position: 2 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_out");
    expect(block).toContain(":out_p_out := v_p_out");
    expect(block).toContain("p_out => v_p_out");
  });

  test("includes package name when provided", () => {
    const params: ParamDef[] = [
      { name: "P_ID", dataType: "NUMBER", inOut: "IN", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC_NAME", "PKG_NAME", params);
    expect(block).toContain("SC.PKG_NAME.PROC_NAME(");
  });

  test("generates BOOLEAN param via local variable with CASE", () => {
    const params: ParamDef[] = [
      { name: "P_FLAG", dataType: "BOOLEAN", inOut: "IN", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_flag BOOLEAN");
    expect(block).toContain("CASE UPPER(:p_flag)");
    expect(block).toContain("p_flag => v_p_flag");
  });

  test("generates IN OUT param via local variable", () => {
    const params: ParamDef[] = [
      { name: "P_VAL", dataType: "NUMBER", inOut: "IN/OUT", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_val NUMBER := :p_val");
    expect(block).toContain(":p_val");
    expect(block).toContain("p_val => v_p_val");
  });

  test("no params produces a simple BEGIN/END block", () => {
    const block = generateTestBlock("SC", "PROC", null, []);
    expect(block).toMatch(/BEGIN\s+SC\.PROC\(\);\s+END;/s);
  });
});
