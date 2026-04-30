import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHeader, HEADER_SIZE } from "./header";
import { writeManifest, type VskManifest } from "./manifest";
import type { DuckDBHost } from "../duckdb-host";

const TABLE_TAG_PREFIX = "__VSK_TABLE__";

/**
 * Pack a DuckDB-resident sandbox into a single `.vsk` file.
 *
 * The data section is a concatenation of per-table blocks:
 *   `<TABLE_TAG_PREFIX><NAME>\n<8-byte LE size><parquet bytes>`
 *
 * Tables are written in the order they appear in `manifest.tables`. The
 * reader uses the same order to re-create them.
 */
export async function writeVsk(
  src: DuckDBHost,
  outPath: string,
  manifest: VskManifest,
): Promise<void> {
  const tmpParquet = join(tmpdir(), `vsk-write-${process.pid}-${Date.now()}.parquet`);
  const dataParts: Buffer[] = [];

  try {
    for (const table of manifest.tables) {
      const tNameSafe = table.name.toLowerCase().replace(/"/g, '""');
      const tmpEsc = tmpParquet.replace(/\\/g, "/").replace(/'/g, "''");
      await src.exec(
        `COPY (SELECT * FROM "${tNameSafe}") TO '${tmpEsc}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
      );
      const parquetBytes = await Bun.file(tmpParquet).bytes();
      const tag = new TextEncoder().encode(`${TABLE_TAG_PREFIX}${table.name}\n`);
      const sizeBuf = new Uint8Array(8);
      new DataView(sizeBuf.buffer).setBigUint64(0, BigInt(parquetBytes.byteLength), true);
      dataParts.push(Buffer.from(tag), Buffer.from(sizeBuf), Buffer.from(parquetBytes));
    }
  } finally {
    try { await Bun.file(tmpParquet).delete(); } catch { /* best effort */ }
  }

  const dataSection = Buffer.concat(dataParts);
  const manifestBytes = writeManifest(manifest);

  const manifestOffset = BigInt(HEADER_SIZE);
  const manifestLength = BigInt(manifestBytes.byteLength);
  const dataOffset = manifestOffset + manifestLength;
  const dataLength = BigInt(dataSection.byteLength);

  const header = writeHeader({
    manifestOffset,
    manifestLength,
    dataOffset,
    dataLength,
    envelopeOffset: 0n,
    envelopeLength: 0n,
  });

  const out = Buffer.concat([Buffer.from(header), Buffer.from(manifestBytes), dataSection]);
  writeFileSync(outPath, out);
}
