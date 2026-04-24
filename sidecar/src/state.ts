import type oracledb from "oracledb";
import { RpcCodedError, NO_ACTIVE_SESSION } from "./errors";

let currentSession: oracledb.Connection | null = null;
let currentSchema: string | null = null;

export function setSession(conn: oracledb.Connection, schema: string): void {
  currentSession = conn;
  currentSchema = schema;
}

export function clearSession(): void {
  currentSession = null;
  currentSchema = null;
}

export function getActiveSession(): oracledb.Connection {
  if (currentSession === null) {
    throw new RpcCodedError(
      NO_ACTIVE_SESSION,
      "No active workspace session. Call workspace.open first."
    );
  }
  return currentSession;
}

export function hasSession(): boolean {
  return currentSession !== null;
}

export function getCurrentSchema(): string | null {
  return currentSchema;
}

let _sessionParams: unknown = null;

export function setSessionParams(p: unknown): void {
  _sessionParams = p;
}

export function getSessionParams(): unknown {
  if (!_sessionParams) {
    throw new RpcCodedError(NO_ACTIVE_SESSION, "No session params stored");
  }
  return _sessionParams;
}
