// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { describe, expect, test } from "vitest";
import { buildAliasMap } from "./sql-alias-completion";

describe("buildAliasMap", () => {
  test("FROM <table> <alias>", () => {
    const m = buildAliasMap("SELECT emp.x FROM EMPLOYEES emp");
    expect(m.get("EMP")).toEqual({ owner: null, table: "EMPLOYEES" });
    expect(m.get("EMPLOYEES")).toEqual({ owner: null, table: "EMPLOYEES" });
  });

  test("FROM <table> AS <alias>", () => {
    const m = buildAliasMap("SELECT * FROM employees AS e");
    expect(m.get("E")).toEqual({ owner: null, table: "EMPLOYEES" });
  });

  test("FROM <schema>.<table> <alias> resolves owner", () => {
    const m = buildAliasMap("SELECT emp.x FROM HR.EMPLOYEES emp");
    expect(m.get("EMP")).toEqual({ owner: "HR", table: "EMPLOYEES" });
    expect(m.get("EMPLOYEES")).toEqual({ owner: "HR", table: "EMPLOYEES" });
  });

  test("quoted identifiers work", () => {
    const m = buildAliasMap('FROM "HR"."EMPLOYEES" e');
    expect(m.get("E")).toEqual({ owner: "HR", table: "EMPLOYEES" });
  });

  test("JOIN with schema qualifier", () => {
    const m = buildAliasMap(
      "SELECT * FROM EMPLOYEES e JOIN HR.DEPARTMENTS d ON e.DEPT_ID = d.ID"
    );
    expect(m.get("E")).toEqual({ owner: null, table: "EMPLOYEES" });
    expect(m.get("D")).toEqual({ owner: "HR", table: "DEPARTMENTS" });
  });

  test("alias that is a SQL keyword is rejected", () => {
    const m = buildAliasMap("SELECT * FROM EMPLOYEES WHERE id = 1");
    expect(m.has("WHERE")).toBe(false);
  });

  test("multiple FROM clauses", () => {
    const m = buildAliasMap("SELECT * FROM a x, b y, c z");
    expect(m.get("X")).toEqual({ owner: null, table: "A" });
  });
});
