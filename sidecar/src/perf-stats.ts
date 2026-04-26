import oracledb from "oracledb";
import { withActiveSession } from "./oracle";

export type PerfTableIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  status: string;
};

export type PerfTableStats = {
  owner: string;
  name: string;
  numRows: number | null;
  lastAnalyzed: string | null;
  blocks: number | null;
  indexes: PerfTableIndex[];
};

export type PerfStatsResult = {
  tables: PerfTableStats[];
};

export type TableRef = { owner: string | null; name: string };

const FROM_PATTERN =
  /\b(?:FROM|JOIN)\s+(?:([a-zA-Z_]\w*)\s*\.\s*)?([a-zA-Z_]\w*)/gi;

// Why: original spec used a character-class lookahead that mis-parsed names
// like "DEPT" (the trailing "T" lived inside the class). Switched to a
// boundary-style lookahead that ends the table name at end-of-string,
// comma, paren, or whitespace — which is what the comma-join shape needs.
const COMMA_FROM_PATTERN =
  /,\s*(?:([a-zA-Z_]\w*)\s*\.\s*)?([a-zA-Z_]\w*)(?:\s+[a-zA-Z_]\w*)?(?=\s*(?:,|\)|$|\s))/gi;

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*\n?/g, " ");
}

export function extractTableNames(sql: string): TableRef[] {
  const cleaned = stripComments(sql).trim();
  if (!/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|MERGE)/i.test(cleaned)) {
    return [];
  }
  const seen = new Set<string>();
  const refs: TableRef[] = [];
  for (const re of [FROM_PATTERN, COMMA_FROM_PATTERN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(cleaned)) !== null) {
      const owner = m[1] ? m[1].toUpperCase() : null;
      const name = m[2].toUpperCase();
      const key = `${owner ?? ""}.${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ owner, name });
      }
    }
  }
  return refs;
}

let _testSession: oracledb.Connection | null = null;

/** Test seam — overrides the active session lookup with a stub connection. */
export function setTestSession(conn: oracledb.Connection | null): void {
  _testSession = conn;
}

async function withConn<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  if (_testSession !== null) return fn(_testSession);
  return withActiveSession(fn);
}

export async function tablesStats(p: { sql: string }): Promise<PerfStatsResult> {
  const refs = extractTableNames(p.sql);
  if (refs.length === 0) return { tables: [] };

  return withConn(async (conn) => {
    const binds: Record<string, string> = {};
    const tableConds: string[] = [];
    const indexConds: string[] = [];
    refs.forEach((r, i) => {
      const nKey = `n${i}`;
      binds[nKey] = r.name;
      if (r.owner !== null) {
        const oKey = `o${i}`;
        binds[oKey] = r.owner;
        tableConds.push(`(owner = :${oKey} AND table_name = :${nKey})`);
        indexConds.push(`(ic.table_owner = :${oKey} AND ic.table_name = :${nKey})`);
      } else {
        tableConds.push(`(table_name = :${nKey})`);
        indexConds.push(`(ic.table_name = :${nKey})`);
      }
    });

    const tablesRes = await conn.execute<{
      OWNER: string;
      TABLE_NAME: string;
      NUM_ROWS: number | null;
      LAST_ANALYZED: Date | null;
      BLOCKS: number | null;
    }>(
      `SELECT owner AS "OWNER",
              table_name AS "TABLE_NAME",
              num_rows AS "NUM_ROWS",
              last_analyzed AS "LAST_ANALYZED",
              blocks AS "BLOCKS"
         FROM ALL_TABLES
        WHERE ${tableConds.join(" OR ")}`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const tableRows = tablesRes.rows ?? [];
    if (tableRows.length === 0) return { tables: [] };

    const indexRes = await conn.execute<{
      TABLE_OWNER: string;
      TABLE_NAME: string;
      INDEX_NAME: string;
      COLUMN_NAME: string;
      COLUMN_POSITION: number;
      UNIQUENESS: string;
      STATUS: string;
    }>(
      `SELECT ic.table_owner AS "TABLE_OWNER",
              ic.table_name  AS "TABLE_NAME",
              ic.index_name  AS "INDEX_NAME",
              ic.column_name AS "COLUMN_NAME",
              ic.column_position AS "COLUMN_POSITION",
              i.uniqueness   AS "UNIQUENESS",
              i.status       AS "STATUS"
         FROM ALL_IND_COLUMNS ic
         JOIN ALL_INDEXES i
           ON i.owner = ic.index_owner
          AND i.index_name = ic.index_name
        WHERE ${indexConds.join(" OR ")}
        ORDER BY ic.table_owner, ic.table_name, ic.index_name, ic.column_position`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const indexRows = indexRes.rows ?? [];

    type IdxKey = string;
    const indexMap = new Map<IdxKey, { table: string; owner: string; index: PerfTableIndex }>();
    for (const r of indexRows) {
      const key = `${r.TABLE_OWNER}.${r.TABLE_NAME}.${r.INDEX_NAME}`;
      let entry = indexMap.get(key);
      if (!entry) {
        entry = {
          table: r.TABLE_NAME,
          owner: r.TABLE_OWNER,
          index: {
            name: r.INDEX_NAME,
            columns: [],
            unique: r.UNIQUENESS === "UNIQUE",
            status: r.STATUS,
          },
        };
        indexMap.set(key, entry);
      }
      entry.index.columns.push(r.COLUMN_NAME);
    }

    const tables: PerfTableStats[] = tableRows.map((t) => {
      const indexes: PerfTableIndex[] = [];
      for (const v of indexMap.values()) {
        if (v.owner === t.OWNER && v.table === t.TABLE_NAME) {
          indexes.push(v.index);
        }
      }
      return {
        owner: t.OWNER,
        name: t.TABLE_NAME,
        numRows: t.NUM_ROWS,
        lastAnalyzed: t.LAST_ANALYZED ? t.LAST_ANALYZED.toISOString() : null,
        blocks: t.BLOCKS,
        indexes,
      };
    });

    return { tables };
  });
}
