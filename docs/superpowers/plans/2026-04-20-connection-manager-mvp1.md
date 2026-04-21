# Connection Manager MVP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type Oracle 23ai credentials in a Svelte form, click "Test connection", and see success/error from a real Oracle instance — via a Bun sidecar spawned by Tauri.

**Architecture:** Tauri (Rust) spawns a Bun-compiled native sidecar binary as a long-running child process. They speak JSON-RPC 2.0 framed by newlines over stdin/stdout. The sidecar uses `node-oracledb` Thin mode to open Oracle connections.

**Tech Stack:** Tauri 2 + Svelte 5 (frontend), tokio + serde + serde_json (Rust), Bun + TypeScript + node-oracledb 6.x (sidecar). No Instant Client required.

**Spec:** `docs/superpowers/specs/2026-04-20-connection-manager-mvp1.md`

---

## File Structure

```
sidecar/                                # NEW: Bun sidecar
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                        # entry: stdin loop + dispatch
│   ├── rpc.ts                          # JSON-RPC 2.0 types + parser
│   ├── handlers.ts                     # method registry
│   └── oracle.ts                       # connection.test handler
└── tests/
    ├── rpc.test.ts                     # protocol unit tests
    └── handlers.test.ts                # dispatch unit tests

src-tauri/
├── src/
│   ├── lib.rs                          # MODIFY: register command, manage sidecar state
│   ├── sidecar.rs                      # NEW: process spawn + JSON-RPC client
│   └── commands.rs                     # NEW: connection_test tauri command
├── binaries/                           # NEW: sidecar binaries per target
│   └── .gitkeep
├── tauri.conf.json                     # MODIFY: register externalBin
└── Cargo.toml                          # MODIFY: add tokio process feature, uuid

src/
├── lib/
│   └── connection.ts                   # NEW: typed wrapper around invoke
└── routes/
    └── +page.svelte                    # MODIFY: replace bootstrap landing with form

scripts/
└── build-sidecar.sh                    # NEW: compile sidecar to native binary

.gitignore                              # MODIFY: ignore binaries/* but keep .gitkeep
```

---

## Task 1: Sidecar workspace bootstrap

**Files:**
- Create: `sidecar/package.json`
- Create: `sidecar/tsconfig.json`
- Create: `sidecar/.gitignore`

- [ ] **Step 1: Create sidecar/package.json**

```json
{
  "name": "veesker-sidecar",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "build": "bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar"
  },
  "dependencies": {
    "oracledb": "^6.6.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create sidecar/tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create sidecar/.gitignore**

```
node_modules
*.log
```

- [ ] **Step 4: Install dependencies**

Run from `sidecar/`:
```bash
bun install
```
Expected: `oracledb` and dev deps installed, `bun.lock` created.

- [ ] **Step 5: Commit**

```bash
git add sidecar/
git commit -m "feat(sidecar): bootstrap Bun workspace with node-oracledb"
```

---

## Task 2: JSON-RPC 2.0 protocol module (TDD)

**Files:**
- Create: `sidecar/src/rpc.ts`
- Create: `sidecar/tests/rpc.test.ts`

- [ ] **Step 1: Write failing tests for rpc.ts**

Create `sidecar/tests/rpc.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { parseRequest, makeError, makeResult } from "../src/rpc";

describe("parseRequest", () => {
  test("parses a valid request", () => {
    const req = parseRequest('{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}');
    expect(req).toEqual({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
  });

  test("returns null for invalid JSON", () => {
    expect(parseRequest("not json")).toBeNull();
  });

  test("returns null when jsonrpc field missing or wrong", () => {
    expect(parseRequest('{"id":1,"method":"x"}')).toBeNull();
    expect(parseRequest('{"jsonrpc":"1.0","id":1,"method":"x"}')).toBeNull();
  });

  test("returns null when method missing", () => {
    expect(parseRequest('{"jsonrpc":"2.0","id":1}')).toBeNull();
  });
});

describe("makeResult", () => {
  test("builds a result envelope", () => {
    expect(makeResult(7, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });
});

describe("makeError", () => {
  test("builds an error envelope", () => {
    expect(makeError(7, -32601, "Method not found")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Method not found" },
    });
  });

  test("includes data when provided", () => {
    expect(makeError(7, -32000, "boom", { detail: "x" })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32000, message: "boom", data: { detail: "x" } },
    });
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run from `sidecar/`:
```bash
bun test tests/rpc.test.ts
```
Expected: FAIL — module `../src/rpc` not found.

- [ ] **Step 3: Implement sidecar/src/rpc.ts**

```ts
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string; data?: unknown } };

export function parseRequest(line: string): JsonRpcRequest | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof obj !== "object" ||
    obj === null ||
    (obj as any).jsonrpc !== "2.0" ||
    typeof (obj as any).method !== "string" ||
    (typeof (obj as any).id !== "number" && typeof (obj as any).id !== "string")
  ) {
    return null;
  }
  return obj as JsonRpcRequest;
}

export function makeResult(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/rpc.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/rpc.ts sidecar/tests/rpc.test.ts
git commit -m "feat(sidecar): JSON-RPC 2.0 protocol parser + envelopes"
```

---

## Task 3: Method dispatcher (TDD)

**Files:**
- Create: `sidecar/src/handlers.ts`
- Create: `sidecar/tests/handlers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sidecar/tests/handlers.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { dispatch } from "../src/handlers";

describe("dispatch", () => {
  test("calls registered handler and returns its result", async () => {
    const handlers = {
      "math.add": async (params: any) => params.a + params.b,
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 1,
      method: "math.add",
      params: { a: 2, b: 3 },
    });
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, result: 5 });
  });

  test("returns method-not-found error", async () => {
    const res = await dispatch({}, {
      jsonrpc: "2.0",
      id: 2,
      method: "nope",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found: nope" },
    });
  });

  test("catches handler throws and wraps as internal error", async () => {
    const handlers = {
      boom: async () => {
        throw new Error("kaboom");
      },
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 3,
      method: "boom",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "kaboom" },
    });
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/handlers.test.ts
```
Expected: FAIL — module `../src/handlers` not found.

- [ ] **Step 3: Implement sidecar/src/handlers.ts**

```ts
import { makeError, makeResult, type JsonRpcRequest, type JsonRpcResponse } from "./rpc";

export type Handler = (params: any) => Promise<unknown>;
export type HandlerMap = Record<string, Handler>;

export async function dispatch(
  handlers: HandlerMap,
  req: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const handler = handlers[req.method];
  if (!handler) {
    return makeError(req.id, -32601, `Method not found: ${req.method}`);
  }
  try {
    const result = await handler(req.params ?? {});
    return makeResult(req.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(req.id, -32000, message);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/handlers.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/handlers.ts sidecar/tests/handlers.test.ts
git commit -m "feat(sidecar): JSON-RPC method dispatcher with error wrapping"
```

---

## Task 4: connection.test handler

**Files:**
- Create: `sidecar/src/oracle.ts`

> No unit test for this — it's pure I/O against Oracle. Covered by manual smoke test in Task 9.

- [ ] **Step 1: Implement sidecar/src/oracle.ts**

```ts
import oracledb from "oracledb";

export type ConnectionTestParams = {
  host: string;
  port: number;
  serviceName: string;
  username: string;
  password: string;
};

export type ConnectionTestResult = {
  ok: true;
  serverVersion: string;
  elapsedMs: number;
};

export async function connectionTest(
  params: ConnectionTestParams
): Promise<ConnectionTestResult> {
  const connectString = `${params.host}:${params.port}/${params.serviceName}`;
  const started = Date.now();
  const conn = await oracledb.getConnection({
    user: params.username,
    password: params.password,
    connectString,
  });
  try {
    const result = await conn.execute<{ V: string }>(
      "SELECT BANNER_FULL AS V FROM V$VERSION WHERE ROWNUM = 1",
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const banner = result.rows?.[0]?.V ?? "Oracle (version unavailable)";
    return {
      ok: true,
      serverVersion: banner,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await conn.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/src/oracle.ts
git commit -m "feat(sidecar): connection.test handler using node-oracledb Thin"
```

---

## Task 5: Sidecar entry point

**Files:**
- Create: `sidecar/src/index.ts`

- [ ] **Step 1: Implement sidecar/src/index.ts**

```ts
import { parseRequest, makeError } from "./rpc";
import { dispatch, type HandlerMap } from "./handlers";
import { connectionTest } from "./oracle";

const handlers: HandlerMap = {
  "connection.test": (params) => connectionTest(params as any),
  ping: async () => ({ pong: true }),
};

function writeLine(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of process.stdin as any) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const req = parseRequest(line);
      if (!req) {
        writeLine(makeError(0, -32700, "Parse error"));
        continue;
      }
      const res = await dispatch(handlers, req);
      writeLine(res);
    }
  }
}

main().catch((err) => {
  console.error("sidecar fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test the sidecar manually**

Run from `sidecar/`:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' | bun src/index.ts
```
Expected output:
```json
{"jsonrpc":"2.0","id":1,"result":{"pong":true}}
```

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/index.ts
git commit -m "feat(sidecar): NDJSON stdin/stdout entry point"
```

---

## Task 6: Compile sidecar to native binary

**Files:**
- Create: `scripts/build-sidecar.sh`
- Create: `src-tauri/binaries/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create scripts/build-sidecar.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Compile the Bun sidecar to a native binary tagged with the Rust target triple,
# so Tauri's externalBin can pick it up.

cd "$(dirname "$0")/.."

TARGET_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
OUT="src-tauri/binaries/veesker-sidecar-${TARGET_TRIPLE}"

echo "Building sidecar → ${OUT}"
cd sidecar
bun build src/index.ts --compile --minify --outfile "../${OUT}"

echo "Done."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/build-sidecar.sh
```

- [ ] **Step 3: Create src-tauri/binaries/.gitkeep**

```bash
mkdir -p src-tauri/binaries
touch src-tauri/binaries/.gitkeep
```

- [ ] **Step 4: Update .gitignore**

Append to `.gitignore`:
```
# Compiled sidecar binaries (built per-platform via scripts/build-sidecar.sh)
src-tauri/binaries/veesker-sidecar-*
!src-tauri/binaries/.gitkeep
```

- [ ] **Step 5: Build and verify**

```bash
./scripts/build-sidecar.sh
ls -la src-tauri/binaries/
```
Expected: `veesker-sidecar-<triple>` exists, ~70-90 MB.

- [ ] **Step 6: Smoke test compiled binary**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' | ./src-tauri/binaries/veesker-sidecar-*
```
Expected: `{"jsonrpc":"2.0","id":1,"result":{"pong":true}}`

- [ ] **Step 7: Commit**

```bash
git add scripts/build-sidecar.sh src-tauri/binaries/.gitkeep .gitignore
git commit -m "build(sidecar): compile script + binary directory layout"
```

---

## Task 7: Tauri sidecar registration

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add externalBin to tauri.conf.json**

In `src-tauri/tauri.conf.json`, add a `bundle.externalBin` array:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Veesker",
  "version": "0.0.1",
  "identifier": "dev.veesker.app",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../build"
  },
  "app": {
    "windows": [
      {
        "title": "Veesker",
        "width": 1280,
        "height": 800,
        "minWidth": 960,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/veesker-sidecar"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 2: Grant shell permission for the sidecar**

Replace `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/veesker-sidecar",
          "sidecar": true,
          "args": []
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Add tauri-plugin-shell to Cargo.toml**

Append to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
tauri-plugin-shell = "2"
tokio = { version = "1", features = ["rt", "sync", "io-util", "macros"] }
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 4: Add the JS plugin**

```bash
cd /Users/geraldoviana/Documents/veesker
bun add @tauri-apps/plugin-shell
```

- [ ] **Step 5: Verify Cargo can resolve**

```bash
cd src-tauri && cargo check
```
Expected: PASS (compiles new deps).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json bun.lock
git commit -m "feat(tauri): register sidecar binary + shell capability"
```

---

## Task 8: Rust sidecar process manager

**Files:**
- Create: `src-tauri/src/sidecar.rs`

> Single-instance manager that spawns the sidecar once on first request, holds an mpsc channel per pending request id, and demuxes responses by id.

- [ ] **Step 1: Implement src-tauri/src/sidecar.rs**

```rust
use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

#[derive(Debug, Serialize)]
struct Request<'a> {
    jsonrpc: &'a str,
    id: String,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
pub struct Response {
    pub id: String,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Response>>>>;

pub struct Sidecar {
    stdin_tx: mpsc::Sender<String>,
    pending: Pending,
    _child: Arc<Mutex<CommandChild>>,
}

impl Sidecar {
    pub fn spawn(app: &AppHandle) -> Result<Self, String> {
        let (mut rx, child) = app
            .shell()
            .sidecar("veesker-sidecar")
            .map_err(|e| format!("sidecar binary not found: {e}"))?
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
        let child = Arc::new(Mutex::new(child));

        // Forward stdin writes
        let stdin_writer = child.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                let mut guard = stdin_writer.lock().await;
                if let Err(err) = guard.write(line.as_bytes()) {
                    eprintln!("sidecar stdin write failed: {err}");
                    break;
                }
            }
        });

        // Demux stdout into pending oneshots. Stdout chunks may split a JSON line
        // across events, so accumulate in a buffer and only consume complete lines.
        let pending_clone = pending.clone();
        tauri::async_runtime::spawn(async move {
            let mut buffer = String::new();
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(idx) = buffer.find('\n') {
                            let line = buffer[..idx].trim().to_string();
                            buffer.drain(..=idx);
                            if line.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Response>(&line) {
                                Ok(resp) => {
                                    let mut map = pending_clone.lock().await;
                                    if let Some(tx) = map.remove(&resp.id) {
                                        let _ = tx.send(resp);
                                    }
                                }
                                Err(err) => {
                                    eprintln!("sidecar bad json: {err} line={line}");
                                }
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            eprintln!("[sidecar] {}", text.trim_end());
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!("sidecar terminated: {:?}", payload);
                        // Wake any in-flight callers — dropping their senders
                        // resolves rx.await to RecvError, which call() maps to -32002.
                        pending_clone.lock().await.clear();
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            stdin_tx,
            pending,
            _child: child,
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = Uuid::new_v4().to_string();
        let req = Request {
            jsonrpc: "2.0",
            id: id.clone(),
            method,
            params,
        };
        let mut line = serde_json::to_string(&req).expect("serialize request");
        line.push('\n');

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.clone(), tx);
        }

        if let Err(err) = self.stdin_tx.send(line).await {
            self.pending.lock().await.remove(&id);
            return Err(RpcError {
                code: -32001,
                message: format!("sidecar stdin closed: {err}"),
                data: None,
            });
        }

        let resp = rx.await.map_err(|_| RpcError {
            code: -32002,
            message: "sidecar dropped response channel".into(),
            data: None,
        })?;

        if let Some(err) = resp.error {
            return Err(err);
        }
        Ok(resp.result.unwrap_or(Value::Null))
    }
}

pub struct SidecarState(pub Mutex<Option<Sidecar>>);

pub async fn ensure(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().await;
    if guard.is_none() {
        *guard = Some(Sidecar::spawn(app)?);
    }
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "feat(tauri): sidecar process manager with JSON-RPC demux"
```

---

## Task 9: Tauri command — connection_test

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create src-tauri/src/commands.rs**

```rust
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::sidecar::{ensure, SidecarState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestOk {
    pub server_version: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestErr {
    pub code: i32,
    pub message: String,
}

#[tauri::command]
pub async fn connection_test(
    app: AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionTestOk, ConnectionTestErr> {
    if let Err(err) = ensure(&app).await {
        return Err(ConnectionTestErr {
            code: -32003,
            message: err,
        });
    }

    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");

    let result = sidecar
        .call(
            "connection.test",
            json!({
                "host": config.host,
                "port": config.port,
                "serviceName": config.service_name,
                "username": config.username,
                "password": config.password,
            }),
        )
        .await
        .map_err(|err| ConnectionTestErr {
            code: err.code,
            message: err.message,
        })?;

    let server_version = result
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("Oracle (unknown)")
        .to_string();
    let elapsed_ms = result
        .get("elapsedMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Ok(ConnectionTestOk {
        server_version,
        elapsed_ms,
    })
}
```

- [ ] **Step 2: Wire up modules + state in src-tauri/src/lib.rs**

Replace the file contents with:

```rust
mod commands;
mod sidecar;

use tokio::sync::Mutex;

use crate::sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![commands::connection_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify cargo check**

```bash
cd src-tauri && cargo check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): connection_test command wired to sidecar"
```

---

## Task 10: Frontend — typed connection wrapper

**Files:**
- Create: `src/lib/connection.ts`

- [ ] **Step 1: Implement src/lib/connection.ts**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/connection.ts
git commit -m "feat(ui): typed wrapper for connection_test command"
```

---

## Task 11: Connection form UI

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Replace src/routes/+page.svelte with the form**

```svelte
<script lang="ts">
  import { testConnection, type ConnectionConfig } from "$lib/connection";

  let config = $state<ConnectionConfig>({
    host: "localhost",
    port: 1521,
    serviceName: "FREEPDB1",
    username: "",
    password: "",
  });

  let testing = $state(false);
  let result = $state<
    | { kind: "idle" }
    | { kind: "ok"; serverVersion: string; elapsedMs: number }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function onTest(event: Event) {
    event.preventDefault();
    testing = true;
    result = { kind: "idle" };
    const res = await testConnection(config);
    testing = false;
    if (res.ok) {
      result = {
        kind: "ok",
        serverVersion: res.data.serverVersion,
        elapsedMs: res.data.elapsedMs,
      };
    } else {
      result = { kind: "err", message: res.error.message };
    }
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <div class="brand">
      <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="4" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="14" r="2.8" fill="#B33E1F" />
        <circle cx="24" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
      </svg>
      <h1>veesker</h1>
    </div>
    <p class="tagline">connect to Oracle 23ai</p>
  </header>

  <form onsubmit={onTest}>
    <label>
      Host
      <input type="text" bind:value={config.host} required />
    </label>

    <div class="row">
      <label class="port">
        Port
        <input type="number" bind:value={config.port} min="1" max="65535" required />
      </label>
      <label class="service">
        Service name
        <input type="text" bind:value={config.serviceName} required />
      </label>
    </div>

    <label>
      Username
      <input type="text" bind:value={config.username} autocomplete="off" required />
    </label>

    <label>
      Password
      <input type="password" bind:value={config.password} autocomplete="off" required />
    </label>

    <button type="submit" disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </button>
  </form>

  {#if result.kind === "ok"}
    <div class="status ok">
      <strong>Connected.</strong>
      <span>{result.serverVersion}</span>
      <span class="meta">{result.elapsedMs} ms</span>
    </div>
  {:else if result.kind === "err"}
    <div class="status err">
      <strong>Failed.</strong>
      <span>{result.message}</span>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 40px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    color: rgba(26, 22, 18, 0.6);
    font-style: italic;
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  input {
    font-family: "Inter", sans-serif;
    font-size: 14px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: #1a1612;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
  }
  input:focus {
    outline: none;
    border-color: #b33e1f;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1rem;
  }
  button {
    margin-top: 0.5rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #f6f1e8;
    background: #1a1612;
    border: none;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  button:hover:not(:disabled) {
    background: #b33e1f;
  }
  .status {
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .status.ok {
    background: rgba(46, 125, 50, 0.08);
    color: #1b5e20;
    border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
```

- [ ] **Step 2: Run svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker
bun run check
```
Expected: PASS, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(ui): connection form with test button + result feedback"
```

---

## Task 12: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Build the sidecar binary**

```bash
cd /Users/geraldoviana/Documents/veesker
./scripts/build-sidecar.sh
```
Expected: `src-tauri/binaries/veesker-sidecar-<triple>` exists.

- [ ] **Step 2: Spin up an Oracle 23ai Free for testing (one-time)**

If you don't already have a 23ai instance reachable, run a local container:
```bash
docker run -d --name veesker-oracle-23ai \
  -p 1521:1521 \
  -e ORACLE_PWD=Veesker_dev_2026 \
  container-registry.oracle.com/database/free:latest
```
Wait ~3 min. Default service: `FREEPDB1`. User: `pdbadmin`. Password: the value of `ORACLE_PWD`.

- [ ] **Step 3: Run the app**

```bash
bun run tauri dev
```

- [ ] **Step 4: Manual test in the app**

Fill the form:
- Host: `localhost`
- Port: `1521`
- Service name: `FREEPDB1`
- Username: `pdbadmin`
- Password: `Veesker_dev_2026`

Click **Test connection**.

Expected:
- Within 5s, green status bar
- Version line begins with `Oracle Database 23ai Free Release ...`
- Elapsed ms shown

- [ ] **Step 5: Negative test**

Change password to `wrong`, click again. Expected: red status with `ORA-01017: invalid username/password` (or similar Oracle error).

- [ ] **Step 6: Confirm sidecar dies with the app**

In a second terminal:
```bash
ps aux | grep veesker-sidecar | grep -v grep
```
Note the PID. Quit the app window (⌘Q). Re-run the `ps` command. Expected: process gone.

- [ ] **Step 7: Tag the milestone**

```bash
git tag -a v0.0.2-connection-mvp1 -m "Connection Manager MVP1: form + sidecar + Oracle 23ai test"
git push origin main --tags
```

---

## Self-review checklist (already done)

- ✅ Spec coverage: each in-scope item from the spec maps to at least one task (sidecar protocol → 2/3, connection.test → 4, sidecar lifecycle → 5/8, Tauri command → 9, form → 11, success criteria → 12)
- ✅ No placeholders: every code step has the actual code
- ✅ Type consistency: `ConnectionConfig` (camelCase), `connection.test` method name, `serverVersion`/`elapsedMs` field names align across sidecar, Rust, and TS
- ✅ TDD where it pays: pure modules (rpc, dispatch) have unit tests; I/O modules (oracle, sidecar process, UI) covered by manual smoke test
- ✅ Frequent commits: one per task or sub-step
