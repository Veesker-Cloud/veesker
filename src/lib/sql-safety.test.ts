import { describe, it, expect } from "vitest";
import { detectDestructive } from "./sql-safety";

describe("detectDestructive", () => {
  it("returns empty for SELECT", () => {
    expect(detectDestructive("SELECT * FROM employees")).toHaveLength(0);
  });

  it("returns empty for INSERT", () => {
    expect(detectDestructive("INSERT INTO t (a) VALUES (1)")).toHaveLength(0);
  });

  it("detects DELETE as destructive", () => {
    const ops = detectDestructive("DELETE FROM employees WHERE id = 1");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DELETE");
    expect(ops[0].severity).toBe("destructive");
  });

  it("detects UPDATE as destructive", () => {
    const ops = detectDestructive("UPDATE employees SET salary = 0");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("UPDATE");
    expect(ops[0].severity).toBe("destructive");
  });

  it("detects DROP as critical", () => {
    const ops = detectDestructive("DROP TABLE employees");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DROP");
    expect(ops[0].severity).toBe("critical");
  });

  it("detects TRUNCATE as critical", () => {
    const ops = detectDestructive("TRUNCATE TABLE employees");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("TRUNCATE");
    expect(ops[0].severity).toBe("critical");
  });

  it("detects ALTER as warning", () => {
    const ops = detectDestructive("ALTER TABLE employees ADD COLUMN x NUMBER");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("ALTER");
    expect(ops[0].severity).toBe("warning");
  });

  it("detects MERGE as destructive", () => {
    const ops = detectDestructive("MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.x = s.x");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("MERGE");
  });

  it("detects CREATE OR REPLACE as warning", () => {
    const ops = detectDestructive("CREATE OR REPLACE PROCEDURE my_proc AS BEGIN NULL; END;");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("CREATE OR REPLACE");
    expect(ops[0].severity).toBe("warning");
  });

  it("is case-insensitive", () => {
    expect(detectDestructive("delete from t")).toHaveLength(1);
    expect(detectDestructive("Delete From t")).toHaveLength(1);
  });

  it("does NOT flag commented-out DELETE", () => {
    expect(detectDestructive("-- DELETE FROM t\nSELECT 1 FROM dual")).toHaveLength(0);
  });

  it("does NOT flag DELETE inside block comment", () => {
    expect(detectDestructive("/* DELETE FROM t */ SELECT 1 FROM dual")).toHaveLength(0);
  });

  it("does NOT flag COMMIT or ROLLBACK", () => {
    expect(detectDestructive("COMMIT")).toHaveLength(0);
    expect(detectDestructive("ROLLBACK")).toHaveLength(0);
  });

  it("returns one entry per distinct keyword even if keyword appears multiple times", () => {
    const ops = detectDestructive("DELETE FROM a; DELETE FROM b");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DELETE");
  });

  it("returns multiple entries when multiple distinct keywords are present", () => {
    const ops = detectDestructive("UPDATE t SET x=1; DROP TABLE t");
    expect(ops).toHaveLength(2);
    const keywords = ops.map((o) => o.keyword);
    expect(keywords).toContain("UPDATE");
    expect(keywords).toContain("DROP");
  });
});
