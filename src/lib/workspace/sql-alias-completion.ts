// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { EditorState } from "@codemirror/state";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const SQL_KW = new Set([
  "WHERE", "ON", "SET", "INNER", "LEFT", "RIGHT", "OUTER", "CROSS", "FULL",
  "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL",
  "SELECT", "FROM", "JOIN", "GROUP", "ORDER", "BY", "HAVING", "UNION", "ALL",
  "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END", "INSERT", "UPDATE",
  "DELETE", "MERGE", "WITH", "AS", "NATURAL", "START", "CONNECT", "PIVOT",
  "UNPIVOT", "MODEL", "PARTITION", "ROWS", "RANGE", "OVER", "WITHIN",
]);

function buildAliasMap(doc: string): Map<string, string> {
  const map = new Map<string, string>();
  // Matches: FROM/JOIN "TABLE" alias  or  FROM/JOIN TABLE alias  (with optional AS)
  const re = /(?:FROM|JOIN)\s+"?([A-Z0-9_$#]+)"?\s+(?:AS\s+)?([A-Z0-9_$#]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const table = m[1].toUpperCase();
    const alias = m[2].toUpperCase();
    if (!SQL_KW.has(alias)) map.set(alias, table);
    // table name itself also resolves (e.g. EMPLOYEES.EMPLOYEE_ID)
    map.set(table, table);
  }
  return map;
}

export function makeAliasCompletionExtension(
  getColumns: (table: string) => Promise<string[]>
) {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.matchBefore(/\w+\./);
    if (!before) return null;
    const alias = before.text.slice(0, -1).toUpperCase();
    const table = buildAliasMap(ctx.state.doc.toString()).get(alias);
    if (!table) return null;
    const cols = await getColumns(table);
    if (!cols.length) return null;
    return {
      from: before.to,
      options: cols.map((col) => ({ label: col, type: "property" })),
      validFor: /^\w*$/,
    };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
