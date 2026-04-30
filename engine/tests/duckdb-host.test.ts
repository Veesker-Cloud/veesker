import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { DuckDBHost, DuckDBHostClosedError } from "../src/duckdb-host";

describe("DuckDBHost", () => {
  let host: DuckDBHost;

  beforeEach(async () => {
    host = await DuckDBHost.openInMemory();
  });

  afterEach(async () => {
    await host.close();
  });

  it("executes a trivial SELECT", async () => {
    const rows = await host.query("SELECT 1 AS n");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("creates and queries a table", async () => {
    await host.exec("CREATE TABLE t (id INT, name VARCHAR)");
    await host.exec("INSERT INTO t VALUES (1, 'alice'), (2, 'bob')");
    const rows = await host.query("SELECT * FROM t ORDER BY id");
    expect(rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
  });

  it("rejects query after close with typed error", async () => {
    await host.close();
    await expect(host.query("SELECT 1")).rejects.toThrow(/closed/);
    await expect(host.query("SELECT 1")).rejects.toBeInstanceOf(DuckDBHostClosedError);
  });

  it("rejects exec after close", async () => {
    await host.close();
    await expect(host.exec("CREATE TABLE x (n INT)")).rejects.toBeInstanceOf(DuckDBHostClosedError);
  });
});

describe("DuckDBHost.openFile", () => {
  it("persists a table across reopens of the same file", async () => {
    const path = join(tmpdir(), `vsk-host-test-${process.pid}-${Date.now()}.duckdb`);
    try {
      const writer = await DuckDBHost.openFile(path);
      await writer.exec("CREATE TABLE persisted (id INT, label VARCHAR)");
      await writer.exec("INSERT INTO persisted VALUES (1, 'kept'), (2, 'across-reopen')");
      await writer.close();

      expect(existsSync(path)).toBe(true);

      const reader = await DuckDBHost.openFile(path);
      try {
        const rows = await reader.query("SELECT * FROM persisted ORDER BY id");
        expect(rows).toEqual([
          { id: 1, label: "kept" },
          { id: 2, label: "across-reopen" },
        ]);
      } finally {
        await reader.close();
      }
    } finally {
      try { unlinkSync(path); } catch { /* best effort */ }
      try { unlinkSync(`${path}.wal`); } catch { /* may not exist */ }
    }
  });
});
