/**
 * Conservative SQL classification used by safety guards. Operates on the
 * leading keyword after stripping comments and whitespace. Designed to err on
 * the side of REJECTING rather than passing — read-only mode shouldn't let
 * something "interesting" through.
 */

export type SqlKind =
  | "select"   // pure read: SELECT, WITH, EXPLAIN
  | "dml"      // INSERT, UPDATE, DELETE, MERGE
  | "ddl"      // CREATE, ALTER, DROP, TRUNCATE, RENAME, GRANT, REVOKE, COMMENT
  | "tcl"      // COMMIT, ROLLBACK, SAVEPOINT, SET TRANSACTION
  | "plsql"    // BEGIN ... END / DECLARE block / CREATE PROCEDURE etc (overlaps DDL but treated separately)
  | "session"  // ALTER SESSION, ALTER SYSTEM
  | "unknown";

const COMMENT_LINE_RE = /^\s*--[^\n]*\n/;
const COMMENT_BLOCK_RE = /^\s*\/\*[\s\S]*?\*\//;

export function stripLeadingComments(sql: string): string {
  let s = sql;
  while (true) {
    const before = s.length;
    s = s.replace(COMMENT_LINE_RE, "").replace(COMMENT_BLOCK_RE, "").replace(/^\s+/, "");
    if (s.length === before) break;
  }
  return s;
}

export function classifySql(sql: string): SqlKind {
  const s = stripLeadingComments(sql).toUpperCase();
  if (s.startsWith("SELECT") || s.startsWith("WITH") || s.startsWith("EXPLAIN") || s.startsWith("DESC")) {
    return "select";
  }
  if (s.startsWith("BEGIN") || s.startsWith("DECLARE")) {
    return "plsql";
  }
  // CREATE/ALTER/DROP of code objects = DDL but with PL/SQL inside
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b/.test(s)) {
    return "plsql";
  }
  if (/^ALTER\s+SESSION\b/.test(s)) return "session";
  if (/^ALTER\s+SYSTEM\b/.test(s)) return "session";
  if (s.startsWith("CREATE") || s.startsWith("ALTER") || s.startsWith("DROP") || s.startsWith("TRUNCATE")) {
    return "ddl";
  }
  if (s.startsWith("RENAME") || s.startsWith("GRANT") || s.startsWith("REVOKE") || s.startsWith("COMMENT")) {
    return "ddl";
  }
  if (s.startsWith("INSERT") || s.startsWith("UPDATE") || s.startsWith("DELETE") || s.startsWith("MERGE") || s.startsWith("UPSERT")) {
    return "dml";
  }
  if (s.startsWith("COMMIT") || s.startsWith("ROLLBACK") || s.startsWith("SAVEPOINT") || s.startsWith("SET\\s+TRANSACTION")) {
    return "tcl";
  }
  return "unknown";
}

/** Read-only sessions allow these kinds. Session-altering statements are
 * deliberately blocked because they can change the user's privileges. */
export function isReadOnlySafe(kind: SqlKind): boolean {
  return kind === "select";
}

/**
 * Returns true if the statement is an UPDATE or DELETE that has no
 * meaningful WHERE clause. Conservative: anything we can't parse cleanly is
 * NOT flagged as unsafe (we don't want to block legitimate work).
 *
 * Examples flagged:
 *   DELETE FROM employees
 *   UPDATE employees SET salary = 0
 *   DELETE FROM employees WHERE 1=1
 *   UPDATE employees SET salary = 0 WHERE TRUE
 *
 * Examples not flagged:
 *   DELETE FROM employees WHERE id = 1
 *   UPDATE employees SET salary = 0 WHERE department_id = 50
 *   MERGE INTO ... (always benign)
 *   INSERT ... (no WHERE applies)
 */
export function isUnsafeBulkDml(sql: string): boolean {
  const s = stripLeadingComments(sql)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim();
  const isUpdate = s.startsWith("UPDATE ");
  const isDelete = s.startsWith("DELETE ");
  if (!isUpdate && !isDelete) return false;

  const whereIdx = findToplevelWhere(s);
  if (whereIdx === -1) {
    // No WHERE at all: unsafe.
    return true;
  }
  // Check the WHERE clause for trivially-true predicates.
  const after = s.slice(whereIdx + 5).trim();
  // Strip trailing RETURNING ... etc
  const trimmed = after.split(/\sRETURNING\s|\sWHEN\s/)[0].trim();
  if (trimmed === "1=1" || trimmed === "1 = 1" || trimmed === "TRUE" || trimmed === "(1=1)" || trimmed === "(TRUE)") {
    return true;
  }
  return false;
}

/** Find the index of the top-level WHERE keyword (not inside parens or quoted). */
function findToplevelWhere(s: string): number {
  let depth = 0;
  let inStr = false;
  let strCh = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = true;
      strCh = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && (ch === "W" || ch === "w")) {
      if (s.slice(i, i + 5).toUpperCase() === "WHERE" && /\s/.test(s[i - 1] ?? " ") && /\s/.test(s[i + 5] ?? " ")) {
        return i;
      }
    }
  }
  return -1;
}
