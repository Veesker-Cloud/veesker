import { invoke } from "@tauri-apps/api/core";

export type ConnectionEnv = "dev" | "staging" | "prod";

export type ConnectionSafety = {
  /** "dev" | "staging" | "prod" — undefined = unspecified */
  env?: ConnectionEnv;
  /** when true, sidecar refuses DML/DDL on this connection */
  readOnly: boolean;
  /** per-statement timeout (ms); undefined / 0 = unlimited */
  statementTimeoutMs?: number;
  /** when true, warn before UPDATE/DELETE without WHERE */
  warnUnsafeDml: boolean;
};

export const DEFAULT_SAFETY: ConnectionSafety = {
  env: undefined,
  readOnly: false,
  statementTimeoutMs: undefined,
  warnUnsafeDml: false,
};

type SafetyFields = ConnectionSafety;

export type ConnectionMeta =
  | ({
      authType: "basic";
      id: string;
      name: string;
      host: string;
      port: number;
      serviceName: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    } & SafetyFields)
  | ({
      authType: "wallet";
      id: string;
      name: string;
      connectAlias: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    } & SafetyFields);

export type ConnectionFull = {
  meta: ConnectionMeta;
  passwordSet: boolean;
  walletPasswordSet?: boolean;
};

export type ConnectionInput =
  | {
      authType: "basic";
      id?: string;
      name: string;
      host: string;
      port: number;
      serviceName: string;
      username: string;
      password: string;
      safety?: ConnectionSafety;
    }
  | {
      authType: "wallet";
      id?: string;
      name: string;
      walletZipPath?: string;
      walletPassword: string;
      connectAlias: string;
      username: string;
      password: string;
      safety?: ConnectionSafety;
    };

export type WalletInfo = { aliases: string[] };

export type ConnectionError = { code: number; message: string };

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ConnectionError };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as ConnectionError };
  }
}

export const listConnections = () => call<ConnectionMeta[]>("connection_list");
export const getConnection = (id: string) => call<ConnectionFull>("connection_get", { id });
export const saveConnection = (input: ConnectionInput) =>
  call<ConnectionMeta>("connection_save", { input });
export const deleteConnection = (id: string) => call<void>("connection_delete", { id });
export const walletInspect = (zipPath: string) =>
  call<WalletInfo>("wallet_inspect", { zipPath });
