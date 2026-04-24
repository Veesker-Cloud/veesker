import { invoke } from "@tauri-apps/api/core";
import type { Result } from "$lib/workspace";

export type HistoryEntry = {
  id: number;
  connectionId: string;
  sql: string;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
  executedAt: string;
};

export type HistorySaveInput = {
  connectionId: string;
  sql: string;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
  username: string | null;
  host: string | null;
};

export async function historyList(
  connectionId: string,
  limit: number,
  offset: number,
  search?: string,
): Promise<Result<HistoryEntry[]>> {
  try {
    const data = await invoke<HistoryEntry[]>("history_list", {
      connectionId,
      limit,
      offset,
      search: search ?? null,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function historySave(input: HistorySaveInput): Promise<Result<number>> {
  try {
    const data = await invoke<number>("history_save", { input });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function historyClear(connectionId: string): Promise<Result<number>> {
  try {
    const data = await invoke<number>("history_clear", { connectionId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}
