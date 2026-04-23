export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines: string[] = [columns.map(quoteField).join(",")];
  for (const row of rows) {
    lines.push(row.map(formatValue).map(quoteField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function toJson(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const v = row[i];
      obj[columns[i]] = v instanceof Date ? v.toISOString() : (v ?? null);
    }
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function quoteField(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toInsertSql(tableName: string, columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "";
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const lines: string[] = [];
  for (const row of rows) {
    const values = row.map(insertValue).join(", ");
    lines.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${values});`);
  }
  return lines.join("\n") + "\n";
}

function insertValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    if (iso.endsWith("T00:00:00.000Z")) return `TO_DATE('${iso.slice(0, 10)}','YYYY-MM-DD')`;
    return `TIMESTAMP '${iso.replace("T", " ").slice(0, 19)}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
