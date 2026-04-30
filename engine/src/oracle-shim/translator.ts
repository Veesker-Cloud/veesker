/**
 * Oracle SQL → DuckDB SQL translator. Pure regex-based string rewrites,
 * no AST. Targets the dialect features sandbox users actually rely on for
 * read-side queries.
 *
 * Translations:
 *   - `FROM DUAL`           → `FROM (SELECT 'X' AS DUMMY) AS DUAL` (preserves keyword case)
 *   - `SYSDATE`/`SYSTIMESTAMP` → `CURRENT_TIMESTAMP`
 *   - `NVL(a, b)`           → `COALESCE(a, b)`
 *   - `NVL2(a, b, c)`       → `(CASE WHEN a IS NOT NULL THEN b ELSE c END)`
 *   - `DECODE(e, k1, v1, ..., default?)` → `CASE WHEN e=k1 THEN v1 ... ELSE default? END`
 *      with NULL key short-circuited to `IS NULL`
 *   - `TO_DATE(s, fmt)`     → `strptime(s, fmt)` (with format-code conversion)
 *   - `TO_CHAR(e, fmt)`     → `strftime(e, fmt)` (with format-code conversion)
 *   - `WHERE ROWNUM <= N`   → `LIMIT N`  (only if ROWNUM is the sole predicate)
 *   - `WHERE ROWNUM < N`    → `LIMIT (N-1)` (same caveat)
 *
 * Mask-and-restore: string literals (`'...'` with `''` doubling for escapes) are
 * replaced with control-byte placeholders before regex passes, then restored.
 * This guarantees no rewrite touches text inside literals.
 *
 * Known limitations (passes through unchanged):
 *   - Oracle q-quote literals: `q'[...]'`, `q'!...!'`, etc. desync the masker.
 *   - Nested DECODE / nested NVL2 inside the SAME function call (e.g.
 *     `DECODE(DECODE(...))`).
 *   - ROWNUM combined with other WHERE predicates (e.g.
 *     `WHERE ROWNUM <= 10 AND col = 1`) is left untouched — user must
 *     rewrite manually for v1.
 *   - `--` line comments may have keywords translated inside (benign — DuckDB
 *     also recognizes `--` comments at execution time).
 *
 * Plan 7 (PL/SQL deepening) will replace this with a real translator.
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

const STR_PLACEHOLDER_OPEN = "\x01VSKSTR";
const STR_PLACEHOLDER_CLOSE = "\x02";

interface MaskedSql {
  masked: string;
  literals: string[];
}

/**
 * Replace each `'...'` literal (with `''` doubling for escapes) with a
 * control-byte placeholder so regex passes never touch literal contents.
 */
function maskStrings(sql: string): MaskedSql {
  const literals: string[] = [];
  let masked = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'") {
      masked += ch;
      i++;
      continue;
    }
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
    masked += `${STR_PLACEHOLDER_OPEN}${literals.length}${STR_PLACEHOLDER_CLOSE}`;
    literals.push(lit);
  }
  return { masked, literals };
}

function unmaskStrings(masked: string, literals: string[]): string {
  return masked.replace(
    new RegExp(`${STR_PLACEHOLDER_OPEN}(\\d+)${STR_PLACEHOLDER_CLOSE.replace(/\x02/g, "\\x02")}`, "g"),
    (_m, n) => literals[Number(n)]!,
  );
}

/** Read the literal a placeholder points to (without restoring the whole SQL). */
function literalAt(masked: string, literals: string[], placeholderMatch: string): string | undefined {
  const m = placeholderMatch.match(new RegExp(`${STR_PLACEHOLDER_OPEN}(\\d+)`));
  if (!m) return undefined;
  return literals[Number(m[1])];
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

/**
 * Find the matching close-paren for the open-paren at `openIdx`. Returns
 * the index of the matching `)`, or -1 if unbalanced.
 */
function matchParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace every `name(...)` call (case-insensitive) where the entire
 * parenthesized arg list is captured with paren matching (not a regex). The
 * `rewrite` callback receives the raw arg-list string and returns the full
 * replacement (including any wrapping parens).
 */
function rewriteCall(seg: string, name: string, rewrite: (argList: string) => string): string {
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    const openIdx = m.index + m[0].length - 1; // points at '('
    const closeIdx = matchParen(seg, openIdx);
    if (closeIdx < 0) break;
    const argList = seg.slice(openIdx + 1, closeIdx);
    out += seg.slice(last, m.index);
    out += rewrite(argList);
    last = closeIdx + 1;
    re.lastIndex = closeIdx + 1;
  }
  out += seg.slice(last);
  return out;
}

function isNullKey(key: string): boolean {
  return key.trim().toUpperCase() === "NULL";
}

function rewriteSegment(seg: string, literals: string[]): string {
  let out = seg;

  out = out.replace(
    /\b(FROM)\s+DUAL\b/gi,
    (_m, fromKw) => `${fromKw} (SELECT 'X' AS DUMMY) AS DUAL`,
  );
  out = out.replace(/\bSYSDATE\b/gi, "CURRENT_TIMESTAMP");
  out = out.replace(/\bSYSTIMESTAMP\b/gi, "CURRENT_TIMESTAMP");
  out = out.replace(/\bNVL\s*\(/gi, "COALESCE(");

  // NVL2 — paren-matched
  out = rewriteCall(out, "NVL2", (argList) => {
    const args = splitArgs(argList);
    if (args.length !== 3) return `NVL2(${argList})`;
    return `(CASE WHEN ${args[0]!.trim()} IS NOT NULL THEN ${args[1]!.trim()} ELSE ${args[2]!.trim()} END)`;
  });

  // DECODE — paren-matched
  out = rewriteCall(out, "DECODE", (argList) => {
    const args = splitArgs(argList);
    if (args.length < 3) return `DECODE(${argList})`;
    const expr = args[0]!.trim();
    const rest = args.slice(1);
    let elseClause = "NULL";
    if (rest.length % 2 === 1) elseClause = rest.pop()!.trim();
    const whens: string[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i]!.trim();
      const val = rest[i + 1]!.trim();
      if (isNullKey(key)) {
        whens.push(`WHEN ${expr} IS NULL THEN ${val}`);
      } else {
        whens.push(`WHEN ${expr} = ${key} THEN ${val}`);
      }
    }
    return `CASE ${whens.join(" ")} ELSE ${elseClause} END`;
  });

  // TO_DATE — args 1 and 2 are typically a value + a literal. The literal is
  // already masked, so we look up the placeholder via the literals[] array.
  out = rewriteCall(out, "TO_DATE", (argList) => {
    const args = splitArgs(argList);
    if (args.length !== 2) return `TO_DATE(${argList})`;
    const val = args[0]!.trim();
    const fmtRef = args[1]!.trim();
    const fmt = literalAt("", literals, fmtRef);
    if (!fmt) return `TO_DATE(${argList})`;
    const fmtInner = fmt.slice(1, -1).replace(/''/g, "'");
    return `strptime(${val}, '${convertFormat(fmtInner)}')`;
  });

  // TO_CHAR — same trick
  out = rewriteCall(out, "TO_CHAR", (argList) => {
    const args = splitArgs(argList);
    if (args.length !== 2) return `TO_CHAR(${argList})`;
    const val = args[0]!.trim();
    const fmtRef = args[1]!.trim();
    const fmt = literalAt("", literals, fmtRef);
    if (!fmt) return `TO_CHAR(${argList})`;
    const fmtInner = fmt.slice(1, -1).replace(/''/g, "'");
    return `strftime(${val}, '${convertFormat(fmtInner)}')`;
  });

  // ROWNUM — only translate when it's the SOLE WHERE predicate (ends the SQL
  // or precedes a closing paren / semicolon, with no further AND/OR).
  out = out.replace(
    /\bWHERE\s+ROWNUM\s*<=\s*(\d+)\s*(?=$|\)|;)/gi,
    "LIMIT $1",
  );
  out = out.replace(
    /\bWHERE\s+ROWNUM\s*<\s*(\d+)\s*(?=$|\)|;)/gi,
    (_m, n: string) => `LIMIT ${parseInt(n, 10) - 1}`,
  );

  return out;
}

export function translate(sql: string): string {
  const { masked, literals } = maskStrings(sql);
  const rewritten = rewriteSegment(masked, literals);
  return unmaskStrings(rewritten, literals);
}
