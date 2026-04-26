#!/usr/bin/env bun
/**
 * Copies node-oracledb's prebuilt native bindings (.node files) from
 * sidecar/node_modules/oracledb/build/Release/ into src-tauri/oracledb-bindings/
 * so they can be bundled by Tauri as resources and reach the user's machine.
 *
 * The compiled Bun sidecar binary cannot embed these files (oracledb loads them
 * via dynamic require paths the bundler can't trace). At runtime the Tauri host
 * (sidecar.rs) finds the bundled directory via app.path().resource_dir() and
 * passes it to the sidecar via VEESKER_ORACLEDB_BINARY_DIR env var, which the
 * sidecar forwards to oracledb.initOracleClient as `binaryDir`.
 *
 * Run automatically before every `tauri build` via the root package.json `build`
 * script. Manual invocation: `bun run scripts/copy-oracledb-bindings.ts`.
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(REPO_ROOT, "sidecar", "node_modules", "oracledb", "build", "Release");
const TARGET_DIR = join(REPO_ROOT, "src-tauri", "oracledb-bindings");

if (!existsSync(SOURCE_DIR)) {
  console.error(`[bindings] source dir missing: ${SOURCE_DIR}`);
  console.error("[bindings] run `bun install` inside sidecar/ first");
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });

let copied = 0;
let upToDate = 0;
for (const name of readdirSync(SOURCE_DIR)) {
  if (!name.endsWith(".node")) continue;
  const src = join(SOURCE_DIR, name);
  const dst = join(TARGET_DIR, name);
  if (existsSync(dst)) {
    const srcStat = statSync(src);
    const dstStat = statSync(dst);
    if (srcStat.size === dstStat.size && srcStat.mtimeMs <= dstStat.mtimeMs) {
      upToDate++;
      continue;
    }
  }
  copyFileSync(src, dst);
  console.log(`[bindings] copied ${basename(src)}`);
  copied++;
}

console.log(`[bindings] ${copied} copied, ${upToDate} up-to-date — total in ${TARGET_DIR}`);
