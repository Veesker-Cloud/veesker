// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { format } from "sql-formatter";

const PLSQL_BLOCK_RE =
  /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+)?(?:PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b|DECLARE\b|BEGIN\b)/i;

// Oracle-specific keyword fragments that sql-formatter doesn't always uppercase
const ORACLE_KEYWORDS_RE =
  /\b(or\s+replace|editionable|noneditionable|deterministic|authid|current_user|definer|invoker_rights|pipelined|parallel_enable|result_cache|aggregate|using)\b/gi;

function postProcess(sql: string): string {
  return (
    sql
      // sql-formatter splits `CREATE\nOR REPLACE` across lines — rejoin
      .replace(/\bCREATE\s*\n(\s*)OR\s+/gi, "CREATE OR ")
      // Uppercase remaining Oracle keywords that the formatter misses
      .replace(ORACLE_KEYWORDS_RE, (m) => m.toUpperCase())
  );
}

export function formatSql(sql: string, isPlsql?: boolean): string {
  const usePlsql = isPlsql ?? PLSQL_BLOCK_RE.test(sql);

  const result = format(sql, {
    language: "plsql",
    tabWidth: 2,
    keywordCase: "upper",
    functionCase: "upper",
    identifierCase: "preserve",
    dataTypeCase: "upper",
    expressionWidth: usePlsql ? 100 : 80,
    linesBetweenQueries: 2,
    logicalOperatorNewline: "before",
    indentStyle: "standard",
  });

  return usePlsql ? postProcess(result) : result;
}
