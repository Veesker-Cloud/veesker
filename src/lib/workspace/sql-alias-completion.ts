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

export type TableRef = { owner: string | null; table: string };

export function buildAliasMap(doc: string): Map<string, TableRef> {
  const map = new Map<string, TableRef>();
  // Matches: FROM/JOIN [SCHEMA.]TABLE [AS] alias — handles quoted and dotted names
  const re =
    /(?:FROM|JOIN)\s+(?:"?([A-Z0-9_$#]+)"?\s*\.\s*)?"?([A-Z0-9_$#]+)"?\s+(?:AS\s+)?([A-Z0-9_$#]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const owner = m[1] ? m[1].toUpperCase() : null;
    const table = m[2].toUpperCase();
    const alias = m[3].toUpperCase();
    const ref: TableRef = { owner, table };
    if (!SQL_KW.has(alias)) map.set(alias, ref);
    // The table name itself also resolves so EMPLOYEES.SALARY works without alias.
    map.set(table, ref);
  }
  return map;
}

export function makeAliasCompletionExtension(
  getColumns: (table: string, owner: string | null) => Promise<string[]>
) {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.matchBefore(/\w+\./);
    if (!before) return null;
    const alias = before.text.slice(0, -1).toUpperCase();
    const ref = buildAliasMap(ctx.state.doc.toString()).get(alias);
    if (!ref) return null;
    const cols = await getColumns(ref.table, ref.owner);
    if (!cols.length) return null;
    return {
      from: before.to,
      options: cols.map((col) => ({ label: col, type: "property" })),
      validFor: /^\w*$/,
    };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
