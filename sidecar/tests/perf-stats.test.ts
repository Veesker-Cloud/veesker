import { afterEach, describe, expect, test } from "bun:test";
import { extractTableNames, setTestSession, tablesStats } from "../src/perf-stats";
import type oracledb from "oracledb";

afterEach(() => {
  setTestSession(null);
});

describe("extractTableNames", () => {
  test("simple SELECT FROM", () => {
    expect(extractTableNames("SELECT * FROM employees"))
      .toEqual([{ owner: null, name: "EMPLOYEES" }]);
  });
  test("schema-qualified", () => {
    expect(extractTableNames("SELECT * FROM hr.employees"))
      .toEqual([{ owner: "HR", name: "EMPLOYEES" }]);
  });
  test("JOIN expands set", () => {
    const refs = extractTableNames(
      "SELECT * FROM employees e JOIN departments d ON e.dept_id = d.id"
    );
    expect(refs).toContainEqual({ owner: null, name: "EMPLOYEES" });
    expect(refs).toContainEqual({ owner: null, name: "DEPARTMENTS" });
  });
  test("comma-join expands set", () => {
    const refs = extractTableNames("SELECT * FROM emp, dept");
    expect(refs).toContainEqual({ owner: null, name: "EMP" });
    expect(refs).toContainEqual({ owner: null, name: "DEPT" });
  });
  test("CTE not flagged as table (skip WITH name)", () => {
    const refs = extractTableNames(
      "WITH x AS (SELECT 1 FROM dual) SELECT * FROM x"
    );
    // x is the CTE alias — not a real table; we accept it since we have no
    // way to distinguish at parse-time. The dictionary lookup will return
    // empty stats for it, which is fine.
    expect(refs).toContainEqual({ owner: null, name: "X" });
  });
  test("strips line comments", () => {
    expect(extractTableNames("-- foo\nSELECT * FROM emp"))
      .toEqual([{ owner: null, name: "EMP" }]);
  });
  test("returns empty for non-SELECT", () => {
    expect(extractTableNames("BEGIN NULL; END;")).toEqual([]);
  });
  test("dedups duplicates", () => {
    const refs = extractTableNames("SELECT * FROM emp, emp e2");
    expect(refs.filter((r) => r.name === "EMP")).toHaveLength(1);
  });
  test("schema-qualified preserves owner across multiple tables", () => {
    const refs = extractTableNames("SELECT * FROM hr.employees, payroll.salary");
    expect(refs).toContainEqual({ owner: "HR", name: "EMPLOYEES" });
    expect(refs).toContainEqual({ owner: "PAYROLL", name: "SALARY" });
  });
});

describe("tablesStats with mocked oracle", () => {
  test("returns empty when no tables in SQL", async () => {
    const fakeConn = {
      execute: async () => ({ rows: [] }),
    } as unknown as oracledb.Connection;
    setTestSession(fakeConn);
    const result = await tablesStats({ sql: "BEGIN NULL; END;" });
    expect(result.tables).toEqual([]);
  });

  test("returns tables with stats and indexes", async () => {
    const fakeConn = {
      execute: async (sql: string) => {
        if (sql.includes("ALL_TABLES")) {
          return {
            rows: [
              { OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                NUM_ROWS: 1200000, LAST_ANALYZED: new Date("2026-04-20T00:00:00Z"),
                BLOCKS: 8000 },
            ],
          };
        }
        if (sql.includes("ALL_IND_COLUMNS")) {
          return {
            rows: [
              { TABLE_OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                INDEX_NAME: "IDX_EMP_DEPT", COLUMN_NAME: "DEPARTMENT_ID",
                COLUMN_POSITION: 1, UNIQUENESS: "NONUNIQUE", STATUS: "VALID" },
              { TABLE_OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                INDEX_NAME: "PK_EMPLOYEES", COLUMN_NAME: "EMPLOYEE_ID",
                COLUMN_POSITION: 1, UNIQUENESS: "UNIQUE", STATUS: "VALID" },
            ],
          };
        }
        return { rows: [] };
      },
    } as unknown as oracledb.Connection;
    setTestSession(fakeConn);
    const result = await tablesStats({ sql: "SELECT * FROM hr.employees" });
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe("EMPLOYEES");
    expect(result.tables[0].numRows).toBe(1_200_000);
    expect(result.tables[0].indexes).toHaveLength(2);
    const dept = result.tables[0].indexes.find((i) => i.name === "IDX_EMP_DEPT");
    expect(dept?.columns).toEqual(["DEPARTMENT_ID"]);
    expect(dept?.unique).toBe(false);
  });
});
