import { invoke } from "@tauri-apps/api/core";

export type WorkspaceInfo = { serverVersion: string; currentSchema: string };
export type Schema = { name: string; isCurrent: boolean };
export type ObjectKind = "TABLE" | "VIEW" | "SEQUENCE";
export type ObjectRef = { name: string };
export type Column = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  dataDefault: string | null;
  comments: string | null;
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: Column[];
  indexes: IndexDef[];
  rowCount: number | null;
};

export type WorkspaceError = { code: number; message: string };

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: WorkspaceError };

export type Loadable<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  | { kind: "err"; message: string };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const workspaceOpen  = (connectionId: string) =>
  call<WorkspaceInfo>("workspace_open", { connectionId });
export const workspaceClose = () =>
  call<void>("workspace_close");
export const schemaList     = () =>
  call<Schema[]>("schema_list");
export const objectsList    = (owner: string, kind: ObjectKind) =>
  call<ObjectRef[]>("objects_list", { owner, kind });
export const tableDescribe  = (owner: string, name: string) =>
  call<TableDetails>("table_describe", { owner, name });

export const NO_ACTIVE_SESSION = -32010;
export const SESSION_LOST      = -32011;
export const OBJECT_NOT_FOUND  = -32012;
export const ORACLE_ERR        = -32013;
