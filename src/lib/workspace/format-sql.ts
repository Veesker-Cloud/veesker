// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { format } from "sql-formatter";

const PLSQL_BLOCK_RE =
  /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+)?(?:PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b|DECLARE\b|BEGIN\b)/i;

// Oracle reserved keywords + common built-ins to uppercase
const ORACLE_KW = new Set<string>([
  "ACCESS","ADD","ALL","ALTER","AND","ANY","AS","ASC","AUDIT","AUTHID",
  "BEGIN","BETWEEN","BINARY_INTEGER","BLOB","BOOLEAN","BULK","BY",
  "CASE","CHAR","CHECK","CLOB","CLOSE","CLUSTER","COLLECT","COLUMN",
  "COMMENT","COMMIT","COMPRESS","CONNECT","CONSTANT","CREATE","CROSS",
  "CURRENT","CURSOR","DATE","DECIMAL","DECLARE","DEFAULT","DELETE",
  "DESC","DETERMINISTIC","DISTINCT","DROP","EDITIONABLE","ELSE","ELSIF",
  "END","EXCEPTION","EXCEPTION_INIT","EXECUTE","EXISTS","EXIT","FALSE",
  "FETCH","FLOAT","FOR","FORALL","FORCE","FROM","FULL","FUNCTION","GOTO",
  "GRANT","GROUP","HAVING","IF","IMMEDIATE","IN","INDEX","INNER","INSERT",
  "INTEGER","INTERSECT","INTO","IS","JOIN","LEFT","LIKE","LIMIT","LOCK",
  "LONG","LOOP","MERGE","MINUS","MODE","NATURAL","NOCOPY","NONEDITIONABLE",
  "NOT","NULL","NUMBER","OBJECT","OF","ON","OPEN","OPTION","OR","ORDER",
  "OTHERS","OUT","OUTER","OVER","PACKAGE","PARALLEL_ENABLE","PARTITION",
  "PIPELINED","PLS_INTEGER","PRAGMA","PRIOR","PROCEDURE","RAISE",
  "RAISE_APPLICATION_ERROR","RAW","REAL","RECORD","REPLACE","RESULT_CACHE",
  "RETURN","REVERSE","REVOKE","RIGHT","ROLLBACK","ROW","ROWID","ROWNUM",
  "ROWTYPE","SAVEPOINT","SELECT","SEQUENCE","SERIALLY_REUSABLE","SET",
  "SIZE","SMALLINT","START","SUBTYPE","SYNONYM","SYSDATE","SYSTIMESTAMP",
  "TABLE","THEN","TIMESTAMP","TO","TRIGGER","TRUE","TRUNCATE","TYPE",
  "UNION","UNIQUE","UPDATE","USING","VALUES","VARCHAR","VARCHAR2","VIEW",
  "WHEN","WHERE","WHILE","WITH",
]);

function normalizePlsqlWhitespace(sql: string): string {
  const lines = sql.split("\n").map((line) => line.trimEnd());

  // Normalize 4-space indent → 2-space (DBMS_METADATA uses 4-space by default)
  const indents = lines.map((l) => l.match(/^ +/)?.[0].length ?? 0).filter((n) => n > 0);
  if (indents.length > 0) {
    const minIndent = indents.reduce((a, b) => (b < a ? b : a));
    if (minIndent === 4) {
      for (let i = 0; i < lines.length; i++) {
        const sp = lines[i].match(/^ */)?.[0].length ?? 0;
        if (sp > 0) {
          lines[i] = "  ".repeat(Math.floor(sp / 4)) + " ".repeat(sp % 4) + lines[i].slice(sp);
        }
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Uppercase Oracle reserved keywords in PL/SQL source, leaving string literals,
 * double-quoted identifiers, and comments untouched.
 * Also normalises trailing whitespace and collapses runs of 3+ blank lines to 2.
 */
function uppercasePlsql(sql: string): string {
  const uppercased = sql.replace(
    /'(?:[^']|'')*'|"[^"]*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$#][A-Za-z0-9_$#]*/g,
    (match) => {
      const ch = match[0];
      if (ch === "'" || ch === '"' || ch === "-" || ch === "/") return match;
      return ORACLE_KW.has(match.toUpperCase()) ? match.toUpperCase() : match;
    },
  );
  return normalizePlsqlWhitespace(uppercased);
}

/**
 * Format SQL SELECT/DML with sql-formatter (plsql dialect).
 * Not used for PL/SQL blocks — sql-formatter collapses their structure.
 */
function formatSelectDml(sql: string): string {
  return format(sql, {
    language: "plsql",
    tabWidth: 2,
    keywordCase: "upper",
    functionCase: "upper",
    identifierCase: "preserve",
    dataTypeCase: "upper",
    expressionWidth: 80,
    linesBetweenQueries: 2,
    logicalOperatorNewline: "before",
    indentStyle: "standard",
  });
}

/**
 * Format SQL or PL/SQL code.
 *
 * - PL/SQL (CREATE PACKAGE/PROCEDURE/FUNCTION/TRIGGER, DECLARE, BEGIN):
 *   Uppercases Oracle keywords while preserving the original line structure.
 *   sql-formatter is intentionally avoided here because it collapses PL/SQL
 *   blocks into long lines, destroying package specs and procedure bodies.
 *
 * - SQL SELECT/DML: reformatted fully via sql-formatter.
 */
export function formatSql(sql: string, isPlsql?: boolean): string {
  const usePlsql = isPlsql ?? PLSQL_BLOCK_RE.test(sql);
  return usePlsql ? uppercasePlsql(sql) : formatSelectDml(sql);
}
