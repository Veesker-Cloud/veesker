// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { FEATURES } from "./features";

type CloudEntry = {
  occurredAt: string;
  connectionId: string | null;
  connectionName: string | null;
  host: string | null;
  sql: string;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
  clientVersion: string | null;
};

const FLUSH_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
const MAX_BUFFER = 500;

let _buffer: CloudEntry[] = [];
let _interval: ReturnType<typeof setInterval> | null = null;
let _clientVersion: string | null = null;

async function resolveClientVersion(): Promise<string> {
  if (_clientVersion) return _clientVersion;
  try {
    _clientVersion = await getVersion();
  } catch {
    _clientVersion = "unknown";
  }
  return _clientVersion;
}

async function flush(): Promise<void> {
  if (_buffer.length === 0) return;
  const batch = _buffer.splice(0, BATCH_SIZE);
  try {
    await invoke("cloud_api_post", { path: "/v1/audit/ingest", body: { entries: batch } });
  } catch {
    if (_buffer.length < MAX_BUFFER) {
      _buffer = [...batch, ..._buffer];
    }
  }
}

export const CloudAuditService = {
  async push(entry: {
    connectionId: string | null;
    connectionName: string | null;
    host: string | null;
    sql: string;
    success: boolean;
    rowCount: number | null;
    elapsedMs: number;
    errorCode: number | null;
    errorMessage: string | null;
  }): Promise<void> {
    if (!FEATURES.cloudAudit) return;
    const clientVersion = await resolveClientVersion();
    _buffer.push({
      occurredAt: new Date().toISOString(),
      connectionId: entry.connectionId || null,
      connectionName: entry.connectionName || null,
      host: entry.host || null,
      sql: entry.sql,
      success: entry.success,
      rowCount: entry.rowCount,
      elapsedMs: entry.elapsedMs,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
      clientVersion,
    });
    if (_buffer.length >= BATCH_SIZE) {
      void flush();
    }
  },

  start(): void {
    if (_interval) return;
    _interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  },

  stop(): void {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
    void flush();
  },
};
