import { describe, expect, test } from "bun:test";
import { splitSql } from "../src/sql-splitter";

// --- Group A: Empty / whitespace ---
describe("A: empty/whitespace", () => {
  test("empty string → 0 statements, 0 errors", () => {
    const r = splitSql("");
    expect(r.statements).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test("whitespace only → 0 statements", () => {
    const r = splitSql("   \n\t\n   ");
    expect(r.statements).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test("bare semicolon → 0 statements", () => {
    const r = splitSql("   ;   ");
    expect(r.statements).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test("standalone slash on own line → 0 statements", () => {
    const r = splitSql("   /   ");
    expect(r.statements).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group B: Single statement ---
describe("B: single statement", () => {
  test("no terminator → 1 statement", () => {
    const r = splitSql("SELECT 1 FROM dual");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("terminated with ; → no trailing semicolon in result", () => {
    const r = splitSql("SELECT 1 FROM dual;");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("semicolon with trailing whitespace/newlines", () => {
    const r = splitSql("SELECT 1 FROM dual;   \n  \n  ");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("leading/trailing whitespace is trimmed", () => {
    const r = splitSql("   SELECT 1 FROM dual   ");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group C: Multiple regular SQL ---
describe("C: multiple regular SQL", () => {
  test("two statements on one line", () => {
    const r = splitSql("SELECT 1 FROM dual; SELECT 2 FROM dual;");
    expect(r.statements).toEqual(["SELECT 1 FROM dual", "SELECT 2 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("two statements with newlines", () => {
    const r = splitSql("SELECT 1 FROM dual;\nSELECT 2 FROM dual;");
    expect(r.statements).toEqual(["SELECT 1 FROM dual", "SELECT 2 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("three statements, last without terminator", () => {
    const r = splitSql("SELECT 1 FROM dual;\nSELECT 2 FROM dual;\nSELECT 3 FROM dual");
    expect(r.statements).toEqual([
      "SELECT 1 FROM dual",
      "SELECT 2 FROM dual",
      "SELECT 3 FROM dual",
    ]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group D: Comments ---
describe("D: comments", () => {
  test("line comment before statement", () => {
    const r = splitSql("-- comment\nSELECT 1 FROM dual;");
    expect(r.statements.length).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test("semicolon inside line comment is ignored", () => {
    const r = splitSql("SELECT 1 FROM dual; -- trailing ; comment");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("block comment before statement", () => {
    const r = splitSql("/* multi\nline */ SELECT 1 FROM dual;");
    expect(r.statements.length).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test("semicolon inside block comment is ignored", () => {
    const r = splitSql("SELECT 1 /* with ; inside */ FROM dual;");
    expect(r.statements).toEqual(["SELECT 1 /* with ; inside */ FROM dual"]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group E: String literals ---
describe("E: string literals", () => {
  test("doubled single-quote escape", () => {
    const r = splitSql("SELECT 'it''s' FROM dual;");
    expect(r.statements).toEqual(["SELECT 'it''s' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("semicolons inside strings are not separators", () => {
    const r = splitSql("SELECT 'a;b' FROM dual; SELECT 'c;d' FROM dual;");
    expect(r.statements).toEqual([
      "SELECT 'a;b' FROM dual",
      "SELECT 'c;d' FROM dual",
    ]);
    expect(r.errors).toEqual([]);
  });

  test("q-quoted with [] brackets", () => {
    const r = splitSql("SELECT q'[any ; thing]' FROM dual;");
    expect(r.statements).toEqual(["SELECT q'[any ; thing]' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("q-quoted with <> brackets", () => {
    const r = splitSql("SELECT q'<don;t>' FROM dual;");
    expect(r.statements).toEqual(["SELECT q'<don;t>' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("q-quoted with () brackets", () => {
    const r = splitSql("SELECT q'(hi;there)' FROM dual;");
    expect(r.statements).toEqual(["SELECT q'(hi;there)' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("q-quoted with {} brackets", () => {
    const r = splitSql("SELECT q'{a;b}' FROM dual;");
    expect(r.statements).toEqual(["SELECT q'{a;b}' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("q-quoted with custom delimiter", () => {
    const r = splitSql("SELECT q'!hi;there!' FROM dual;");
    expect(r.statements).toEqual(["SELECT q'!hi;there!' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("n-prefix nchar literal", () => {
    const r = splitSql("SELECT n'foo' FROM dual;");
    expect(r.statements).toEqual(["SELECT n'foo' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("nq-prefix nchar q-quoted literal", () => {
    const r = splitSql("SELECT nq'[bar;baz]' FROM dual;");
    expect(r.statements).toEqual(["SELECT nq'[bar;baz]' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("Q (uppercase) q-quoted literal", () => {
    const r = splitSql("SELECT Q'[hi;there]' FROM dual;");
    expect(r.statements).toEqual(["SELECT Q'[hi;there]' FROM dual"]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group F: Quoted identifiers ---
describe("F: quoted identifiers", () => {
  test("semicolon inside quoted identifier is ignored", () => {
    const r = splitSql('SELECT * FROM "weird;name";');
    expect(r.statements).toEqual(['SELECT * FROM "weird;name"']);
    expect(r.errors).toEqual([]);
  });

  test("doubled double-quote escape inside identifier", () => {
    const r = splitSql('SELECT * FROM "doubled""name";');
    expect(r.statements).toEqual(['SELECT * FROM "doubled""name"']);
    expect(r.errors).toEqual([]);
  });
});

// --- Group G: PL/SQL blocks ---
describe("G: PL/SQL blocks", () => {
  test("BEGIN ... END; / terminates on slash", () => {
    const r = splitSql("BEGIN NULL; END;\n/\n");
    expect(r.statements).toEqual(["BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("DECLARE block terminated by /", () => {
    const r = splitSql("DECLARE v NUMBER; BEGIN v := 1; END;\n/");
    expect(r.statements).toEqual(["DECLARE v NUMBER; BEGIN v := 1; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE OR REPLACE PROCEDURE terminated by /", () => {
    const r = splitSql("CREATE OR REPLACE PROCEDURE foo IS BEGIN NULL; END;\n/");
    expect(r.statements).toEqual(["CREATE OR REPLACE PROCEDURE foo IS BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE FUNCTION terminated by /", () => {
    const r = splitSql("CREATE FUNCTION bar RETURN NUMBER IS BEGIN RETURN 1; END;\n/");
    expect(r.statements).toEqual(["CREATE FUNCTION bar RETURN NUMBER IS BEGIN RETURN 1; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE OR REPLACE EDITIONABLE PROCEDURE terminated by /", () => {
    const r = splitSql("CREATE OR REPLACE EDITIONABLE PROCEDURE foo IS BEGIN NULL; END;\n/");
    expect(r.statements).toEqual(["CREATE OR REPLACE EDITIONABLE PROCEDURE foo IS BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE PACKAGE terminated by /", () => {
    const r = splitSql("CREATE PACKAGE pkg IS PROCEDURE p; END pkg;\n/");
    expect(r.statements).toEqual(["CREATE PACKAGE pkg IS PROCEDURE p; END pkg;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE PACKAGE BODY terminated by /", () => {
    const r = splitSql("CREATE PACKAGE BODY pkg IS PROCEDURE p IS BEGIN NULL; END; END pkg;\n/");
    expect(r.statements).toEqual([
      "CREATE PACKAGE BODY pkg IS PROCEDURE p IS BEGIN NULL; END; END pkg;",
    ]);
    expect(r.errors).toEqual([]);
  });

  test("PL/SQL block followed by regular SQL → 2 statements", () => {
    const r = splitSql("BEGIN NULL; END;\n/\nSELECT 1 FROM dual;");
    expect(r.statements).toEqual(["BEGIN NULL; END;", "SELECT 1 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("regular SQL followed by PL/SQL block → 2 statements", () => {
    const r = splitSql("SELECT 1 FROM dual;\nBEGIN NULL; END;\n/");
    expect(r.statements).toEqual(["SELECT 1 FROM dual", "BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("PL/SQL block at EOF without / (forgiving) → 1 statement", () => {
    const r = splitSql("BEGIN NULL; END;");
    expect(r.statements).toEqual(["BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("multiple PL/SQL blocks back-to-back", () => {
    const r = splitSql("BEGIN NULL; END;\n/\nBEGIN NULL; END;\n/");
    expect(r.statements).toEqual(["BEGIN NULL; END;", "BEGIN NULL; END;"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE TRIGGER terminated by /", () => {
    const r = splitSql("CREATE TRIGGER trg BEFORE INSERT ON foo FOR EACH ROW BEGIN NULL; END;\n/");
    expect(r.statements).toEqual([
      "CREATE TRIGGER trg BEFORE INSERT ON foo FOR EACH ROW BEGIN NULL; END;",
    ]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group H: CREATE non-PL/SQL ---
describe("H: CREATE non-PL/SQL", () => {
  test("CREATE TABLE terminates on ; not /", () => {
    const r = splitSql("CREATE TABLE foo (id NUMBER); INSERT INTO foo VALUES (1);");
    expect(r.statements).toEqual([
      "CREATE TABLE foo (id NUMBER)",
      "INSERT INTO foo VALUES (1)",
    ]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE INDEX terminates on ;", () => {
    const r = splitSql("CREATE INDEX i ON foo(id); SELECT * FROM foo;");
    expect(r.statements).toEqual(["CREATE INDEX i ON foo(id)", "SELECT * FROM foo"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE SEQUENCE terminates on ;", () => {
    const r = splitSql("CREATE SEQUENCE s; SELECT s.NEXTVAL FROM dual;");
    expect(r.statements).toEqual(["CREATE SEQUENCE s", "SELECT s.NEXTVAL FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("CREATE VIEW terminates on ;", () => {
    const r = splitSql("CREATE VIEW v AS SELECT 1 FROM dual; SELECT * FROM v;");
    expect(r.statements).toEqual([
      "CREATE VIEW v AS SELECT 1 FROM dual",
      "SELECT * FROM v",
    ]);
    expect(r.errors).toEqual([]);
  });
});

// --- Group I: Error cases ---
describe("I: error cases", () => {
  test("unterminated single-quoted string", () => {
    const r = splitSql("SELECT 'unterminated FROM dual");
    expect(r.statements).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].message).toBe("Unterminated string literal");
  });

  test("unterminated quoted identifier", () => {
    const r = splitSql('SELECT * FROM "unterminated');
    expect(r.statements).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].message).toBe("Unterminated quoted identifier");
  });

  test("unterminated block comment", () => {
    const r = splitSql("/* unterminated comment");
    expect(r.statements).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].message).toBe("Unterminated block comment");
  });

  test("error reports correct line number for unterminated string", () => {
    const r = splitSql("SELECT 1 FROM dual;\nSELECT 'oops");
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].line).toBe(2);
  });

  test("error reports correct line number for unterminated block comment", () => {
    const r = splitSql("SELECT 1;\n\n/* no end");
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].line).toBe(3);
  });

  test("statements parsed before error are returned", () => {
    const r = splitSql("SELECT 1 FROM dual;\nSELECT 'oops");
    expect(r.statements).toEqual(["SELECT 1 FROM dual"]);
    expect(r.errors.length).toBe(1);
  });
});

// --- Group J: Adversarial / mixed (kitchen sink) ---
describe("J: adversarial / kitchen sink", () => {
  test("kitchen sink example → 4 statements, 0 errors", () => {
    const input = [
      "-- comment with ; inside",
      "SELECT 'a;b' FROM dual;",
      "SELECT * FROM \"weird;name\";",
      "DECLARE",
      "  v VARCHAR2(10) := 'x;y';",
      "BEGIN",
      "  IF 1=1 THEN",
      "    NULL;",
      "  END IF;",
      "  DBMS_OUTPUT.PUT_LINE('hello');",
      "END;",
      "/",
      "INSERT INTO foo VALUES (1);",
    ].join("\n");
    const r = splitSql(input);
    expect(r.errors).toEqual([]);
    expect(r.statements.length).toBe(4);
    expect(r.statements[0]).toContain("SELECT 'a;b' FROM dual");
    expect(r.statements[1]).toContain('"weird;name"');
    expect(r.statements[2]).toContain("DECLARE");
    expect(r.statements[2]).toContain("END;");
    expect(r.statements[3]).toBe("INSERT INTO foo VALUES (1)");
  });

  test("slash that is NOT on its own line is treated as content", () => {
    const r = splitSql("SELECT 1/2 FROM dual;");
    expect(r.statements).toEqual(["SELECT 1/2 FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("NQ uppercase prefix works", () => {
    const r = splitSql("SELECT NQ'[bar;baz]' FROM dual;");
    expect(r.statements).toEqual(["SELECT NQ'[bar;baz]' FROM dual"]);
    expect(r.errors).toEqual([]);
  });

  test("semicolons inside PL/SQL block do not split", () => {
    const r = splitSql(
      "BEGIN\n  FOR i IN 1..10 LOOP\n    NULL;\n  END LOOP;\nEND;\n/"
    );
    expect(r.statements.length).toBe(1);
    expect(r.statements[0]).toContain("FOR i IN 1..10 LOOP");
    expect(r.errors).toEqual([]);
  });

  test("CREATE TYPE BODY terminated by /", () => {
    const r = splitSql("CREATE TYPE BODY mytype IS MEMBER FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; END;\n/");
    expect(r.statements.length).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test("comment-only input → 0 statements", () => {
    const r = splitSql("-- just a comment\n/* another comment */");
    expect(r.statements).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});
