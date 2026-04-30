import { describe, expect, it } from "bun:test";
import { writeHeader, readHeader, VSK_MAGIC, VSK_VERSION } from "../src/vsk-format/header";
import { writeManifest, readManifest, type VskManifest } from "../src/vsk-format/manifest";

describe("vsk-format header", () => {
  it("round-trips a header", () => {
    const buf = writeHeader({
      manifestOffset: 1024n,
      manifestLength: 256n,
      dataOffset: 1280n,
      dataLength: 4096n,
      envelopeOffset: 0n,
      envelopeLength: 0n,
    });
    expect(buf.byteLength).toBe(64);
    const parsed = readHeader(buf);
    expect(parsed.magic).toBe(VSK_MAGIC);
    expect(parsed.version).toBe(VSK_VERSION);
    expect(parsed.manifestOffset).toBe(1024n);
    expect(parsed.dataLength).toBe(4096n);
  });

  it("writes magic so the on-disk bytes spell 'VSK!' in ASCII", () => {
    const buf = writeHeader({
      manifestOffset: 0n, manifestLength: 0n,
      dataOffset: 0n, dataLength: 0n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    expect(buf[0]).toBe(0x56); // 'V'
    expect(buf[1]).toBe(0x53); // 'S'
    expect(buf[2]).toBe(0x4b); // 'K'
    expect(buf[3]).toBe(0x21); // '!'
  });

  it("rejects bad magic bytes", () => {
    const buf = new Uint8Array(64);
    new DataView(buf.buffer).setUint16(4, VSK_VERSION, true);
    expect(() => readHeader(buf)).toThrow(/magic/i);
  });

  it("rejects unsupported version", () => {
    const buf = writeHeader({
      manifestOffset: 0n, manifestLength: 0n,
      dataOffset: 0n, dataLength: 0n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    new DataView(buf.buffer).setUint16(4, 999, true);
    expect(() => readHeader(buf)).toThrow(/version/i);
  });

  it("rejects a buffer smaller than HEADER_SIZE", () => {
    expect(() => readHeader(new Uint8Array(63))).toThrow(/truncated/i);
    expect(() => readHeader(new Uint8Array(0))).toThrow(/truncated/i);
  });

  it("reads a header from a sliced view in a larger buffer", () => {
    const headerBytes = writeHeader({
      manifestOffset: 4242n, manifestLength: 100n,
      dataOffset: 5000n, dataLength: 99999n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    const big = new Uint8Array(256);
    big.set(headerBytes, 100);
    const slice = big.subarray(100, 100 + 64);
    const parsed = readHeader(slice);
    expect(parsed.manifestOffset).toBe(4242n);
    expect(parsed.dataLength).toBe(99999n);
  });
});

describe("vsk-format manifest", () => {
  const sample: VskManifest = {
    builtAt: "2026-04-30T12:00:00.000Z",
    sourceId: "oracle-prod-1",
    schemaName: "ORDERS_OWNER",
    ttlExpiresAt: "2026-05-07T12:00:00.000Z",
    tables: [
      {
        name: "ORDERS",
        rowCount: 12345,
        columns: [
          { name: "ID", type: "BIGINT", nullable: false },
          { name: "TOTAL", type: "DECIMAL(18,2)", nullable: true },
        ],
      },
    ],
    piiMasks: [{ table: "ORDERS", column: "EMAIL", maskType: "hash" }],
  };

  it("round-trips a manifest", () => {
    const buf = writeManifest(sample);
    const parsed = readManifest(buf);
    expect(parsed).toEqual(sample);
  });

  it("rejects malformed JSON", () => {
    expect(() => readManifest(new TextEncoder().encode("{not json"))).toThrow();
  });

  it("rejects a manifest missing required fields", () => {
    const noTables = JSON.stringify({ builtAt: "x", sourceId: "y", schemaName: "z", ttlExpiresAt: "w", piiMasks: [] });
    expect(() => readManifest(new TextEncoder().encode(noTables))).toThrow(/malformed/i);

    const wrongType = JSON.stringify({ ...sample, builtAt: 42 });
    expect(() => readManifest(new TextEncoder().encode(wrongType))).toThrow(/malformed/i);
  });

  it("preserves unicode in schema and table names", () => {
    const unicode: VskManifest = {
      ...sample,
      schemaName: "PEDIDOS_ÇÃO",
      tables: [{ ...sample.tables[0]!, name: "CLIENTÉS", columns: sample.tables[0]!.columns }],
    };
    const parsed = readManifest(writeManifest(unicode));
    expect(parsed.schemaName).toBe("PEDIDOS_ÇÃO");
    expect(parsed.tables[0]!.name).toBe("CLIENTÉS");
  });
});
