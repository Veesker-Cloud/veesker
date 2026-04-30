// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { mkdirSync, appendFileSync, existsSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Lightweight rotating log file for the sidecar. Production builds run as a
 * compiled binary spawned by Tauri — its stderr is captured but goes nowhere
 * useful for users debugging their own setup. We write a parallel log file
 * under VEESKER_LOG_DIR (set by the Tauri host to app_data/logs).
 *
 * Levels are numeric so we can filter cheaply via env. Default is "info".
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

function envLevel(): number {
  const raw = (process.env.VEESKER_LOG_LEVEL ?? "info").toLowerCase();
  return (LEVELS as Record<string, number>)[raw] ?? LEVELS.info;
}

function logDir(): string | null {
  const dir = process.env.VEESKER_LOG_DIR;
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

function rotate(path: string): void {
  // 5 MB cap, keep one .old.
  // LOW-003 (audit 2026-04-30): use node:fs.unlinkSync instead of spawning `rm`.
  // The previous implementation silently failed on Windows (no rm in PATH),
  // which after the first rotation caused log files to grow unbounded.
  try {
    const st = statSync(path);
    if (st.size > 5 * 1024 * 1024) {
      const old = path + ".old";
      if (existsSync(old)) {
        try { unlinkSync(old); } catch { /* ENOENT: fine; other errors swallowed */ }
      }
      renameSync(path, old);
    }
  } catch {
    // file doesn't exist yet, that's fine
  }
}

function write(level: Level, msg: string): void {
  if (LEVELS[level] > envLevel()) return;
  const stamped = `${new Date().toISOString()} [${level}] ${msg}\n`;
  // Always echo to stderr for foreground / dev mode visibility.
  process.stderr.write(stamped);
  const dir = logDir();
  if (dir === null) return;
  const path = join(dir, "sidecar.log");
  rotate(path);
  try {
    appendFileSync(path, stamped, { encoding: "utf8" }); // codeql[js/http-to-file-access]
  } catch {
    // Don't let logging failures cascade.
  }
}

export const log = {
  error: (msg: string) => write("error", msg),
  warn:  (msg: string) => write("warn", msg),
  info:  (msg: string) => write("info", msg),
  debug: (msg: string) => write("debug", msg),
};
