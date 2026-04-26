import type oracledb from "oracledb";
import type { ConnectionSafety, OpenSessionParams } from "./oracle";
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
  _sessionSafety = {};
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

let _sessionParams: OpenSessionParams | null = null;
let _sessionSafety: ConnectionSafety = {};

export function setSessionParams(p: OpenSessionParams): void {
  _sessionParams = p;
}

export function getSessionParams(): OpenSessionParams | null {
  return _sessionParams;
}

export function setSessionSafety(s: ConnectionSafety): void {
  _sessionSafety = s ?? {};
}

export function getSessionSafety(): ConnectionSafety {
  return _sessionSafety;
}

// Serializes openSession/closeSession across the process so concurrent
// requests cannot race and orphan a connection.
let _sessionMutex: Promise<void> = Promise.resolve();

export async function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  const prior = _sessionMutex;
  let release!: () => void;
  _sessionMutex = new Promise<void>((res) => {
    release = res;
  });
  try {
    await prior;
    return await fn();
  } finally {
    release();
  }
}
