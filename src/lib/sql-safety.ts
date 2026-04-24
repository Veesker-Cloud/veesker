export type Severity = "critical" | "destructive" | "warning";

export type DestructiveOp = {
  keyword: string;
  severity: Severity;
  description: string;
};

type Rule = { pattern: RegExp; keyword: string; severity: Severity; description: string };

const RULES: Rule[] = [
  { pattern: /\bCREATE\s+OR\s+REPLACE\b/i, keyword: "CREATE OR REPLACE", severity: "warning", description: "Overwrites existing object" },
  { pattern: /\bDROP\b/i,              keyword: "DROP",              severity: "critical",    description: "Removes object permanently" },
  { pattern: /\bTRUNCATE\b/i,          keyword: "TRUNCATE",          severity: "critical",    description: "Removes all rows; not rollbackable in Oracle" },
  { pattern: /\bMERGE\b/i,             keyword: "MERGE",             severity: "destructive", description: "May update or delete rows" },
  { pattern: /\bDELETE\b/i,            keyword: "DELETE",            severity: "destructive", description: "Removes rows permanently" },
  { pattern: /\bUPDATE\b/i,            keyword: "UPDATE",            severity: "destructive", description: "Modifies existing data" },
  { pattern: /\bALTER\b/i,             keyword: "ALTER",             severity: "warning",     description: "Modifies object structure" },
];

function stripComments(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/--[^\n]*/g, " ");
  return s;
}

export function detectDestructive(sql: string): DestructiveOp[] {
  let stripped = stripComments(sql);
  const seen = new Set<string>();
  const result: DestructiveOp[] = [];

  for (const rule of RULES) {
    if (!seen.has(rule.keyword) && rule.pattern.test(stripped)) {
      seen.add(rule.keyword);
      result.push({ keyword: rule.keyword, severity: rule.severity, description: rule.description });

      if (rule.keyword === "MERGE") {
        stripped = stripped.replace(/\bUPDATE\b/gi, " ");
      }
    }
  }
  return result;
}
