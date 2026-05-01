import { describe, expect, it } from "bun:test";
import { mapOracleType, mapDuckDBType } from "../src/oracle-shim/types";
import { translate } from "../src/oracle-shim/translator";
import { installSystemViews } from "../src/oracle-shim/system-views";
import { DuckDBHost } from "../src/duckdb-host";

describe("oracle-shim type adapter — Oracle → DuckDB", () => {
  const cases: Array<[string, string]> = [
    ["NUMBER(10,2)", "DECIMAL(10,2)"],
    ["NUMBER(10)", "DECIMAL(10,0)"],
    ["NUMBER", "DOUBLE"],
    ["VARCHAR2(100)", "VARCHAR"],
    ["VARCHAR2(100 CHAR)", "VARCHAR"],
    ["NVARCHAR2(50)", "VARCHAR"],
    ["CHAR(10)", "VARCHAR"],
    ["CLOB", "VARCHAR"],
    ["NCLOB", "VARCHAR"],
    ["DATE", "TIMESTAMP"],
    ["TIMESTAMP", "TIMESTAMP"],
    ["TIMESTAMP(6)", "TIMESTAMP"],
    ["TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ"],
    ["TIMESTAMP(6) WITH TIME ZONE", "TIMESTAMPTZ"],
    ["TIMESTAMP WITH LOCAL TIME ZONE", "TIMESTAMPTZ"],
    ["BLOB", "BLOB"],
    ["RAW(16)", "BLOB"],
    ["BFILE", "BLOB"],
    ["FLOAT", "DOUBLE"],
    ["FLOAT(53)", "DOUBLE"],
    ["BINARY_FLOAT", "FLOAT"],
    ["BINARY_DOUBLE", "DOUBLE"],
  ];

  for (const [oracle, duck] of cases) {
    it(`maps ${oracle} → ${duck}`, () => {
      expect(mapOracleType(oracle)).toBe(duck);
    });
  }

  it("treats Oracle types as case-insensitive", () => {
    expect(mapOracleType("number(10,2)")).toBe("DECIMAL(10,2)");
    expect(mapOracleType("varchar2(50)")).toBe("VARCHAR");
  });

  it("trims surrounding whitespace", () => {
    expect(mapOracleType("  NUMBER(5)  ")).toBe("DECIMAL(5,0)");
  });

  it("falls back to VARCHAR for unknown Oracle types", () => {
    expect(mapOracleType("XMLTYPE")).toBe("VARCHAR");
    expect(mapOracleType("SDO_GEOMETRY")).toBe("VARCHAR");
    expect(mapOracleType("")).toBe("VARCHAR");
  });

  it("clamps Oracle negative scale to 0 (DuckDB rejects DECIMAL with negative scale)", () => {
    expect(mapOracleType("NUMBER(5,-2)")).toBe("DECIMAL(5,0)");
    expect(mapOracleType("NUMBER(10,-5)")).toBe("DECIMAL(10,0)");
  });
});

describe("oracle-shim type adapter — DuckDB → Oracle", () => {
  it("maps DECIMAL(p,s) back to NUMBER(p,s)", () => {
    expect(mapDuckDBType("DECIMAL(10,2)")).toBe("NUMBER(10,2)");
    expect(mapDuckDBType("DECIMAL(38,0)")).toBe("NUMBER(38,0)");
  });

  it("maps DuckDB integer types to Oracle NUMBER(p,0)", () => {
    expect(mapDuckDBType("INTEGER")).toBe("NUMBER(10,0)");
    expect(mapDuckDBType("INT")).toBe("NUMBER(10,0)");
    expect(mapDuckDBType("BIGINT")).toBe("NUMBER(19,0)");
    expect(mapDuckDBType("SMALLINT")).toBe("NUMBER(5,0)");
    expect(mapDuckDBType("TINYINT")).toBe("NUMBER(3,0)");
  });

  it("maps DuckDB string types to VARCHAR2", () => {
    expect(mapDuckDBType("VARCHAR")).toBe("VARCHAR2(4000)");
  });

  it("maps DuckDB timestamps", () => {
    expect(mapDuckDBType("TIMESTAMP")).toBe("TIMESTAMP");
    expect(mapDuckDBType("TIMESTAMPTZ")).toBe("TIMESTAMP WITH TIME ZONE");
  });

  it("maps DuckDB long-form 'TIMESTAMP WITH TIME ZONE'", () => {
    expect(mapDuckDBType("TIMESTAMP WITH TIME ZONE")).toBe("TIMESTAMP WITH TIME ZONE");
  });

  it("maps DuckDB nanosecond/microsecond/second timestamp variants", () => {
    expect(mapDuckDBType("TIMESTAMP_NS")).toBe("TIMESTAMP");
    expect(mapDuckDBType("TIMESTAMP_MS")).toBe("TIMESTAMP");
    expect(mapDuckDBType("TIMESTAMP_S")).toBe("TIMESTAMP");
  });

  it("maps DuckDB BLOB → Oracle BLOB", () => {
    expect(mapDuckDBType("BLOB")).toBe("BLOB");
  });

  it("maps DuckDB FLOAT/DOUBLE", () => {
    expect(mapDuckDBType("FLOAT")).toBe("BINARY_FLOAT");
    expect(mapDuckDBType("DOUBLE")).toBe("BINARY_DOUBLE");
  });

  it("falls back to VARCHAR2(4000) for unknown DuckDB types", () => {
    expect(mapDuckDBType("UNION")).toBe("VARCHAR2(4000)");
    expect(mapDuckDBType("MAP(VARCHAR, INTEGER)")).toBe("VARCHAR2(4000)");
  });

  it("is case-insensitive", () => {
    expect(mapDuckDBType("decimal(5,2)")).toBe("NUMBER(5,2)");
    expect(mapDuckDBType("bigint")).toBe("NUMBER(19,0)");
  });
});

describe("type adapter round-trip stability", () => {
  it("round-trips common Oracle types stably (where lossless)", () => {
    expect(mapDuckDBType(mapOracleType("NUMBER(10,2)"))).toBe("NUMBER(10,2)");
    expect(mapDuckDBType(mapOracleType("BLOB"))).toBe("BLOB");
    expect(mapDuckDBType(mapOracleType("BINARY_FLOAT"))).toBe("BINARY_FLOAT");
    expect(mapDuckDBType(mapOracleType("BINARY_DOUBLE"))).toBe("BINARY_DOUBLE");
  });
});

describe("oracle-shim SQL translator", () => {
  it("rewrites SELECT FROM DUAL", () => {
    expect(translate("SELECT 1 FROM DUAL"))
      .toBe("SELECT 1 FROM (SELECT 'X' AS DUMMY) AS DUAL");
  });

  it("translates SYSDATE", () => {
    expect(translate("SELECT SYSDATE FROM DUAL"))
      .toBe("SELECT CURRENT_TIMESTAMP FROM (SELECT 'X' AS DUMMY) AS DUAL");
  });

  it("translates SYSTIMESTAMP", () => {
    expect(translate("SELECT SYSTIMESTAMP FROM DUAL"))
      .toBe("SELECT CURRENT_TIMESTAMP FROM (SELECT 'X' AS DUMMY) AS DUAL");
  });

  it("translates NVL → COALESCE", () => {
    expect(translate("SELECT NVL(name, 'unknown') FROM customers"))
      .toBe("SELECT COALESCE(name, 'unknown') FROM customers");
  });

  it("translates NVL2 → CASE", () => {
    const out = translate("SELECT NVL2(email, email, 'no email') FROM customers");
    expect(out).toContain("CASE WHEN email IS NOT NULL THEN email ELSE 'no email' END");
  });

  it("translates DECODE → CASE", () => {
    const out = translate(
      "SELECT DECODE(status, 'A', 'Active', 'I', 'Inactive', 'Other') FROM t",
    );
    expect(out).toContain("CASE");
    expect(out).toContain("WHEN status = 'A' THEN 'Active'");
    expect(out).toContain("WHEN status = 'I' THEN 'Inactive'");
    expect(out).toContain("ELSE 'Other'");
  });

  it("translates DECODE with no default to CASE with NULL else", () => {
    const out = translate("SELECT DECODE(s, 'A', 1, 'B', 2) FROM t");
    expect(out).toContain("ELSE NULL");
  });

  it("translates TO_DATE with format", () => {
    expect(translate("SELECT TO_DATE('2026-04-30','YYYY-MM-DD') FROM DUAL"))
      .toContain("strptime('2026-04-30', '%Y-%m-%d')");
  });

  it("translates TO_CHAR(date) with format", () => {
    expect(translate("SELECT TO_CHAR(SYSDATE,'YYYY-MM-DD') FROM DUAL"))
      .toContain("strftime(CURRENT_TIMESTAMP, '%Y-%m-%d')");
  });

  it("translates ROWNUM <= N to LIMIT N", () => {
    expect(translate("SELECT * FROM t WHERE ROWNUM <= 10"))
      .toBe("SELECT * FROM t LIMIT 10");
  });

  it("translates ROWNUM < N to LIMIT N-1", () => {
    expect(translate("SELECT * FROM t WHERE ROWNUM < 10"))
      .toBe("SELECT * FROM t LIMIT 9");
  });

  it("preserves passthrough SQL untouched", () => {
    const sql = "SELECT id, name FROM customers WHERE id = 1";
    expect(translate(sql)).toBe(sql);
  });

  it("is case-insensitive for keywords", () => {
    expect(translate("select sysdate from dual"))
      .toBe("select CURRENT_TIMESTAMP from (SELECT 'X' AS DUMMY) AS DUAL");
  });

  it("converts Oracle date format codes inside TO_CHAR", () => {
    const out = translate("SELECT TO_CHAR(d, 'DD/MM/YYYY HH24:MI:SS') FROM t");
    expect(out).toContain("strftime(d, '%d/%m/%Y %H:%M:%S')");
  });

  it("handles MON in format strings", () => {
    const out = translate("SELECT TO_CHAR(d, 'DD-MON-YY') FROM t");
    expect(out).toContain("strftime(d, '%d-%b-%y')");
  });

  it("does not translate inside string literals", () => {
    const out = translate("SELECT 'NVL is not a function here' FROM DUAL");
    expect(out).toContain("'NVL is not a function here'");
    expect(out).not.toContain("COALESCE");
  });

  it("translates NVL2 with nested function calls in args", () => {
    const out = translate("SELECT NVL2(SUBSTR(x, 1, 3), 'yes', 'no') FROM DUAL");
    expect(out).toContain("CASE WHEN SUBSTR(x, 1, 3) IS NOT NULL THEN 'yes' ELSE 'no' END");
  });

  it("translates DECODE with nested function in expr", () => {
    const out = translate("SELECT DECODE(GREATEST(a,b), 1, 'one', 2, 'two') FROM t");
    expect(out).toContain("WHEN GREATEST(a,b) = 1 THEN 'one'");
    expect(out).toContain("WHEN GREATEST(a,b) = 2 THEN 'two'");
  });

  it("translates DECODE with NULL key using IS NULL", () => {
    const out = translate("SELECT DECODE(x, NULL, 'is null', 'A', 'is A') FROM t");
    expect(out).toContain("WHEN x IS NULL THEN 'is null'");
    expect(out).toContain("WHEN x = 'A' THEN 'is A'");
    expect(out).not.toContain("x = NULL");
  });

  it("translates DECODE with NULL key (lowercase)", () => {
    const out = translate("SELECT DECODE(x, null, 'n') FROM t");
    expect(out).toContain("WHEN x IS NULL THEN 'n'");
  });

  it("does not translate ROWNUM when combined with another predicate", () => {
    const sql = "SELECT * FROM t WHERE ROWNUM <= 10 AND status = 'A'";
    expect(translate(sql)).toBe(sql);
  });

  it("translates ROWNUM at end of statement (semicolon variant)", () => {
    expect(translate("SELECT * FROM t WHERE ROWNUM <= 5;"))
      .toBe("SELECT * FROM t LIMIT 5;");
  });

  it("translates MONTH to %B (full month name)", () => {
    const out = translate("SELECT TO_CHAR(d, 'MONTH') FROM t");
    expect(out).toContain("strftime(d, '%B')");
  });

  it("translates DAY to %A (full weekday name)", () => {
    const out = translate("SELECT TO_CHAR(d, 'DAY') FROM t");
    expect(out).toContain("strftime(d, '%A')");
  });

  it("translates AM/PM to %p", () => {
    expect(translate("SELECT TO_CHAR(d, 'HH:MI AM') FROM t"))
      .toContain("strftime(d, '%I:%M %p')");
    expect(translate("SELECT TO_CHAR(d, 'HH:MI PM') FROM t"))
      .toContain("strftime(d, '%I:%M %p')");
  });

  it("translates DDD to %j (day of year)", () => {
    expect(translate("SELECT TO_CHAR(d, 'DDD') FROM t"))
      .toContain("strftime(d, '%j')");
  });

  it("translates HH12 to %I", () => {
    expect(translate("SELECT TO_CHAR(d, 'HH12:MI') FROM t"))
      .toContain("strftime(d, '%I:%M')");
  });

  it("preserves longer tokens (MONTH not split into MON+TH)", () => {
    const out = translate("SELECT TO_CHAR(d, 'MONTH-DDD') FROM t");
    expect(out).toContain("strftime(d, '%B-%j')");
  });

  it("leaves concatenated format arguments unchanged for DuckDB to reject", () => {
    const sql = "SELECT TO_DATE('2026-04-30', 'YYYY' || '-MM-DD') FROM DUAL";
    const out = translate(sql);
    expect(out).toContain("TO_DATE('2026-04-30', 'YYYY' || '-MM-DD')");
  });

  it("re-doubles embedded single-quotes in format literals", () => {
    const out = translate("SELECT TO_CHAR(d, 'It''s now HH24:MI') FROM t");
    expect(out).toContain("strftime(d, 'It''s now %H:%M')");
    expect(out).not.toContain("It's now %H");
  });
});

describe("oracle-shim system views", () => {
  it("populates USER_OBJECTS and USER_TAB_COLUMNS from a DuckDB schema", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec("CREATE TABLE orders (id INT, total DECIMAL(18,2))");
      await host.exec("CREATE TABLE customers (id INT, name VARCHAR)");
      await installSystemViews(host, "TEST_OWNER");

      const objs = await host.query("SELECT object_name FROM vsk_user_objects ORDER BY object_name");
      expect(objs.map((r) => r.object_name)).toEqual(["CUSTOMERS", "ORDERS"]);

      const cols = await host.query(
        "SELECT column_name, data_type FROM vsk_user_tab_columns WHERE table_name='ORDERS' ORDER BY column_id",
      );
      expect(cols).toEqual([
        { column_name: "ID", data_type: "NUMBER(10,0)" },
        { column_name: "TOTAL", data_type: "NUMBER(18,2)" },
      ]);
    } finally {
      await host.close();
    }
  });

  it("only includes tables, not the system views themselves", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec("CREATE TABLE foo (id INT)");
      await installSystemViews(host, "X");
      const rows = await host.query("SELECT object_name FROM vsk_user_objects ORDER BY object_name");
      const names = rows.map((r) => r.object_name);
      expect(names).toContain("FOO");
      expect(names).not.toContain("VSK_USER_OBJECTS");
      expect(names).not.toContain("VSK_USER_TAB_COLUMNS");
    } finally {
      await host.close();
    }
  });

  it("can be reinstalled after schema changes", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec("CREATE TABLE a (id INT)");
      await installSystemViews(host, "X");
      let rows = await host.query("SELECT object_name FROM vsk_user_objects");
      expect(rows.length).toBe(1);

      await host.exec("CREATE TABLE b (id INT)");
      await installSystemViews(host, "X");
      rows = await host.query("SELECT object_name FROM vsk_user_objects ORDER BY object_name");
      expect(rows.map((r) => r.object_name)).toEqual(["A", "B"]);
    } finally {
      await host.close();
    }
  });

  it("populates nullable indicator", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec("CREATE TABLE t (id INT NOT NULL, name VARCHAR)");
      await installSystemViews(host, "X");
      const rows = await host.query(
        "SELECT column_name, nullable FROM vsk_user_tab_columns WHERE table_name='T' ORDER BY column_id",
      );
      expect(rows).toEqual([
        { column_name: "ID", nullable: "N" },
        { column_name: "NAME", nullable: "Y" },
      ]);
    } finally {
      await host.close();
    }
  });

  it("escapes special characters in column / table names safely", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "weird$tab" ("col_1" INT)`);
      await installSystemViews(host, "X");
      const rows = await host.query(
        "SELECT object_name FROM vsk_user_objects WHERE object_name = 'WEIRD$TAB'",
      );
      expect(rows.length).toBe(1);
    } finally {
      await host.close();
    }
  });

  it("escapes single quotes in identifiers via sqlStr", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "O'Brien" ("col'name" INT)`);
      await installSystemViews(host);
      const objs = await host.query(
        "SELECT object_name FROM vsk_user_objects WHERE object_name = 'O''BRIEN'",
      );
      expect(objs.length).toBe(1);
      const cols = await host.query(
        "SELECT column_name FROM vsk_user_tab_columns WHERE table_name = 'O''BRIEN'",
      );
      expect(cols.map((r) => r.column_name)).toEqual(["COL'NAME"]);
    } finally {
      await host.close();
    }
  });

  it("handles empty schema (no tables) without error", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await installSystemViews(host);
      const objs = await host.query("SELECT * FROM vsk_user_objects");
      expect(objs).toEqual([]);
      const cols = await host.query("SELECT * FROM vsk_user_tab_columns");
      expect(cols).toEqual([]);
    } finally {
      await host.close();
    }
  });

  it("does not clobber a user table that happens to be named user_objects", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec("CREATE TABLE user_objects (mine INTEGER)");
      await host.exec("INSERT INTO user_objects VALUES (42)");
      await installSystemViews(host);
      const userTable = await host.query("SELECT mine FROM user_objects");
      expect(userTable).toEqual([{ mine: 42 }]);
      const sysObjects = await host.query("SELECT object_name FROM vsk_user_objects ORDER BY object_name");
      expect(sysObjects.map((r) => r.object_name)).toContain("USER_OBJECTS");
    } finally {
      await host.close();
    }
  });
});
