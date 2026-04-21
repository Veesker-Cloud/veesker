import { invoke } from "@tauri-apps/api/core";

export type ConnectionMeta =
  | {
      authType: "basic";
      id: string;
      name: string;
      host: string;
      port: number;
      serviceName: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    }
  | {
      authType: "wallet";
      id: string;
      name: string;
      connectAlias: string;
      username: string;
      createdAt: string;
      updatedAt: string;
    };

export type ConnectionFull = {
  meta: ConnectionMeta;
  password: string;
  passwordMissing: boolean;
  walletPassword?: string;
  walletPasswordMissing?: boolean;
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
