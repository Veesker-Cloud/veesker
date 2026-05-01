import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DuckDBHost } from "../../duckdb-host";
import { writeVsk } from "../../vsk-format/writer";
import { assertValidTableName, VSK_TABLE_NAME_RE } from "../../vsk-format/errors";
import type { VskManifest, VskTable } from "../../vsk-format/manifest";

/**
 * Allowlist for `column.type` strings in the schema JSON. Permits:
 *  - Bare type names: `INTEGER`, `VARCHAR`, `BINARY_FLOAT`, `TIMESTAMP_NS`
 *  - Parameterized: `VARCHAR(100)`, `DECIMAL(10,2)`, `NUMBER(p,-s)`
 *  - Multi-word from an explicit allowlist: `TIMESTAMP WITH TIME ZONE`,
 *    `TIMESTAMP WITH LOCAL TIME ZONE`, `DOUBLE PRECISION`
 *
 * Rejects intra-DDL injection: NO top-level commas (which would inject a
 * phantom column past the declared one), NO semicolons (which would close
 * the DDL), NO quotes, and NO unrecognized multi-word constructs like
 * `INTEGER PRIMARY KEY` or `INTEGER CHECK (1=1)` that the previous regex
 * ([A-Za-z0-9 (),]) inadvertently allowed.
 */
const COLUMN_TYPE_SINGLE = /^[A-Za-z][A-Za-z0-9_]*$/;
const COLUMN_TYPE_PARAM = /^([A-Za-z][A-Za-z0-9_]*)\(\s*\d+(?:\s*,\s*-?\d+)?\s*\)$/;
const ALLOWED_MULTI_WORD = new Set([
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP WITH LOCAL TIME ZONE",
  "DOUBLE PRECISION",
]);

function assertValidColumnType(type: string): void {
  const trimmed = type.trim();
  if (COLUMN_TYPE_SINGLE.test(trimmed)) return;
  if (COLUMN_TYPE_PARAM.test(trimmed)) return;
  if (ALLOWED_MULTI_WORD.has(trimmed.toUpperCase())) return;
  throw new Error(
    `invalid column type ${JSON.stringify(type).slice(0, 80)}`,
  );
}

function assertValidColumnName(name: string): void {
  if (!VSK_TABLE_NAME_RE.test(name)) {
    throw new Error(
      `invalid column name ${JSON.stringify(name).slice(0, 80)}`,
    );
  }
}

interface SchemaJson {
  schemaName: string;
  ttlDays: number;
  tables: Array<{
    name: string;
    csv: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>;
}

function readSchema(path: string): SchemaJson {
  const raw = readFileSync(path, "utf8");
  const obj = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("schema must be a JSON object");
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.schemaName !== "string") throw new Error("schema.schemaName must be a string");
  if (typeof o.ttlDays !== "number" || !Number.isFinite(o.ttlDays) || o.ttlDays <= 0) {
    throw new Error("schema.ttlDays must be a positive number");
  }
  if (!Array.isArray(o.tables)) throw new Error("schema.tables must be an array");
  for (const t of o.tables) {
    if (typeof t !== "object" || t === null) throw new Error("each table must be an object");
    const tt = t as Record<string, unknown>;
    if (typeof tt.name !== "string") throw new Error("table.name must be a string");
    if (typeof tt.csv !== "string") throw new Error("table.csv must be a string");
    if (!Array.isArray(tt.columns)) throw new Error("table.columns must be an array");
    for (const c of tt.columns) {
      if (typeof c !== "object" || c === null) throw new Error("each column must be an object");
      const cc = c as Record<string, unknown>;
      if (typeof cc.name !== "string") throw new Error("column.name must be a string");
      assertValidColumnName(cc.name);
      if (typeof cc.type !== "string") throw new Error("column.type must be a string");
      assertValidColumnType(cc.type);
      if (typeof cc.nullable !== "boolean") throw new Error("column.nullable must be a boolean");
    }
  }
  return obj as SchemaJson;
}

/**
 * Register the `create` subcommand on the given commander program.
 *
 * Trust model: the schema JSON is treated as trusted-author input. Each
 * `csv` path is read from the local filesystem; each `column.type` is
 * interpolated into a `CREATE TABLE` DDL after the
 * {@link assertValidColumnType} allowlist check, and each `column.name`
 * passes through {@link assertValidColumnName}. Each `table.name` passes
 * through `assertValidTableName` before any DB work.
 *
 * Do NOT consume schemas from untrusted sources without additional
 * sandboxing — even with the allowlist, a malicious author could exhaust
 * disk by pointing `csv` at a huge file or by declaring thousands of
 * tables.
 */
export function registerCreate(program: Command): void {
  program
    .command("create")
    .description("create a .vsk sandbox from a schema JSON + CSV files")
    .requiredOption("--schema <path>", "schema JSON file")
    .requiredOption("--out <path>", "output .vsk path")
    .option("--source-id <id>", "source identifier", "local")
    .action(
      async (opts: { schema: string; out: string; sourceId: string }) => {
        const schema = readSchema(opts.schema);

        for (const t of schema.tables) {
          assertValidTableName(t.name);
        }

        const host = await DuckDBHost.openInMemory();
        const manifestTables: VskTable[] = [];

        try {
          for (const t of schema.tables) {
            const tNameSql = t.name.toLowerCase().replace(/"/g, '""');
            const colsDdl = t.columns
              .map((c) => {
                const colName = c.name.toUpperCase().replace(/"/g, '""');
                const nullClause = c.nullable ? "" : " NOT NULL";
                return `"${colName}" ${c.type}${nullClause}`;
              })
              .join(", ");

            await host.exec(`CREATE TABLE "${tNameSql}" (${colsDdl})`);

            const csvAbs = resolve(t.csv);
            const csvSql = csvAbs.replace(/\\/g, "/").replace(/'/g, "''");
            await host.exec(
              `COPY "${tNameSql}" FROM '${csvSql}' (HEADER, AUTO_DETECT FALSE)`,
            );

            const cnt = await host.query(
              `SELECT COUNT(*) AS n FROM "${tNameSql}"`,
            );
            const rowCount = Number(cnt[0]?.n ?? 0);

            manifestTables.push({
              name: t.name.toUpperCase(),
              rowCount,
              columns: t.columns.map((c) => ({
                name: c.name.toUpperCase(),
                type: c.type,
                nullable: c.nullable,
              })),
            });
          }

          const builtAt = new Date().toISOString();
          const ttlExpiresAt = new Date(
            Date.now() + schema.ttlDays * 86_400_000,
          ).toISOString();

          const manifest: VskManifest = {
            builtAt,
            sourceId: opts.sourceId,
            schemaName: schema.schemaName,
            ttlExpiresAt,
            tables: manifestTables,
            piiMasks: [],
            engineVersion: "0.1.0",
            dataFormat: "parquet-streams-v1",
          };

          await writeVsk(host, opts.out, manifest);
          console.log(
            `wrote ${opts.out} (${manifestTables.length} tables, ${manifestTables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} rows total, expires ${ttlExpiresAt})`,
          );
        } finally {
          await host.close();
        }
      },
    );
}
