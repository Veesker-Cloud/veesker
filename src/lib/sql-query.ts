import { invoke } from "@tauri-apps/api/core";
import type { Result, WorkspaceError } from "$lib/workspace";

export type QueryColumn = { name: string; dataType: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};

export async function queryExecute(sql: string, requestId: string): Promise<Result<QueryResult>> {
  try {
    const data = await invoke<QueryResult>("query_execute", { sql, requestId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function queryCancel(
  requestId: string
): Promise<Result<{ cancelled: boolean; requestId: string | null }>> {
  try {
    const data = await invoke<{ cancelled: boolean; requestId: string | null }>("query_cancel", {
      requestId,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}
