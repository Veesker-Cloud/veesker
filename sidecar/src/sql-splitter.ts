export type SplitterError = {
  line: number;
  message: string;
};

export type SplitResult = {
  statements: string[];
  errors: SplitterError[];
};

type State =
  | { kind: "Code" }
  | { kind: "InLineComment" }
  | { kind: "InBlockComment" }
  | { kind: "InSingleString" }
  | { kind: "InDoubleString" }
  | { kind: "InQString"; closer: string };

const PLSQL_BLOCK_RE =
  /^(?:DECLARE|BEGIN)\b|^CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|PACKAGE(?:\s+BODY)?|TYPE(?:\s+BODY)?)\b/i;

/** Strip all leading comments (line and block) from s, returning remaining code. */
function stripLeadingComments(s: string): string {
  let t = s.trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    if (t.startsWith("--")) {
      const nl = t.indexOf("\n");
      t = nl >= 0 ? t.slice(nl + 1).trimStart() : "";
      changed = true;
    } else if (t.startsWith("/*")) {
      const end = t.indexOf("*/");
      t = end >= 0 ? t.slice(end + 2).trimStart() : "";
      changed = true;
    }
  }
  return t;
}

function detectPlsqlStart(buf: string): boolean {
  return PLSQL_BLOCK_RE.test(stripLeadingComments(buf));
}

/** Returns true if buf contains only whitespace and/or comments — no actual code. */
function isCommentsOnly(buf: string): boolean {
  return stripLeadingComments(buf) === "";
}

function qCloser(delim: string): string {
  if (delim === "[") return "]";
  if (delim === "<") return ">";
  if (delim === "(") return ")";
  if (delim === "{") return "}";
  return delim;
}

export function splitSql(input: string): SplitResult {
  const statements: string[] = [];
  const errors: SplitterError[] = [];

  let buf = "";
  let line = 1;
  let i = 0;
  let state: State = { kind: "Code" };

  // Per-statement PL/SQL detection; once decided, cached until flush.
  let isPlsql = false;
  let plsqlChecked = false;

  function flush() {
    const trimmed = buf.trim();
    if (trimmed && !isCommentsOnly(trimmed)) {
      statements.push(trimmed);
    }
    buf = "";
    isPlsql = false;
    plsqlChecked = false;
  }

  // Check (and cache) whether the current buffer is a PL/SQL block.
  // Only check when we encounter a potential terminator.
  function checkPlsql(): boolean {
    if (!plsqlChecked) {
      isPlsql = detectPlsqlStart(buf);
      plsqlChecked = true;
    }
    return isPlsql;
  }

  const len = input.length;

  while (i < len) {
    const ch = input[i];
    const next = i + 1 < len ? input[i + 1] : "";

    if (ch === "\n") line++;

    switch (state.kind) {
      case "Code": {
        // -- line comment
        if (ch === "-" && next === "-") {
          buf += "--";
          i += 2;
          state = { kind: "InLineComment" };
          continue;
        }
        // /* block comment
        if (ch === "/" && next === "*") {
          buf += "/*";
          i += 2;
          state = { kind: "InBlockComment" };
          continue;
        }
        // Quoted identifier
        if (ch === '"') {
          buf += '"';
          i++;
          state = { kind: "InDoubleString" };
          continue;
        }
        // Single-quoted string — also handle n/N prefix and q/Q, nq/NQ prefixes
        // Detect: q'X, Q'X, nq'X, NQ'X → q-quoted
        //         n'..., N'...           → regular single-quoted (same rules as '...')
        if (
          (ch === "q" || ch === "Q") &&
          next === "'"
        ) {
          const delim = i + 2 < len ? input[i + 2] : "";
          if (delim) {
            buf += ch + "'";
            i += 2;
            const closer = qCloser(delim);
            buf += delim;
            i++;
            state = { kind: "InQString", closer };
            continue;
          }
        }
        if (
          (ch === "n" || ch === "N") &&
          (next === "q" || next === "Q") &&
          i + 2 < len && input[i + 2] === "'"
        ) {
          const delim = i + 3 < len ? input[i + 3] : "";
          if (delim) {
            buf += ch + next + "'";
            i += 3;
            const closer = qCloser(delim);
            buf += delim;
            i++;
            state = { kind: "InQString", closer };
            continue;
          }
        }
        if ((ch === "n" || ch === "N") && next === "'") {
          buf += ch + "'";
          i += 2;
          state = { kind: "InSingleString" };
          continue;
        }
        if (ch === "'") {
          buf += "'";
          i++;
          state = { kind: "InSingleString" };
          continue;
        }
        // Semicolon — terminates regular SQL
        if (ch === ";") {
          if (!checkPlsql()) {
            flush();
            i++;
            // advance line counter if newline was consumed (it wasn't — ch is ;)
            continue;
          }
          // Inside a PL/SQL block, semicolons are content
          buf += ";";
          i++;
          continue;
        }
        // Slash — terminates PL/SQL blocks when on its own line; silently ignored
        // when on its own line with no real preceding content.
        if (ch === "/") {
          // Is this slash the first non-whitespace on its line?
          const lineStart = buf.lastIndexOf("\n");
          const beforeSlash = lineStart >= 0 ? buf.slice(lineStart + 1) : buf;
          if (beforeSlash.trim() === "") {
            // Check rest of line is whitespace or EOL/EOF
            let j = i + 1;
            while (j < len && input[j] !== "\n" && (input[j] === " " || input[j] === "\t" || input[j] === "\r")) {
              j++;
            }
            if (j >= len || input[j] === "\n") {
              // Valid slash-on-own-line: terminates PL/SQL block or is silently ignored
              i = j;
              if (i < len && input[i] === "\n") {
                line++;
                i++;
              }
              flush();
              continue;
            }
          }
          buf += "/";
          i++;
          continue;
        }
        // All other characters
        buf += ch;
        i++;
        continue;
      }

      case "InLineComment": {
        if (ch === "\n") {
          buf += "\n";
          i++;
          // line already incremented above
          state = { kind: "Code" };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }

      case "InBlockComment": {
        if (ch === "*" && next === "/") {
          buf += "*/";
          i += 2;
          state = { kind: "Code" };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }

      case "InSingleString": {
        if (ch === "'" && next === "'") {
          // Escaped single quote
          buf += "''";
          i += 2;
          continue;
        }
        if (ch === "'") {
          buf += "'";
          i++;
          state = { kind: "Code" };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }

      case "InDoubleString": {
        if (ch === '"' && next === '"') {
          buf += '""';
          i += 2;
          continue;
        }
        if (ch === '"') {
          buf += '"';
          i++;
          state = { kind: "Code" };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }

      case "InQString": {
        const { closer } = state;
        if (ch === closer && next === "'") {
          buf += ch + "'";
          i += 2;
          state = { kind: "Code" };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
    }
  }

  // EOF reached — check for unterminated constructs
  switch (state.kind) {
    case "InSingleString":
      errors.push({ line, message: "Unterminated string literal" });
      break;
    case "InQString":
      errors.push({ line, message: "Unterminated string literal" });
      break;
    case "InDoubleString":
      errors.push({ line, message: "Unterminated quoted identifier" });
      break;
    case "InBlockComment":
      errors.push({ line, message: "Unterminated block comment" });
      break;
    default:
      break;
  }

  // Forgiving EOF rule: emit whatever is left (unless it's only whitespace/comments)
  if (errors.length === 0) {
    flush();
  }

  return { statements, errors };
}
