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
