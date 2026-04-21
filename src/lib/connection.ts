import { invoke } from "@tauri-apps/api/core";

export type ConnectionConfig = {
  host: string;
  port: number;
  serviceName: string;
  username: string;
  password: string;
};

export type ConnectionTestOk = {
  serverVersion: string;
  elapsedMs: number;
};

export type ConnectionTestErr = {
  code: number;
  message: string;
};

export type ConnectionTestResult =
  | { ok: true; data: ConnectionTestOk }
  | { ok: false; error: ConnectionTestErr };

export async function testConnection(
  config: ConnectionConfig
): Promise<ConnectionTestResult> {
  try {
    const data = await invoke<ConnectionTestOk>("connection_test", { config });
    return { ok: true, data };
  } catch (err) {
    const error = err as ConnectionTestErr;
    return { ok: false, error };
  }
}
