import { invoke } from "@tauri-apps/api/core";
import type { Result, WorkspaceError } from "$lib/workspace";

export type QueryColumn = { name: string; dataType: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};

export async function queryExecute(sql: string): Promise<Result<QueryResult>> {
  try {
    const data = await invoke<QueryResult>("query_execute", { sql });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}
