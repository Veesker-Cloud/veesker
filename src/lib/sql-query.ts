import { invoke } from "@tauri-apps/api/core";
import type { Result, WorkspaceError } from "$lib/workspace";

export type QueryColumn = { name: string; dataType: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};

// Server-side discriminated union for multi-statement results.
export type ServerStatementResult =
  | { status: "ok"; statementIndex: number; sql: string; elapsedMs: number; columns: QueryColumn[]; rows: unknown[][]; rowCount: number }
  | { status: "error"; statementIndex: number; sql: string; elapsedMs: number; error: { code: number; message: string } }
  | { status: "cancelled"; statementIndex: number; sql: string; elapsedMs: number };

export type MultiQueryResult = { multi: true; results: ServerStatementResult[] };

export async function queryExecute(sql: string, requestId: string): Promise<Result<QueryResult>> {
  try {
    const data = await invoke<QueryResult>("query_execute", { sql, requestId, splitMulti: false });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function queryExecuteMulti(sql: string, requestId: string): Promise<Result<MultiQueryResult>> {
  try {
    const data = await invoke<MultiQueryResult>("query_execute", { sql, requestId, splitMulti: true });
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
