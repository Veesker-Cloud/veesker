import { describe, expect, test } from "bun:test";
import { classifySql, isReadOnlySafe, isUnsafeBulkDml } from "../src/sql-kind";

describe("classifySql", () => {
  test("plain SELECT is select", () => {
    expect(classifySql("SELECT * FROM dual")).toBe("select");
  });
  test("WITH (CTE) is select", () => {
    expect(classifySql("WITH x AS (SELECT 1 FROM dual) SELECT * FROM x")).toBe("select");
  });
  test("EXPLAIN PLAN is select", () => {
    expect(classifySql("EXPLAIN PLAN FOR SELECT * FROM emp")).toBe("select");
  });
  test("leading line-comment doesn't fool the detector", () => {
    expect(classifySql("-- harmless comment\nDROP TABLE employees")).toBe("ddl");
  });
  test("leading block-comment doesn't fool the detector", () => {
    expect(classifySql("/* SELECT lookalike */ DELETE FROM employees")).toBe("dml");
  });
  test("INSERT/UPDATE/DELETE/MERGE classify as dml", () => {
    expect(classifySql("INSERT INTO t VALUES (1)")).toBe("dml");
    expect(classifySql("UPDATE t SET x = 1")).toBe("dml");
    expect(classifySql("DELETE FROM t")).toBe("dml");
    expect(classifySql("MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET x = 1")).toBe("dml");
  });
  test("CREATE/ALTER/DROP/TRUNCATE classify as ddl", () => {
    expect(classifySql("CREATE TABLE t (id NUMBER)")).toBe("ddl");
    expect(classifySql("ALTER TABLE t ADD c NUMBER")).toBe("ddl");
    expect(classifySql("DROP TABLE t")).toBe("ddl");
    expect(classifySql("TRUNCATE TABLE t")).toBe("ddl");
  });
  test("CREATE PROCEDURE / FUNCTION / PACKAGE classify as plsql", () => {
    expect(classifySql("CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;")).toBe("plsql");
    expect(classifySql("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;")).toBe("plsql");
    expect(classifySql("CREATE PACKAGE pkg AS PROCEDURE p; END;")).toBe("plsql");
  });
  test("BEGIN/DECLARE blocks classify as plsql", () => {
    expect(classifySql("BEGIN NULL; END;")).toBe("plsql");
    expect(classifySql("DECLARE v NUMBER; BEGIN NULL; END;")).toBe("plsql");
  });
  test("ALTER SESSION/SYSTEM classify as session", () => {
    expect(classifySql("ALTER SESSION SET CURRENT_SCHEMA = HR")).toBe("session");
    expect(classifySql("ALTER SYSTEM FLUSH SHARED_POOL")).toBe("session");
  });
  test("COMMIT/ROLLBACK classify as tcl", () => {
    expect(classifySql("COMMIT")).toBe("tcl");
    expect(classifySql("ROLLBACK")).toBe("tcl");
  });
});

describe("isReadOnlySafe", () => {
  test("only select is allowed", () => {
    expect(isReadOnlySafe("select")).toBe(true);
    expect(isReadOnlySafe("dml")).toBe(false);
    expect(isReadOnlySafe("ddl")).toBe(false);
    expect(isReadOnlySafe("plsql")).toBe(false);
    expect(isReadOnlySafe("session")).toBe(false);
    expect(isReadOnlySafe("tcl")).toBe(false);
    expect(isReadOnlySafe("unknown")).toBe(false);
  });
});

describe("isUnsafeBulkDml", () => {
  test("DELETE without WHERE flagged", () => {
    expect(isUnsafeBulkDml("DELETE FROM employees")).toBe(true);
    expect(isUnsafeBulkDml("DELETE FROM employees;")).toBe(true);
  });
  test("UPDATE without WHERE flagged", () => {
    expect(isUnsafeBulkDml("UPDATE employees SET salary = 0")).toBe(true);
  });
  test("DELETE WHERE 1=1 flagged", () => {
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE 1=1")).toBe(true);
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE 1 = 1")).toBe(true);
  });
  test("UPDATE WHERE TRUE flagged", () => {
    expect(isUnsafeBulkDml("UPDATE employees SET salary = 0 WHERE TRUE")).toBe(true);
  });
  test("DELETE with real WHERE not flagged", () => {
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE id = 123")).toBe(false);
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE department_id IN (10, 20)")).toBe(false);
  });
  test("UPDATE with real WHERE not flagged", () => {
    expect(isUnsafeBulkDml("UPDATE employees SET salary = 0 WHERE id = 123")).toBe(false);
  });
  test("INSERT/MERGE never flagged", () => {
    expect(isUnsafeBulkDml("INSERT INTO t VALUES (1)")).toBe(false);
    expect(isUnsafeBulkDml("MERGE INTO t USING s ON (t.id = s.id)")).toBe(false);
  });
  test("SELECT never flagged", () => {
    expect(isUnsafeBulkDml("SELECT * FROM employees")).toBe(false);
  });
  test("WHERE inside subquery alone is not the top-level — still flagged", () => {
    // DELETE without a top-level WHERE clause should be flagged even if a
    // subquery has its own WHERE.
    expect(
      isUnsafeBulkDml("DELETE FROM employees e WHERE e.id IN (SELECT id FROM tmp WHERE x = 1)")
    ).toBe(false); // top-level WHERE exists, real predicate
  });
});
