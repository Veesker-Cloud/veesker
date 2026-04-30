import { describe, expect, it } from "bun:test";
import { mapOracleType, mapDuckDBType } from "../src/oracle-shim/types";
import { translate } from "../src/oracle-shim/translator";

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
});
