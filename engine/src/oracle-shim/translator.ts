/**
 * Oracle SQL → DuckDB SQL translator. Pure regex-based string rewrites,
 * no AST. Targets the dialect features sandbox users actually rely on for
 * read-side queries:
 *
 *   - `FROM DUAL`           → `FROM (SELECT 'X' AS DUMMY) AS DUAL`
 *   - `SYSDATE`/`SYSTIMESTAMP` → `CURRENT_TIMESTAMP`
 *   - `NVL(a, b)`           → `COALESCE(a, b)`
 *   - `NVL2(a, b, c)`       → `CASE WHEN a IS NOT NULL THEN b ELSE c END`
 *   - `DECODE(e, k1, v1, ..., default?)` → `CASE WHEN e=k1 THEN v1 ... ELSE default? END`
 *   - `TO_DATE(s, fmt)`     → `strptime(s, fmt)` (with format-code conversion)
 *   - `TO_CHAR(e, fmt)`     → `strftime(e, fmt)` (with format-code conversion)
 *   - `WHERE ROWNUM <= N`   → `LIMIT N`
 *   - `WHERE ROWNUM < N`    → `LIMIT (N-1)`
 *
 * Anything outside this list passes through unchanged. The rewriter masks
 * string literals with non-SQL placeholder tokens before applying regex
 * rewrites, then restores them — so identifier-like text inside `'...'`
 * (e.g. `'NVL is not a function here'`) is never matched by keyword regexes,
 * while function calls whose arguments include literals (TO_DATE, DECODE,
 * etc.) still match across the literal because the placeholder occupies
 * the literal's position in the source.
 *
 * Trade-off: simpler than a parser, but cannot handle nested complex cases
 * (e.g. DECODE(DECODE(...))). For Phase A this is enough; Plan 7 (PL/SQL
 * deepening) will replace this with a real translator.
 */

const ORACLE_TO_DUCKDB_FORMAT: Array<[RegExp, string]> = [
  [/YYYY/g, "%Y"],
  [/YY/g, "%y"],
  [/MON/g, "%b"],
  [/MM/g, "%m"],
  [/DD/g, "%d"],
  [/HH24/g, "%H"],
  [/HH/g, "%I"],
  [/MI/g, "%M"],
  [/SS/g, "%S"],
];

function convertFormat(fmt: string): string {
  let out = fmt;
  for (const [re, rep] of ORACLE_TO_DUCKDB_FORMAT) out = out.replace(re, rep);
  return out;
}

const STRING_PLACEHOLDER_PREFIX = "VSKSTR";
const STRING_PLACEHOLDER_SUFFIX = "";

function maskStrings(sql: string): { masked: string; literals: string[] } {
  const literals: string[] = [];
  let masked = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      let lit = "'";
      i++;
      while (i < sql.length) {
        const c = sql[i];
        lit += c;
        if (c === "'") {
          if (sql[i + 1] === "'") {
            lit += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      const idx = literals.length;
      literals.push(lit);
      masked += `${STRING_PLACEHOLDER_PREFIX}${idx}${STRING_PLACEHOLDER_SUFFIX}`;
    } else {
      masked += ch;
      i++;
    }
  }
  return { masked, literals };
}

function unmaskStrings(s: string, literals: string[]): string {
  return s.replace(
    new RegExp(`${STRING_PLACEHOLDER_PREFIX}(\\d+)${STRING_PLACEHOLDER_SUFFIX}`, "g"),
    (_m, n: string) => literals[parseInt(n, 10)] ?? "",
  );
}

function rewriteMasked(sql: string, literals: string[]): string {
  let out = sql;

  out = out.replace(
    /\b(FROM)\s+DUAL\b/gi,
    (_m, fromKw: string) => `${fromKw} (SELECT 'X' AS DUMMY) AS DUAL`,
  );
  out = out.replace(/\bSYSDATE\b/gi, "CURRENT_TIMESTAMP");
  out = out.replace(/\bSYSTIMESTAMP\b/gi, "CURRENT_TIMESTAMP");

  out = out.replace(/\bNVL\s*\(/gi, "COALESCE(");
  out = out.replace(
    /\bNVL2\s*\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/gi,
    "(CASE WHEN $1 IS NOT NULL THEN $2 ELSE $3 END)",
  );

  out = out.replace(
    /\bDECODE\s*\(\s*([^,]+?)\s*,\s*([\s\S]*?)\)/gi,
    (_match, expr, rest) => {
      const args = splitArgs(rest);
      let elseClause = "NULL";
      if (args.length % 2 === 1) elseClause = args.pop()!;
      const whens: string[] = [];
      for (let i = 0; i < args.length; i += 2) {
        whens.push(
          `WHEN ${expr.trim()} = ${args[i]!.trim()} THEN ${args[i + 1]!.trim()}`,
        );
      }
      return `CASE ${whens.join(" ")} ELSE ${elseClause.trim()} END`;
    },
  );

  const literalRefRe = `${STRING_PLACEHOLDER_PREFIX}(\\d+)${STRING_PLACEHOLDER_SUFFIX}`;
  const toDateRe = new RegExp(
    `\\bTO_DATE\\s*\\(\\s*([^,]+?)\\s*,\\s*${literalRefRe}\\s*\\)`,
    "gi",
  );
  out = out.replace(toDateRe, (_m, val: string, idx: string) => {
    const fmtLit = literals[parseInt(idx, 10)] ?? "''";
    const fmt = fmtLit.slice(1, -1);
    return `strptime(${val.trim()}, '${convertFormat(fmt)}')`;
  });

  const toCharRe = new RegExp(
    `\\bTO_CHAR\\s*\\(\\s*([^,]+?)\\s*,\\s*${literalRefRe}\\s*\\)`,
    "gi",
  );
  out = out.replace(toCharRe, (_m, val: string, idx: string) => {
    const fmtLit = literals[parseInt(idx, 10)] ?? "''";
    const fmt = fmtLit.slice(1, -1);
    return `strftime(${val.trim()}, '${convertFormat(fmt)}')`;
  });

  out = out.replace(/\bWHERE\s+ROWNUM\s*<=\s*(\d+)/gi, "LIMIT $1");
  out = out.replace(
    /\bWHERE\s+ROWNUM\s*<\s*(\d+)/gi,
    (_m, n: string) => `LIMIT ${parseInt(n, 10) - 1}`,
  );

  return out;
}

function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) {
        args.push(s.slice(start, i));
        return args;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(s.slice(start, i));
      start = i + 1;
    }
  }
  args.push(s.slice(start));
  return args;
}

export function translate(sql: string): string {
  const { masked, literals } = maskStrings(sql);
  const rewritten = rewriteMasked(masked, literals);
  return unmaskStrings(rewritten, literals);
}
