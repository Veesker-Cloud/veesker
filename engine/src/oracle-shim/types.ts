/**
 * Oracle ↔ DuckDB type adapter.
 *
 * Used by the engine to translate column declarations during sandbox
 * builds (Oracle source → DuckDB internal storage) and during system-view
 * emulation (DuckDB schema → presented as Oracle types).
 *
 * Mapping policy:
 *   - Numeric types preserve precision/scale where possible. Oracle allows
 *     NUMBER(p,-s) (rounding to the left of the decimal); DuckDB rejects
 *     DECIMAL with negative scale, so we clamp the scale to 0. The rounding
 *     semantics are dropped — values are stored at full precision instead.
 *   - String types collapse to `VARCHAR` in DuckDB; reverse-mapping uses
 *     `VARCHAR2(4000)` as a conservative Oracle equivalent.
 *   - Unknown types fall back to `VARCHAR` / `VARCHAR2(4000)` so that
 *     downstream queries don't crash on rare Oracle types we don't yet
 *     support natively (XMLTYPE, SDO_GEOMETRY, user-defined object types).
 */

export function mapOracleType(oracleType: string): string {
  const t = oracleType.trim().toUpperCase();
  if (t === "") return "VARCHAR";

  const numberMatch = t.match(/^NUMBER\s*\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\)$/);
  if (numberMatch) {
    const precision = numberMatch[1];
    const rawScale = numberMatch[2] ?? "0";
    const scale = Math.max(0, parseInt(rawScale, 10));
    return `DECIMAL(${precision},${scale})`;
  }
  if (t === "NUMBER") return "DOUBLE";

  if (/^N?VARCHAR2?\s*\(/.test(t)) return "VARCHAR";
  if (/^CHAR\s*\(/.test(t)) return "VARCHAR";
  if (t === "CLOB" || t === "NCLOB") return "VARCHAR";

  if (t === "DATE") return "TIMESTAMP";
  if (/WITH\s+(LOCAL\s+)?TIME\s+ZONE\s*$/.test(t)) return "TIMESTAMPTZ";
  if (/^TIMESTAMP(\s*\(\s*\d+\s*\))?\s*$/.test(t)) return "TIMESTAMP";

  if (t === "BLOB" || t === "BFILE" || /^RAW\s*\(/.test(t)) return "BLOB";

  if (t === "BINARY_FLOAT") return "FLOAT";
  if (t === "BINARY_DOUBLE") return "DOUBLE";
  if (t === "FLOAT" || /^FLOAT\s*\(/.test(t)) return "DOUBLE";

  return "VARCHAR";
}

export function mapDuckDBType(duckdbType: string): string {
  const t = duckdbType.trim().toUpperCase();

  const decMatch = t.match(/^DECIMAL\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (decMatch) return `NUMBER(${decMatch[1]},${decMatch[2]})`;

  if (t === "INTEGER" || t === "INT") return "NUMBER(10,0)";
  if (t === "BIGINT") return "NUMBER(19,0)";
  if (t === "SMALLINT") return "NUMBER(5,0)";
  if (t === "TINYINT") return "NUMBER(3,0)";
  if (t === "HUGEINT") return "NUMBER(38,0)";

  if (t === "VARCHAR") return "VARCHAR2(4000)";

  if (t === "TIMESTAMP WITH TIME ZONE") return "TIMESTAMP WITH TIME ZONE";
  if (t === "TIMESTAMP_NS" || t === "TIMESTAMP_MS" || t === "TIMESTAMP_S") return "TIMESTAMP";
  if (t === "TIMESTAMP") return "TIMESTAMP";
  if (t === "TIMESTAMPTZ") return "TIMESTAMP WITH TIME ZONE";

  if (t === "BLOB") return "BLOB";

  if (t === "FLOAT") return "BINARY_FLOAT";
  if (t === "DOUBLE") return "BINARY_DOUBLE";

  return "VARCHAR2(4000)";
}
