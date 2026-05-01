import type { DuckDBHost } from "../duckdb-host";
import { mapDuckDBType } from "./types";

/**
 * Drop and rebuild Oracle-style metadata views inside a DuckDB host.
 *
 * Populates two tables (vsk_-prefixed to avoid colliding with user tables
 * that may legitimately be named `user_objects` / `user_tab_columns` —
 * Oracle-style USER_OBJECTS exports lowercased on load would otherwise
 * silently overwrite the system view):
 *   - `VSK_USER_OBJECTS(object_name, object_type, status, created, last_ddl_time)`
 *     — one row per non-system table.
 *   - `VSK_USER_TAB_COLUMNS(table_name, column_name, data_type, data_length, nullable, column_id)`
 *     — one row per column with Oracle-mapped data_type.
 *
 * Idempotent: safe to call multiple times. Subsequent calls fully refresh
 * the views to reflect the current `information_schema` state — handy
 * after DDL.
 *
 * Refresh atomicity: uses `CREATE OR REPLACE TABLE` rather than DROP+CREATE
 * to avoid leaving the host in a half-rebuilt state if a step fails.
 *
 * Performance: emits exactly two batch INSERTs per call (one per view) so
 * a sandbox with hundreds of tables doesn't pay thousands of round-trips.
 *
 * Notes:
 *   - Object names are upper-cased on output (Oracle convention).
 *   - DuckDB types are mapped to Oracle equivalents via `mapDuckDBType`.
 *   - The system-view tables themselves are excluded from `VSK_USER_OBJECTS`.
 *   - `data_length` is a placeholder (4000) for v1 — real Oracle byte
 *     lengths come in Plan 7.
 *   - The `owner` parameter is informational; the views currently expose
 *     only the host's `main` schema (DuckDB default). Reserved for
 *     multi-schema support.
 */
export async function installSystemViews(host: DuckDBHost, owner?: string): Promise<void> {
  void owner;

  await host.exec(`
    CREATE OR REPLACE TABLE vsk_user_objects (
      object_name VARCHAR,
      object_type VARCHAR,
      status VARCHAR,
      created TIMESTAMP,
      last_ddl_time TIMESTAMP
    )
  `);
  await host.exec(`
    CREATE OR REPLACE TABLE vsk_user_tab_columns (
      table_name VARCHAR,
      column_name VARCHAR,
      data_type VARCHAR,
      data_length INTEGER,
      nullable VARCHAR,
      column_id INTEGER
    )
  `);

  const tables = await host.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_name NOT IN ('vsk_user_objects', 'vsk_user_tab_columns')
    ORDER BY table_name
  `);

  if (tables.length === 0) return;

  const objectRows: string[] = [];
  const columnRows: string[] = [];

  for (const row of tables) {
    const tName = String(row.table_name);
    const tNameUpper = tName.toUpperCase();

    objectRows.push(
      `(${sqlStr(tNameUpper)}, 'TABLE', 'VALID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );

    const cols = await host.query(`
      SELECT column_name, data_type, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'main' AND table_name = ${sqlStr(tName)}
      ORDER BY ordinal_position
    `);
    for (const c of cols) {
      const colName = String(c.column_name).toUpperCase();
      const oraType = mapDuckDBType(String(c.data_type));
      const nullable = String(c.is_nullable) === "YES" ? "Y" : "N";
      const colId = Number(c.ordinal_position);
      columnRows.push(
        `(${sqlStr(tNameUpper)}, ${sqlStr(colName)}, ${sqlStr(oraType)}, 4000, ${sqlStr(nullable)}, ${colId})`,
      );
    }
  }

  if (objectRows.length > 0) {
    await host.exec(`INSERT INTO vsk_user_objects VALUES ${objectRows.join(", ")}`);
  }
  if (columnRows.length > 0) {
    await host.exec(`INSERT INTO vsk_user_tab_columns VALUES ${columnRows.join(", ")}`);
  }
}

/** Quote a string as a DuckDB SQL literal — escapes embedded `'` via `''`. */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
