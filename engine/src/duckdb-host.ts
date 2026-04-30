import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

/**
 * Thrown by {@link DuckDBHost.exec} and {@link DuckDBHost.query} when invoked
 * on a host that has already been closed. Use `instanceof` to disambiguate
 * from DuckDB-thrown SQL errors.
 */
export class DuckDBHostClosedError extends Error {
  constructor() {
    super("DuckDBHost is closed");
    this.name = "DuckDBHostClosedError";
  }
}

/**
 * Wrapper around a single `@duckdb/node-api` connection.
 *
 * Concurrency: DuckDB connections are single-threaded. Callers MUST serialize
 * calls to {@link exec} and {@link query} on the same host instance. Issuing
 * overlapping operations (e.g. via `Promise.all`) is undefined behavior and
 * may corrupt internal state. If concurrent access is needed, build multiple
 * hosts.
 *
 * Idempotency: {@link close} is safe to call repeatedly; subsequent calls
 * are no-ops.
 */
export class DuckDBHost {
  private constructor(
    private instance: DuckDBInstance,
    private conn: DuckDBConnection,
    private closed = false,
  ) {}

  static async openInMemory(): Promise<DuckDBHost> {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    return new DuckDBHost(instance, conn);
  }

  static async openFile(path: string): Promise<DuckDBHost> {
    const instance = await DuckDBInstance.create(path);
    const conn = await instance.connect();
    return new DuckDBHost(instance, conn);
  }

  async exec(sql: string): Promise<void> {
    if (this.closed) throw new DuckDBHostClosedError();
    await this.conn.run(sql);
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    if (this.closed) throw new DuckDBHostClosedError();
    const reader = await this.conn.runAndReadAll(sql);
    return reader.getRowObjects();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.conn.disconnectSync();
    } finally {
      try {
        this.instance.closeSync();
      } finally {
        this.closed = true;
      }
    }
  }
}
