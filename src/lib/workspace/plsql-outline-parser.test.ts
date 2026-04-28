import { describe, it, expect } from "vitest";
import { extractSubprograms, extractSections } from "./plsql-outline-parser";

describe("extractSubprograms", () => {
  it("finds FUNCTION and PROCEDURE in package body", () => {
    const ddl = `CREATE OR REPLACE PACKAGE BODY pkg AS
  FUNCTION get_val(p_id IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN NULL;
  END;
  PROCEDURE save_val(p_id IN NUMBER) IS
  BEGIN
    NULL;
  END;
END pkg;`;
    const items = extractSubprograms(ddl);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "FUNCTION", label: "GET_VAL", line: 2 });
    expect(items[1]).toMatchObject({ kind: "PROCEDURE", label: "SAVE_VAL", line: 6 });
  });

  it("returns empty array for DDL with no subprograms", () => {
    const ddl = `CREATE OR REPLACE PACKAGE pkg AS
  c_max CONSTANT NUMBER := 100;
END pkg;`;
    expect(extractSubprograms(ddl)).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const ddl = `create or replace package body pkg as\n  function my_fn return number is begin return 1; end;\nend;`;
    const items = extractSubprograms(ddl);
    expect(items[0]).toMatchObject({ kind: "FUNCTION", label: "MY_FN" });
  });
});

describe("extractSections", () => {
  it("finds header + IS + BEGIN for a procedure", () => {
    const ddl = `CREATE OR REPLACE PROCEDURE my_proc IS
  v_x NUMBER;
BEGIN
  NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END;`;
    const items = extractSections(ddl);
    expect(items[0]).toMatchObject({ label: "MY_PROC", line: 1 });
    expect(items.find(i => i.label === "IS")).toBeTruthy();
    expect(items.find(i => i.label === "BEGIN")).toBeTruthy();
    expect(items.find(i => i.label === "EXCEPTION")).toBeTruthy();
  });

  it("returns at least the header item", () => {
    const ddl = `CREATE OR REPLACE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;`;
    const items = extractSections(ddl);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].line).toBe(1);
  });
});
