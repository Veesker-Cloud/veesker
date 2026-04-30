import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHeader, HEADER_SIZE } from "./header";
import { readManifest, type VskManifest } from "./manifest";
import type { DuckDBHost } from "../duckdb-host";

const TABLE_TAG_PREFIX = "__VSK_TABLE__";

/** Read just the header — cheap, no DB needed. Throws on malformed magic/version. */
export function readVskHeader(path: string) {
  const file = readFileSync(path);
  if (file.byteLength < HEADER_SIZE) {
    throw new Error(`vsk header truncated: file is ${file.byteLength} bytes, header needs ${HEADER_SIZE}`);
  }
  return readHeader(new Uint8Array(file.buffer, file.byteOffset, HEADER_SIZE));
}

/** Read just the manifest — cheap, no DB needed. */
export function readVskManifest(path: string): VskManifest {
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));
  const start = Number(header.manifestOffset);
  const end = start + Number(header.manifestLength);
  return readManifest(buf.subarray(start, end));
}

/**
 * Restore a `.vsk` file into a DuckDB host. Creates one DuckDB table per manifest
 * entry, lower-cased (DuckDB convention). Returns the manifest for the caller.
 */
export async function readVsk(path: string, dst: DuckDBHost): Promise<VskManifest> {
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));
  const manifest = readManifest(
    buf.subarray(
      Number(header.manifestOffset),
      Number(header.manifestOffset + header.manifestLength),
    ),
  );

  const dataStart = Number(header.dataOffset);
  const dataEnd = dataStart + Number(header.dataLength);
  let p = dataStart;
  const tagPrefix = new TextEncoder().encode(TABLE_TAG_PREFIX);

  while (p < dataEnd) {
    if (buf.byteLength - p < tagPrefix.byteLength) {
      throw new Error(`vsk: data section truncated at offset ${p}`);
    }
    for (let i = 0; i < tagPrefix.byteLength; i++) {
      if (buf[p + i] !== tagPrefix[i]) {
        throw new Error(`vsk: malformed data section at offset ${p} (expected table tag)`);
      }
    }
    const newlineIdx = buf.indexOf(0x0a, p);
    if (newlineIdx < 0 || newlineIdx >= dataEnd) {
      throw new Error(`vsk: unterminated table tag at offset ${p}`);
    }
    const tag = new TextDecoder().decode(buf.subarray(p, newlineIdx));
    const tableName = tag.slice(TABLE_TAG_PREFIX.length);
    if (!tableName) {
      throw new Error(`vsk: empty table name in tag at offset ${p}`);
    }
    p = newlineIdx + 1;
    if (p + 8 > dataEnd) {
      throw new Error(`vsk: data section truncated reading size for table ${tableName}`);
    }
    const size = Number(
      new DataView(buf.buffer, buf.byteOffset + p, 8).getBigUint64(0, true),
    );
    p += 8;
    if (p + size > dataEnd) {
      throw new Error(`vsk: data section truncated reading parquet for table ${tableName}`);
    }
    const parquetBytes = buf.subarray(p, p + size);
    p += size;

    const tmp = join(tmpdir(), `vsk-load-${process.pid}-${Date.now()}-${tableName}.parquet`);
    writeFileSync(tmp, Buffer.from(parquetBytes));
    try {
      const tmpEsc = tmp.replace(/\\/g, "/").replace(/'/g, "''");
      const tNameSafe = tableName.toLowerCase().replace(/"/g, '""');
      await dst.exec(
        `CREATE TABLE "${tNameSafe}" AS SELECT * FROM read_parquet('${tmpEsc}')`,
      );
    } finally {
      try { unlinkSync(tmp); } catch { /* best effort */ }
    }
  }

  return manifest;
}
