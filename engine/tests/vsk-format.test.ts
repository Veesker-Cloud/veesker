import { describe, expect, it } from "bun:test";
import { writeHeader, readHeader, VSK_MAGIC, VSK_VERSION } from "../src/vsk-format/header";
import { writeManifest, readManifest, VSK_MASK_TYPES, type VskManifest } from "../src/vsk-format/manifest";
import { writeVsk } from "../src/vsk-format/writer";
import { readVsk } from "../src/vsk-format/reader";
import { readVskHeader, readVskManifest } from "../src/vsk-format/reader";
import { VskFormatError } from "../src/vsk-format/errors";
import { DuckDBHost } from "../src/duckdb-host";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

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

  it("accepts a manifest with optional engineVersion and dataFormat", () => {
    const withProvenance: VskManifest = {
      ...sample,
      engineVersion: "0.1.0",
      dataFormat: "parquet-streams-v1",
    };
    const parsed = readManifest(writeManifest(withProvenance));
    expect(parsed.engineVersion).toBe("0.1.0");
    expect(parsed.dataFormat).toBe("parquet-streams-v1");
  });

  it("rejects engineVersion of wrong type", () => {
    const bad = JSON.stringify({ ...sample, engineVersion: 42 });
    expect(() => readManifest(new TextEncoder().encode(bad))).toThrow(/malformed/i);
  });

  it("rejects an unknown maskType", () => {
    const bad = JSON.stringify({ ...sample, piiMasks: [{ table: "ORDERS", column: "EMAIL", maskType: "shuffle" }] });
    expect(() => readManifest(new TextEncoder().encode(bad))).toThrow(/malformed/i);
  });

  it("accepts an empty tables array and empty piiMasks", () => {
    const empty: VskManifest = { ...sample, tables: [], piiMasks: [] };
    const parsed = readManifest(writeManifest(empty));
    expect(parsed.tables).toEqual([]);
    expect(parsed.piiMasks).toEqual([]);
  });

  it("exposes VSK_MASK_TYPES as a const tuple", () => {
    expect(VSK_MASK_TYPES).toEqual(["hash", "redact", "static", "partial"]);
  });
});

describe("vsk-format writer + reader", () => {
  it("writes then reads back a sandbox", async () => {
    const path = join(tmpdir(), `vsk-test-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE customers (id INT, name VARCHAR)");
      await src.exec("INSERT INTO customers VALUES (1,'alice'),(2,'bob')");

      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{
          name: "CUSTOMERS",
          rowCount: 2,
          columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "NAME", type: "VARCHAR", nullable: true },
          ],
        }],
        piiMasks: [],
      });

      expect(existsSync(path)).toBe(true);

      const dst = await DuckDBHost.openInMemory();
      try {
        const m = await readVsk(path, dst);
        expect(m.tables.length).toBe(1);
        const rows = await dst.query("SELECT * FROM customers ORDER BY id");
        expect(rows).toEqual([
          { ID: 1, NAME: "alice" },
          { ID: 2, NAME: "bob" },
        ]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("handles multiple tables in one .vsk", async () => {
    const path = join(tmpdir(), `vsk-multi-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE orders (id INT, total DECIMAL(10,2))");
      await src.exec("INSERT INTO orders VALUES (1, 100.50), (2, 250.75)");
      await src.exec("CREATE TABLE customers (id INT, name VARCHAR)");
      await src.exec("INSERT INTO customers VALUES (1,'alice')");

      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [
          { name: "ORDERS", rowCount: 2, columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "TOTAL", type: "DECIMAL(10,2)", nullable: true },
          ]},
          { name: "CUSTOMERS", rowCount: 1, columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "NAME", type: "VARCHAR", nullable: true },
          ]},
        ],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const orderCount = await dst.query("SELECT COUNT(*) AS n FROM orders");
        expect(Number(orderCount[0]!.n)).toBe(2);
        const custCount = await dst.query("SELECT COUNT(*) AS n FROM customers");
        expect(Number(custCount[0]!.n)).toBe(1);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("preserves manifest fields exactly through round-trip", async () => {
    const path = join(tmpdir(), `vsk-manifest-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      const original = {
        builtAt: "2026-04-30T15:00:00.000Z",
        sourceId: "oracle-prod-7",
        schemaName: "MY_SCHEMA",
        ttlExpiresAt: "2026-05-30T15:00:00.000Z",
        tables: [{ name: "T", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
        engineVersion: "0.1.0",
        dataFormat: "parquet-streams-v1",
      };
      await writeVsk(src, path, original);

      const dst = await DuckDBHost.openInMemory();
      try {
        const recovered = await readVsk(path, dst);
        expect(recovered).toEqual(original);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("preserves NOT NULL constraints across writeVsk → readVsk", async () => {
    const path = join(tmpdir(), `vsk-notnull-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INTEGER NOT NULL, label VARCHAR)");
      await src.exec("INSERT INTO t VALUES (1, 'a')");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 1, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
          { name: "LABEL", type: "VARCHAR", nullable: true },
        ] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const cols = await dst.query(
          "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='t' ORDER BY ordinal_position",
        );
        expect(cols).toEqual([
          { column_name: "ID", is_nullable: "NO" },
          { column_name: "LABEL", is_nullable: "YES" },
        ]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });
});

describe("vsk-format safety + edge cases", () => {
  it("writer rejects an unsafe table name in the manifest", async () => {
    const src = await DuckDBHost.openInMemory();
    try {
      const path = join(tmpdir(), `vsk-unsafe-${process.pid}-${Date.now()}.vsk`);
      await expect(writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "../../../etc/passwd", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      })).rejects.toThrow(/invalid table name/i);
      expect(existsSync(path)).toBe(false);
    } finally {
      await src.close();
    }
  });

  it("writer rejects a table name with a newline", async () => {
    const src = await DuckDBHost.openInMemory();
    try {
      const path = join(tmpdir(), `vsk-nl-${process.pid}-${Date.now()}.vsk`);
      await expect(writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "ORDERS\nDROP", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      })).rejects.toThrow(/invalid table name/i);
    } finally {
      await src.close();
    }
  });

  it("readVsk supports replace: true to overwrite existing tables", async () => {
    const path = join(tmpdir(), `vsk-replace-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      await src.exec("INSERT INTO t VALUES (42)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 1, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await dst.exec("CREATE TABLE t (id INT)");
        await expect(readVsk(path, dst)).rejects.toThrow();
        await readVsk(path, dst, { replace: true });
        const rows = await dst.query("SELECT id FROM t");
        expect(rows).toEqual([{ ID: 42 }]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("round-trips an empty tables array", async () => {
    const path = join(tmpdir(), `vsk-empty-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [],
        piiMasks: [],
      });
      const dst = await DuckDBHost.openInMemory();
      try {
        const m = await readVsk(path, dst);
        expect(m.tables).toEqual([]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("round-trips a 0-row table", async () => {
    const path = join(tmpdir(), `vsk-zero-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE empty (id INT, label VARCHAR)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "EMPTY", rowCount: 0, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
          { name: "LABEL", type: "VARCHAR", nullable: true },
        ] }],
        piiMasks: [],
      });
      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const rows = await dst.query("SELECT * FROM empty");
        expect(rows).toEqual([]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("readVskHeader does not load the whole file (smoke)", async () => {
    const path = join(tmpdir(), `vsk-cheap-header-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      await src.exec("INSERT INTO t SELECT range FROM range(0, 100)");
      await writeVsk(src, path, {
        builtAt: "2026-04-30T12:00:00.000Z",
        sourceId: "x",
        schemaName: "X",
        ttlExpiresAt: "2026-05-07T12:00:00.000Z",
        tables: [{ name: "T", rowCount: 100, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      });
      const header = readVskHeader(path);
      expect(header.version).toBe(1);
      const m = readVskManifest(path);
      expect(m.schemaName).toBe("X");
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("VskFormatError is thrown with the right code on bad magic", () => {
    const buf = new Uint8Array(64);
    new DataView(buf.buffer).setUint16(4, 1, true);
    try {
      readHeader(buf);
      throw new Error("readHeader should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VskFormatError);
      expect((err as VskFormatError).code).toBe("BAD_MAGIC");
    }
  });
});
