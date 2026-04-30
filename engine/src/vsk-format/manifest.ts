/**
 * `.vsk` manifest — JSON document describing a sandbox's contents.
 *
 * Lives at the byte range `[VskHeader.manifestOffset, manifestOffset + manifestLength)`
 * of every `.vsk` file. Serialized as UTF-8 JSON. The manifest is plaintext even when
 * the data section is encrypted; it carries no row data, only schema + recipe metadata.
 *
 * Fields:
 *   - `builtAt` / `ttlExpiresAt` — ISO-8601 strings (UTC)
 *   - `sourceId` — opaque identifier for the source system (e.g. an Oracle connection name)
 *   - `schemaName` — logical schema/owner the data was extracted from
 *   - `tables` — column-level schema for every materialized table
 *   - `piiMasks` — record of masks applied at build time (informational; does not unmask)
 */

export type VskMaskType = "hash" | "redact" | "static" | "partial";

export interface VskColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface VskTable {
  name: string;
  rowCount: number;
  columns: VskColumn[];
}

export interface VskPiiMask {
  table: string;
  column: string;
  maskType: VskMaskType;
}

export interface VskManifest {
  builtAt: string;
  sourceId: string;
  schemaName: string;
  ttlExpiresAt: string;
  tables: VskTable[];
  piiMasks: VskPiiMask[];
}

export function writeManifest(m: VskManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m));
}

export function readManifest(buf: Uint8Array): VskManifest {
  const text = new TextDecoder().decode(buf);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`vsk manifest: malformed JSON (${(err as Error).message})`);
  }
  if (!isManifest(obj)) {
    throw new Error("vsk manifest: malformed (missing or wrongly-typed required fields)");
  }
  return obj;
}

function isManifest(x: unknown): x is VskManifest {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.builtAt !== "string") return false;
  if (typeof m.sourceId !== "string") return false;
  if (typeof m.schemaName !== "string") return false;
  if (typeof m.ttlExpiresAt !== "string") return false;
  if (!Array.isArray(m.tables)) return false;
  if (!Array.isArray(m.piiMasks)) return false;
  for (const t of m.tables) if (!isTable(t)) return false;
  for (const p of m.piiMasks) if (!isMask(p)) return false;
  return true;
}

function isTable(x: unknown): x is VskTable {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  if (typeof t.name !== "string") return false;
  if (typeof t.rowCount !== "number") return false;
  if (!Array.isArray(t.columns)) return false;
  for (const c of t.columns) {
    if (typeof c !== "object" || c === null) return false;
    const col = c as Record<string, unknown>;
    if (typeof col.name !== "string") return false;
    if (typeof col.type !== "string") return false;
    if (typeof col.nullable !== "boolean") return false;
  }
  return true;
}

function isMask(x: unknown): x is VskPiiMask {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.table !== "string") return false;
  if (typeof m.column !== "string") return false;
  if (m.maskType !== "hash" && m.maskType !== "redact" && m.maskType !== "static" && m.maskType !== "partial") return false;
  return true;
}
