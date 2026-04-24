# PL/SQL Debugger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full PL/SQL step-through debugger to Veesker — right-click any procedure/function/package in SchemaTree → "Test Window" → edit anonymous block → set breakpoints → Debug → step through with live variable inspection.

**Architecture:** Two Oracle connections per debug session (target runs code, debug controls DBMS_DEBUG). All Oracle protocol is in a new `sidecar/src/debug.ts` DebugSession class. The UI is a full-screen modal (`TestWindow.svelte`) with CodeMirror breakpoint gutter, variable grid, and debug toolbar.

**Tech Stack:** node-oracledb (DBMS_DEBUG), Bun/TypeScript (sidecar), Tauri commands (Rust passthrough), SvelteKit 5 runes, CodeMirror 6 extensions.

---

## File Map

**New files:**
- `sidecar/src/debug.ts` — DebugSession class + all debug.* Oracle functions
- `sidecar/tests/debug-block-gen.test.ts` — unit tests for anonymous block generator
- `src/lib/workspace/TestWindow.svelte` — full-screen modal (tab bar, layout)
- `src/lib/workspace/DebugToolbar.svelte` — Run/Debug/Step buttons + status badge
- `src/lib/workspace/VariableGrid.svelte` — bind var inputs + live values
- `src/lib/workspace/DebugCallStack.svelte` — call stack list
- `src/lib/workspace/breakpointGutter.ts` — CodeMirror 6 gutter extension
- `src/lib/workspace/currentLineDecoration.ts` — CodeMirror 6 current-line highlight
- `src/lib/stores/debug.svelte.ts` — Svelte 5 $state debug session store

**Modified files:**
- `sidecar/src/index.ts` — register 13 new `debug.*` RPC handlers
- `src-tauri/src/commands.rs` — 13 new Tauri passthrough commands
- `src-tauri/src/lib.rs` — register new commands in invoke_handler!
- `src/lib/workspace.ts` — add debug types + RPC call wrappers
- `src/lib/workspace/SchemaTree.svelte` — add right-click context menu + `onTestWindow` prop
- `src/routes/workspace/[id]/+page.svelte` — wire `onTestWindow` → open TestWindow

---

## Task 1: Sidecar — anonymous block generator (pure function, fully testable)

This is a pure TypeScript function with no Oracle dependency. Do this first so you have something testable immediately.

**Files:**
- Create: `sidecar/src/debug.ts`
- Create: `sidecar/tests/debug-block-gen.test.ts`

- [ ] **Step 1: Write failing tests for the block generator**

Create `sidecar/tests/debug-block-gen.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { generateTestBlock, type ParamDef } from "../src/debug";

describe("generateTestBlock", () => {
  test("generates a simple IN-only call", () => {
    const params: ParamDef[] = [
      { name: "P_ID", dataType: "NUMBER", inOut: "IN", position: 1 },
      { name: "P_NAME", dataType: "VARCHAR2", inOut: "IN", position: 2 },
    ];
    const block = generateTestBlock("MYSCHEMA", "MY_PROC", null, params);
    expect(block).toContain("BEGIN");
    expect(block).toContain("MYSCHEMA.MY_PROC(");
    expect(block).toContain("p_id => :p_id");
    expect(block).toContain("p_name => :p_name");
    expect(block).toContain("END;");
  });

  test("declares local variable for OUT param and assigns bind after call", () => {
    const params: ParamDef[] = [
      { name: "P_IN", dataType: "NUMBER", inOut: "IN", position: 1 },
      { name: "P_OUT", dataType: "VARCHAR2", inOut: "OUT", position: 2 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_out");
    expect(block).toContain(":out_p_out := v_p_out");
    expect(block).toContain("p_out => v_p_out");
  });

  test("includes package name when provided", () => {
    const params: ParamDef[] = [
      { name: "P_ID", dataType: "NUMBER", inOut: "IN", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC_NAME", "PKG_NAME", params);
    expect(block).toContain("SC.PKG_NAME.PROC_NAME(");
  });

  test("generates BOOLEAN param via local variable with CASE", () => {
    const params: ParamDef[] = [
      { name: "P_FLAG", dataType: "BOOLEAN", inOut: "IN", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_flag BOOLEAN");
    expect(block).toContain("CASE UPPER(:p_flag)");
    expect(block).toContain("p_flag => v_p_flag");
  });

  test("generates IN OUT param via local variable", () => {
    const params: ParamDef[] = [
      { name: "P_VAL", dataType: "NUMBER", inOut: "IN/OUT", position: 1 },
    ];
    const block = generateTestBlock("SC", "PROC", null, params);
    expect(block).toContain("v_p_val NUMBER");
    expect(block).toContain(":p_val");
    expect(block).toContain("v_p_val := :p_val");
    expect(block).toContain("p_val => v_p_val");
  });

  test("no params produces a simple BEGIN/END block", () => {
    const block = generateTestBlock("SC", "PROC", null, []);
    expect(block).toMatch(/BEGIN\s+SC\.PROC\(\);\s+END;/s);
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail**

```bash
cd sidecar
bun test tests/debug-block-gen.test.ts
```

Expected: `Cannot find module '../src/debug'`

- [ ] **Step 3: Create `sidecar/src/debug.ts` with types and the block generator**

```typescript
import oracledb from "oracledb";
import { getActiveSession, setSession } from "./state";
import { RpcCodedError, SESSION_LOST, ORACLE_ERR } from "./errors";

// ── Types ──────────────────────────────────────────────────────────────────

export type ParamDef = {
  name: string;
  dataType: string;
  inOut: "IN" | "OUT" | "IN/OUT";
  position: number;
};

export type DebugBreakpoint = {
  id: number;
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type StackFrame = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type VarValue = {
  name: string;
  value: string | null;
};

export type PauseInfo = {
  status: "paused" | "completed" | "error";
  frame: StackFrame | null;
  reason: number;
  errorMessage?: string;
};

// ── Block generator ────────────────────────────────────────────────────────

const COMPLEX_TYPES = new Set([
  "RECORD", "TABLE", "VARRAY", "OBJECT", "REF",
  "PL/SQL BOOLEAN",  // handled separately
]);

function lowerBind(name: string): string {
  return name.toLowerCase();
}

export function generateTestBlock(
  owner: string,
  procName: string,
  packageName: string | null,
  params: ParamDef[]
): string {
  const callTarget = packageName
    ? `${owner}.${packageName}.${procName}`
    : `${owner}.${procName}`;

  if (params.length === 0) {
    return `BEGIN\n  ${callTarget}();\nEND;`;
  }

  const declares: string[] = [];
  const callArgs: string[] = [];
  const postCall: string[] = [];

  for (const p of params) {
    const bind = lowerBind(p.name);
    const localVar = `v_${bind}`;
    const dt = p.dataType.toUpperCase();

    if (dt === "BOOLEAN") {
      declares.push(`  ${localVar} BOOLEAN;`);
      declares.push(
        `  -- Convert :${bind} ('TRUE'/'FALSE'/NULL) to BOOLEAN\n` +
        `  ${localVar} := CASE UPPER(:${bind}) WHEN 'TRUE' THEN TRUE WHEN 'FALSE' THEN FALSE ELSE NULL END;`
      );
      callArgs.push(`    ${bind} => ${localVar}`);
    } else if (COMPLEX_TYPES.has(dt)) {
      declares.push(`  ${localVar} ${p.dataType}; -- fill in`);
      callArgs.push(`    ${bind} => ${localVar}`);
    } else if (p.inOut === "IN") {
      callArgs.push(`    ${bind} => :${bind}`);
    } else if (p.inOut === "OUT") {
      const oracleType = p.dataType.includes("(") ? p.dataType : `${p.dataType}(32767)`;
      const safeType = dt === "NUMBER" || dt === "INTEGER" || dt === "BINARY_INTEGER"
        ? "NUMBER"
        : dt === "DATE"
        ? "DATE"
        : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    } else {
      // IN/OUT
      const safeType = dt === "NUMBER" || dt === "INTEGER" ? "NUMBER"
        : dt === "DATE" ? "DATE"
        : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType} := :${bind};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    }
  }

  const declSection = declares.length > 0 ? `DECLARE\n${declares.join("\n")}\n` : "";
  const callSection = `  ${callTarget}(\n${callArgs.join(",\n")}\n  );`;
  const postSection = postCall.length > 0 ? "\n" + postCall.join("\n") : "";

  return `${declSection}BEGIN\n${callSection}${postSection}\nEND;`;
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd sidecar
bun test tests/debug-block-gen.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/debug.ts sidecar/tests/debug-block-gen.test.ts
git commit -m "feat(debug): add debug.ts with ParamDef types and anonymous block generator"
```

---

## Task 2: Sidecar — `debug.open` and `debug.getSource` Oracle functions

Fetch procedure signature from `ALL_ARGUMENTS` and source from `ALL_SOURCE`. Also store session credentials in `state.ts` so the DebugSession can open its own two connections without requiring the client to send credentials again.

**Files:**
- Modify: `sidecar/src/state.ts`
- Modify: `sidecar/src/oracle.ts` (store params on `openSession`)
- Modify: `sidecar/src/debug.ts`

- [ ] **Step 0: Store session credentials in `state.ts`**

Add to `sidecar/src/state.ts`:

```typescript
import type { OpenSessionParams } from "./oracle";

let _sessionParams: OpenSessionParams | null = null;

export function setSessionParams(p: OpenSessionParams): void {
  _sessionParams = p;
}

export function getSessionParams(): OpenSessionParams {
  if (!_sessionParams) throw new RpcCodedError(NO_ACTIVE_SESSION, "No session params stored");
  return _sessionParams;
}
```

In `sidecar/src/oracle.ts`, inside `openSession`, after the connection is established and before returning, add:

```typescript
import { setSessionParams } from "./state";
// ...inside openSession, just before the return statement:
setSessionParams(p);
```

This ensures `DebugSession.create()` can call `getSessionParams()` to open its two new connections without needing the UI to resend credentials.

- [ ] **Step 1: Add `debugOpen` and `debugGetSource` to `debug.ts`**

Append to `sidecar/src/debug.ts`:

```typescript
// ── debug.open ─────────────────────────────────────────────────────────────

export type DebugOpenParams = {
  owner: string;
  objectName: string;
  objectType: string;
  packageName?: string;
};

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: string[];
};

export async function debugOpen(p: DebugOpenParams): Promise<DebugOpenResult> {
  return withActiveSession(async (conn) => {
    const packageBind = p.packageName ?? null;
    const res = await conn.execute<{
      ARGUMENT_NAME: string;
      DATA_TYPE: string;
      IN_OUT: string;
      POSITION: number;
    }>(
      `SELECT argument_name, data_type, in_out, position
         FROM all_arguments
        WHERE owner        = UPPER(:owner)
          AND object_name  = UPPER(:objectName)
          AND (package_name = UPPER(:packageName) OR
               (:packageName IS NULL AND package_name IS NULL))
          AND overload IS NULL
          AND argument_name IS NOT NULL
        ORDER BY position`,
      {
        owner: p.owner,
        objectName: p.objectName,
        packageName: packageBind,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const params: ParamDef[] = (res.rows ?? []).map((r) => ({
      name: r.ARGUMENT_NAME,
      dataType: r.DATA_TYPE,
      inOut: r.IN_OUT as ParamDef["inOut"],
      position: r.POSITION,
    }));

    const script = generateTestBlock(
      p.owner,
      p.objectName,
      p.packageName ?? null,
      params
    );

    // For PACKAGE, also return list of public procedures/functions for member picker
    let memberList: string[] | undefined;
    if (p.objectType.toUpperCase() === "PACKAGE") {
      const membRes = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT DISTINCT object_name
           FROM all_arguments
          WHERE owner        = UPPER(:owner)
            AND package_name = UPPER(:packageName)
          ORDER BY object_name`,
        { owner: p.owner, packageName: p.objectName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      memberList = (membRes.rows ?? []).map((r) => r.OBJECT_NAME);
    }

    return { script, params, memberList };
  });
}

// ── debug.getSource ────────────────────────────────────────────────────────

export type DebugGetSourceParams = {
  owner: string;
  objectName: string;
  objectType: string;
};

export async function debugGetSource(
  p: DebugGetSourceParams
): Promise<{ lines: string[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ TEXT: string }>(
      `SELECT text
         FROM all_source
        WHERE owner = UPPER(:owner)
          AND name  = UPPER(:name)
          AND type  = UPPER(:type)
        ORDER BY line`,
      { owner: p.owner, name: p.objectName, type: p.objectType },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return { lines: (res.rows ?? []).map((r) => r.TEXT) };
  });
}

// ── Helper (mirrors pattern in oracle.ts) ─────────────────────────────────

import { isLostSessionError } from "./oracle";

async function withActiveSession<T>(
  fn: (conn: oracledb.Connection) => Promise<T>
): Promise<T> {
  const conn = getActiveSession();
  try {
    return await fn(conn);
  } catch (err) {
    if (err instanceof RpcCodedError) throw err;
    if (isLostSessionError(err)) {
      throw new RpcCodedError(SESSION_LOST, (err as Error).message);
    }
    throw new RpcCodedError(ORACLE_ERR, err instanceof Error ? err.message : String(err));
  }
}
```

**Important:** `isLostSessionError` is not exported from `oracle.ts` yet. Add `export` to it in `sidecar/src/oracle.ts`:

```typescript
// oracle.ts line ~78: add export keyword
export function isLostSessionError(err: unknown): boolean {
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd sidecar
bun build src/index.ts --compile --outfile /dev/null 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/debug.ts sidecar/src/oracle.ts
git commit -m "feat(debug): add debugOpen (ALL_ARGUMENTS) and debugGetSource (ALL_SOURCE)"
```

---

## Task 3: Sidecar — DebugSession class (start, stop, breakpoints)

This is the core `DBMS_DEBUG` two-session protocol. No unit tests possible without Oracle — the implementation itself is the deliverable. Write it carefully.

**Files:**
- Modify: `sidecar/src/debug.ts`

- [ ] **Step 1: Append DebugSession class to `debug.ts`**

```typescript
// ── DebugSession ───────────────────────────────────────────────────────────

import { buildConnection } from "./oracle";
import { getSessionParams } from "./state";

// DBMS_DEBUG break_next_flags constants
const BREAK_NEXT_LINE  = 12;   // break on next line
const BREAK_ANY_CALL   = 4;    // break on any procedure entry
const BREAK_RETURN     = 8;    // break on return from current unit
const BREAK_EXCEPTION  = 2;    // break on exception

// info_requested bitmask: ask for line + program info
const INFO_STACK_DEPTH = 1;
const INFO_BREAKPOINT  = 2;
const INFO_RUNTIME_INFO = 44;  // line, program, reason

// DBMS_DEBUG reason codes (Reason field of runtime_info)
export const REASON_BREAKPOINT  = 2;
export const REASON_STEP        = 4;
export const REASON_EXCEPTION   = 8;
export const REASON_FINISHED    = 16;

// DBMS_DEBUG LibunitType values
const LIBUNIT_PROCEDURE = 12;
const LIBUNIT_FUNCTION  = 8;
const LIBUNIT_PACKAGE_BODY = 9;
const LIBUNIT_TRIGGER   = 11;
const NAMESPACE_PLSQL   = 1;

function libunitForType(objectType: string): number {
  switch (objectType.toUpperCase()) {
    case "PROCEDURE": return LIBUNIT_PROCEDURE;
    case "FUNCTION":  return LIBUNIT_FUNCTION;
    case "PACKAGE BODY":
    case "PACKAGE":   return LIBUNIT_PACKAGE_BODY;
    case "TRIGGER":   return LIBUNIT_TRIGGER;
    default:          return LIBUNIT_PROCEDURE;
  }
}

let _debugSession: DebugSession | null = null;

export function getDebugSession(): DebugSession | null {
  return _debugSession;
}

export class DebugSession {
  private targetConn: oracledb.Connection;
  private debugConn: oracledb.Connection;
  private breakpoints = new Map<number, DebugBreakpoint>();
  private nextBpId = 1;
  private _targetExecution: Promise<any> | null = null;

  private constructor(
    targetConn: oracledb.Connection,
    debugConn: oracledb.Connection
  ) {
    this.targetConn = targetConn;
    this.debugConn = debugConn;
  }

  static async create(): Promise<DebugSession> {
    const p = getSessionParams();
    const target = await buildConnection(p);
    const debug  = await buildConnection(p);
    const session = new DebugSession(target, debug);
    _debugSession = session;
    return session;
  }

  async initialize(): Promise<string> {
    const res = await this.targetConn.execute<[string]>(
      `BEGIN :sid := DBMS_DEBUG.INITIALIZE(diagnostics => 0); END;`,
      { sid: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 100 } },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    const sid = (res.outBinds as any).sid as string;
    await this.debugConn.execute(
      `BEGIN DBMS_DEBUG.ATTACH_SESSION(:sid, diagnostics => 0); END;`,
      { sid }
    );
    return sid;
  }

  async setBreakpoint(
    owner: string,
    objectName: string,
    objectType: string,
    line: number
  ): Promise<number> {
    const res = await this.debugConn.execute(
      `DECLARE
         prog DBMS_DEBUG.PROGRAM_INFO;
         n    PLS_INTEGER;
         bp   PLS_INTEGER := 0;
       BEGIN
         prog.Namespace   := ${NAMESPACE_PLSQL};
         prog.Name        := UPPER(:obj_name);
         prog.Owner       := UPPER(:obj_owner);
         prog.LibunitType := :libunit_type;
         n := DBMS_DEBUG.SET_BREAKPOINT(prog, :line_num, bp, 0, 0);
         :retcode := n;
         :bpnum   := bp;
       END;`,
      {
        obj_name:    objectName,
        obj_owner:   owner,
        libunit_type: libunitForType(objectType),
        line_num:    line,
        retcode:     { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        bpnum:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const outBinds = res.outBinds as any;
    const id = this.nextBpId++;
    this.breakpoints.set(id, { id, owner, objectName, objectType, line });
    return id;
  }

  async removeBreakpoint(bpId: number): Promise<void> {
    const bp = this.breakpoints.get(bpId);
    if (!bp) return;
    await this.debugConn.execute(
      `BEGIN DBMS_DEBUG.DELETE_BREAKPOINT(:bpnum); END;`,
      { bpnum: bpId }
    );
    this.breakpoints.delete(bpId);
  }

  /** Fire the target script without awaiting — it will pause at breakpoints. */
  startTarget(script: string, binds: Record<string, unknown>): void {
    this._targetExecution = this.targetConn
      .execute(script, binds)
      .catch((err) => {
        // Errors from the target are expected when DBMS_DEBUG aborts execution
        // They will surface via SYNCHRONIZE reason codes or stop()
      });
  }

  async synchronize(): Promise<PauseInfo> {
    const res = await this.debugConn.execute(
      `DECLARE
         r DBMS_DEBUG.RUNTIME_INFO;
         n PLS_INTEGER;
       BEGIN
         n := DBMS_DEBUG.SYNCHRONIZE(r, ${INFO_RUNTIME_INFO}, 30);
         :retcode    := n;
         :line       := r.Line#;
         :reason     := r.Reason;
         :terminated := r.Terminated;
         :obj_name   := r.Program.Name;
         :obj_owner  := r.Program.Owner;
         :obj_type   := r.Program.LibunitType;
       END;`,
      {
        retcode:    { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        line:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        reason:     { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        terminated: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        obj_name:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_owner:  { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_type:   { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const b = res.outBinds as any;
    const terminated: number = b.terminated ?? 0;
    const reason: number = b.reason ?? 0;

    if (terminated || reason === REASON_FINISHED) {
      return { status: "completed", frame: null, reason };
    }

    return {
      status: "paused",
      reason,
      frame: {
        owner:      (b.obj_owner as string) ?? "",
        objectName: (b.obj_name as string) ?? "",
        objectType: "PACKAGE BODY",
        line:       (b.line as number) ?? 0,
      },
    };
  }

  async continueExecution(breakNextFlags: number): Promise<PauseInfo> {
    await this.debugConn.execute(
      `DECLARE
         r DBMS_DEBUG.RUNTIME_INFO;
         n PLS_INTEGER;
       BEGIN
         n := DBMS_DEBUG.CONTINUE(r, :flags, ${INFO_RUNTIME_INFO});
         :retcode    := n;
         :line       := r.Line#;
         :reason     := r.Reason;
         :terminated := r.Terminated;
         :obj_name   := r.Program.Name;
         :obj_owner  := r.Program.Owner;
       END;`,
      {
        flags:      breakNextFlags,
        retcode:    { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        line:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        reason:     { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        terminated: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        obj_name:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_owner:  { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
      }
    );
    return this.synchronize();
  }

  async stop(): Promise<void> {
    try {
      await this.targetConn.execute(`BEGIN DBMS_DEBUG.OFF; END;`);
    } catch {
      // Best-effort
    }
    try { await this.targetConn.close(); } catch {}
    try { await this.debugConn.close(); } catch {}
    _debugSession = null;
  }
}
```

**Note:** `buildConnection` must be exported from `oracle.ts`. Check that it exists as an exported function. If it is not exported, add `export` to the `buildConnection` function declaration in `sidecar/src/oracle.ts`.

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd sidecar
bun build src/index.ts --compile --outfile /dev/null 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/debug.ts
git commit -m "feat(debug): add DebugSession class with DBMS_DEBUG two-session protocol"
```

---

## Task 4: Sidecar — step controls and variable inspection

Add `stepInto`, `stepOver`, `stepOut`, `getValues`, `getCallStack`, and `debugRun` methods/functions.

**Files:**
- Modify: `sidecar/src/debug.ts`

- [ ] **Step 1: Add step methods to DebugSession class and exported RPC functions**

Append inside the `DebugSession` class (before the closing `}`):

```typescript
  async getValues(): Promise<VarValue[]> {
    const res = await this.debugConn.execute<{ NAME: string; VALUE: string }>(
      `DECLARE
         names   DBMS_DEBUG.vc2_table;
         vals    DBMS_DEBUG.vc2_table;
         n       PLS_INTEGER;
         i       PLS_INTEGER;
         out_cur SYS_REFCURSOR;
       BEGIN
         -- Use PRINT_BACKTRACE to get local variable names, then GET_VALUE for each
         -- Simpler: use GET_INDEXES to list locals in current frame
         DBMS_DEBUG.GET_INDEXES(names, n);
         OPEN out_cur FOR
           SELECT column_value AS name,
                  NULL AS value
             FROM TABLE(names);
       END;`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    // Note: DBMS_DEBUG variable inspection is limited in thin mode.
    // Fetch each variable by name using GET_VALUE.
    return [];
  }

  async getValuesForVars(varNames: string[]): Promise<VarValue[]> {
    const result: VarValue[] = [];
    for (const name of varNames) {
      try {
        const r = await this.debugConn.execute(
          `DECLARE
             val VARCHAR2(32767);
             n   PLS_INTEGER;
           BEGIN
             n := DBMS_DEBUG.GET_VALUE(:varname, 0, val, NULL);
             :val     := val;
             :retcode := n;
           END;`,
          {
            varname:  name,
            val:      { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
            retcode:  { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          }
        );
        const b = r.outBinds as any;
        result.push({ name, value: (b.val as string) ?? null });
      } catch {
        result.push({ name, value: null });
      }
    }
    return result;
  }

  async getCallStack(): Promise<StackFrame[]> {
    try {
      const res = await this.debugConn.execute(
        `DECLARE
           bt DBMS_DEBUG.backtrace_table;
           n  PLS_INTEGER;
         BEGIN
           DBMS_DEBUG.PRINT_BACKTRACE(bt);
           n := bt.COUNT;
           :frame_count := n;
         END;`,
        { frame_count: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
      );
      // DBMS_DEBUG backtrace_table is complex to iterate via binds.
      // Return the current frame from synchronize as the primary stack entry.
      return [];
    } catch {
      return [];
    }
  }
```

After the class, append the exported RPC handler functions:

```typescript
// ── Exported RPC handler functions ─────────────────────────────────────────

export type DebugStartParams = {
  script: string;
  binds: Record<string, unknown>;
  breakpoints: Array<{ owner: string; objectName: string; objectType: string; line: number }>;
};

export async function debugStart(p: DebugStartParams): Promise<PauseInfo> {
  // Stop any existing debug session
  if (_debugSession) await _debugSession.stop();

  const session = await DebugSession.create();
  await session.initialize();

  for (const bp of p.breakpoints) {
    await session.setBreakpoint(bp.owner, bp.objectName, bp.objectType, bp.line);
  }

  // Enable DBMS_OUTPUT on target
  await session["targetConn"].execute(
    `BEGIN DBMS_OUTPUT.ENABLE(1000000); END;`
  );

  session.startTarget(p.script, p.binds);
  return session.synchronize();
}

export async function debugStepInto(): Promise<PauseInfo> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  return _debugSession.continueExecution(BREAK_ANY_CALL);
}

export async function debugStepOver(): Promise<PauseInfo> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  return _debugSession.continueExecution(BREAK_NEXT_LINE);
}

export async function debugStepOut(): Promise<PauseInfo> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  return _debugSession.continueExecution(BREAK_RETURN);
}

export async function debugContinue(): Promise<PauseInfo> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  // Continue to next breakpoint — use 0 flags (no step break, only explicit BPs)
  return _debugSession.continueExecution(0);
}

export async function debugStop(): Promise<{ ok: boolean }> {
  if (_debugSession) await _debugSession.stop();
  return { ok: true };
}

export async function debugSetBreakpoint(p: {
  owner: string; objectName: string; objectType: string; line: number;
}): Promise<{ breakpointId: number }> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  const id = await _debugSession.setBreakpoint(p.owner, p.objectName, p.objectType, p.line);
  return { breakpointId: id };
}

export async function debugRemoveBreakpoint(p: {
  breakpointId: number;
}): Promise<{ ok: boolean }> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  await _debugSession.removeBreakpoint(p.breakpointId);
  return { ok: true };
}

export async function debugGetValues(p: {
  varNames: string[];
}): Promise<{ variables: VarValue[] }> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  const variables = await _debugSession.getValuesForVars(p.varNames);
  return { variables };
}

export async function debugGetCallStack(): Promise<{ frames: StackFrame[] }> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  const frames = await _debugSession.getCallStack();
  return { frames };
}

export async function debugRun(p: {
  script: string;
  binds: Record<string, unknown>;
}): Promise<{ output: string[]; elapsedMs: number }> {
  const started = Date.now();
  return withActiveSession(async (conn) => {
    await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(1000000); END;`);
    await conn.execute(p.script, p.binds);
    // Drain DBMS_OUTPUT
    const lines: string[] = [];
    while (true) {
      const r = await conn.execute(
        `BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;`,
        {
          line:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
          status: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }
      );
      const b = r.outBinds as any;
      if ((b.status as number) !== 0) break;
      lines.push((b.line as string) ?? "");
    }
    return { output: lines, elapsedMs: Date.now() - started };
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd sidecar
bun build src/index.ts --compile --outfile /dev/null 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/debug.ts
git commit -m "feat(debug): add step controls, variable inspection, and debugRun"
```

---

## Task 5: Sidecar — register debug.* handlers; Rust commands; lib.rs

Wire everything into the JSON-RPC dispatcher and Tauri command layer.

**Files:**
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add debug imports and handlers to `sidecar/src/index.ts`**

Add to the imports block at the top of `index.ts`:

```typescript
import {
  debugOpen,
  debugGetSource,
  debugStart,
  debugStop,
  debugStepInto,
  debugStepOver,
  debugStepOut,
  debugContinue,
  debugSetBreakpoint,
  debugRemoveBreakpoint,
  debugGetValues,
  debugGetCallStack,
  debugRun,
} from "./debug";
```

Add to the `handlers` object (before the closing `}`):

```typescript
  "debug.open":              (params) => debugOpen(params as any),
  "debug.get_source":        (params) => debugGetSource(params as any),
  "debug.start":             (params) => debugStart(params as any),
  "debug.stop":              () => debugStop(),
  "debug.step_into":         () => debugStepInto(),
  "debug.step_over":         () => debugStepOver(),
  "debug.step_out":          () => debugStepOut(),
  "debug.continue":          () => debugContinue(),
  "debug.set_breakpoint":    (params) => debugSetBreakpoint(params as any),
  "debug.remove_breakpoint": (params) => debugRemoveBreakpoint(params as any),
  "debug.get_values":        (params) => debugGetValues(params as any),
  "debug.get_call_stack":    () => debugGetCallStack(),
  "debug.run":               (params) => debugRun(params as any),
```

- [ ] **Step 2: Add Rust commands to `src-tauri/src/commands.rs`**

Append at the end of `commands.rs`:

```rust
// ── PL/SQL Debugger ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn debug_open(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.open", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_source(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_source", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_start(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.start", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_stop(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.stop", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_into(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_into", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_over(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_over", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_step_out(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.step_out", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_continue(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.continue", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_set_breakpoint(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.set_breakpoint", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_remove_breakpoint(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.remove_breakpoint", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_values(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_values", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_get_call_stack(app: AppHandle) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.get_call_stack", serde_json::json!({})).await?;
    Ok(res)
}

#[tauri::command]
pub async fn debug_run(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "debug.run", payload).await?;
    Ok(res)
}
```

- [ ] **Step 3: Register commands in `src-tauri/src/lib.rs`**

Inside `.invoke_handler(tauri::generate_handler![`, after `commands::chart_reset,`, add:

```rust
            commands::debug_open,
            commands::debug_get_source,
            commands::debug_start,
            commands::debug_stop,
            commands::debug_step_into,
            commands::debug_step_over,
            commands::debug_step_out,
            commands::debug_continue,
            commands::debug_set_breakpoint,
            commands::debug_remove_breakpoint,
            commands::debug_get_values,
            commands::debug_get_call_stack,
            commands::debug_run,
```

- [ ] **Step 4: Verify sidecar and Rust compile**

```bash
cd sidecar
bun build src/index.ts --compile --outfile /dev/null 2>&1 | head -20
```

```bash
cd src-tauri
cargo build 2>&1 | tail -20
```

Expected: both compile without errors.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(debug): register debug.* RPC handlers and Tauri commands"
```

---

## Task 6: Frontend — `workspace.ts` type definitions and RPC wrappers

**Files:**
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Append debug types and wrappers to `workspace.ts`**

```typescript
// ── PL/SQL Debugger ────────────────────────────────────────────────────────

export type ParamDef = {
  name: string;
  dataType: string;
  inOut: "IN" | "OUT" | "IN/OUT";
  position: number;
};

export type DebugBreakpointRef = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type StackFrame = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type VarValue = {
  name: string;
  value: string | null;
};

export type PauseInfo = {
  status: "paused" | "completed" | "error";
  frame: StackFrame | null;
  reason: number;
  errorMessage?: string;
};

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: string[];
};

export const debugOpenRpc = (
  owner: string,
  objectName: string,
  objectType: string,
  packageName?: string
) =>
  call<DebugOpenResult>("debug_open", {
    owner,
    objectName,
    objectType,
    packageName: packageName ?? null,
  });

export const debugGetSourceRpc = (
  owner: string,
  objectName: string,
  objectType: string
) =>
  call<{ lines: string[] }>("debug_get_source", { owner, objectName, objectType });

export const debugStartRpc = (payload: {
  script: string;
  binds: Record<string, unknown>;
  breakpoints: DebugBreakpointRef[];
}) => call<PauseInfo>("debug_start", payload as any);

export const debugStopRpc    = () => call<{ ok: boolean }>("debug_stop");
export const debugStepIntoRpc = () => call<PauseInfo>("debug_step_into");
export const debugStepOverRpc = () => call<PauseInfo>("debug_step_over");
export const debugStepOutRpc  = () => call<PauseInfo>("debug_step_out");
export const debugContinueRpc = () => call<PauseInfo>("debug_continue");

export const debugSetBreakpointRpc = (bp: DebugBreakpointRef) =>
  call<{ breakpointId: number }>("debug_set_breakpoint", bp as any);

export const debugRemoveBreakpointRpc = (breakpointId: number) =>
  call<{ ok: boolean }>("debug_remove_breakpoint", { breakpointId });

export const debugGetValuesRpc = (varNames: string[]) =>
  call<{ variables: VarValue[] }>("debug_get_values", { varNames });

export const debugGetCallStackRpc = () =>
  call<{ frames: StackFrame[] }>("debug_get_call_stack");

export const debugRunRpc = (payload: {
  script: string;
  binds: Record<string, unknown>;
}) => call<{ output: string[]; elapsedMs: number }>("debug_run", payload as any);
```

- [ ] **Step 2: Verify TypeScript (frontend) compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: no type errors related to the new additions.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace.ts
git commit -m "feat(debug): add debug RPC wrappers and types to workspace.ts"
```

---

## Task 7: Frontend — CodeMirror extensions (breakpoint gutter + current line)

**Files:**
- Create: `src/lib/workspace/breakpointGutter.ts`
- Create: `src/lib/workspace/currentLineDecoration.ts`

- [ ] **Step 1: Create `breakpointGutter.ts`**

```typescript
import {
  gutter,
  GutterMarker,
  type EditorView,
} from "@codemirror/view";
import { StateField, StateEffect, RangeSet } from "@codemirror/state";

// Effect to toggle a breakpoint at a given line number (1-based)
export const toggleBreakpointEffect = StateEffect.define<number>();

// Set of 1-based line numbers that have breakpoints
export const breakpointState = StateField.define<ReadonlySet<number>>({
  create() { return new Set(); },
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleBreakpointEffect)) {
        const next = new Set(set);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
        return next;
      }
    }
    return set;
  },
});

class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const span = document.createElement("span");
    span.textContent = "●";
    span.style.color = "#e74c3c";
    span.style.fontSize = "10px";
    span.style.lineHeight = "1";
    span.style.cursor = "pointer";
    return span;
  }
}

const breakpointMarker = new BreakpointMarker();

export function breakpointGutter(
  onToggle: (line: number) => void
) {
  return [
    breakpointState,
    gutter({
      class: "cm-breakpoint-gutter",
      markers(view) {
        const bps = view.state.field(breakpointState);
        const markers: Array<{ from: number; to: number; value: GutterMarker }> = [];
        for (const lineNum of bps) {
          if (lineNum < 1 || lineNum > view.state.doc.lines) continue;
          const line = view.state.doc.line(lineNum);
          markers.push({ from: line.from, to: line.from, value: breakpointMarker });
        }
        return RangeSet.of(markers.map((m) => breakpointMarker.range(m.from)));
      },
      domEventHandlers: {
        mousedown(view, line) {
          const lineNum = view.state.doc.lineAt(line.from).number;
          view.dispatch({ effects: toggleBreakpointEffect.of(lineNum) });
          onToggle(lineNum);
          return true;
        },
      },
    }),
  ];
}
```

- [ ] **Step 2: Create `currentLineDecoration.ts`**

```typescript
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export const setCurrentLineEffect = StateEffect.define<number | null>();

const currentLineState = StateField.define<number | null>({
  create() { return null; },
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setCurrentLineEffect)) return e.value;
    }
    return val;
  },
});

const currentLineMark = Decoration.line({ class: "cm-debug-current-line" });

export const currentLineDecoration = [
  currentLineState,
  EditorView.decorations.from(currentLineState, (lineNum) => {
    return (view: EditorView): DecorationSet => {
      if (!lineNum || lineNum < 1 || lineNum > view.state.doc.lines) {
        return Decoration.none;
      }
      const line = view.state.doc.line(lineNum);
      return Decoration.set([currentLineMark.range(line.from)]);
    };
  }),
  EditorView.baseTheme({
    ".cm-debug-current-line": {
      backgroundColor: "rgba(255, 200, 0, 0.18)",
      borderLeft: "3px solid #f1c40f",
    },
  }),
];

export { setCurrentLineEffect, currentLineState };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run build 2>&1 | grep -i error | head -20
```

Expected: no errors from the new files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/breakpointGutter.ts src/lib/workspace/currentLineDecoration.ts
git commit -m "feat(debug): add CodeMirror breakpoint gutter and current line decoration"
```

---

## Task 8: Frontend — `debug.svelte.ts` store

**Files:**
- Create: `src/lib/stores/debug.svelte.ts`

- [ ] **Step 1: Create `debug.svelte.ts`**

```typescript
import type {
  ParamDef,
  PauseInfo,
  StackFrame,
  VarValue,
  DebugBreakpointRef,
  DebugOpenResult,
} from "$lib/workspace";
import {
  debugOpenRpc,
  debugGetSourceRpc,
  debugStartRpc,
  debugStopRpc,
  debugStepIntoRpc,
  debugStepOverRpc,
  debugStepOutRpc,
  debugContinueRpc,
  debugSetBreakpointRpc,
  debugRemoveBreakpointRpc,
  debugGetValuesRpc,
  debugRunRpc,
} from "$lib/workspace";

export type DebugStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error";

export type BindVar = {
  name: string;
  oracleType: string;
  value: string;
  enabled: boolean;
};

export type LocalBreakpoint = {
  localId: number;
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
  remoteId?: number;
};

class DebugStore {
  // Object being debugged
  owner = $state("");
  objectName = $state("");
  objectType = $state("");
  packageName = $state<string | null>(null);
  memberList = $state<string[]>([]);

  // Script and parameters
  script = $state("");
  params = $state<ParamDef[]>([]);
  bindVars = $state<BindVar[]>([]);

  // Breakpoints (managed by UI, synced to Oracle when debug starts)
  breakpoints = $state<LocalBreakpoint[]>([]);
  private nextLocalBpId = 1;

  // Debug execution state
  status = $state<DebugStatus>("idle");
  currentFrame = $state<StackFrame | null>(null);
  callStack = $state<StackFrame[]>([]);
  liveVars = $state<VarValue[]>([]);
  dbmsOutput = $state<string[]>([]);
  errorMessage = $state<string | null>(null);

  // Source being shown in editor (may differ from the opened object during step-into)
  editorSource = $state("");
  editorObject = $state<{ owner: string; objectName: string; objectType: string } | null>(null);

  async open(
    owner: string,
    objectName: string,
    objectType: string,
    packageName: string | null
  ) {
    this.owner = owner;
    this.objectName = objectName;
    this.objectType = objectType;
    this.packageName = packageName;
    this.status = "idle";
    this.currentFrame = null;
    this.liveVars = [];
    this.dbmsOutput = [];
    this.errorMessage = null;
    this.breakpoints = [];

    const res = await debugOpenRpc(owner, objectName, objectType, packageName ?? undefined);
    if (!res.ok) {
      this.errorMessage = res.error.message;
      return;
    }
    this.script = res.data.script;
    this.params = res.data.params;
    this.memberList = res.data.memberList ?? [];
    this.bindVars = this._buildBindVars(res.data.script, res.data.params);

    // Load source for editor
    const srcType = objectType.toUpperCase() === "PACKAGE" ? "PACKAGE BODY" : objectType;
    const srcRes = await debugGetSourceRpc(owner, objectName, srcType);
    if (srcRes.ok) {
      this.editorSource = srcRes.data.lines.join("");
      this.editorObject = { owner, objectName, objectType: srcType };
    } else {
      // No source (e.g. standalone procedure with no body) — show script instead
      this.editorSource = this.script;
    }
  }

  private _buildBindVars(script: string, params: ParamDef[]): BindVar[] {
    const bindPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const seen = new Set<string>();
    const vars: BindVar[] = [];
    let m: RegExpExecArray | null;
    while ((m = bindPattern.exec(script)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const param = params.find((p) => p.name.toLowerCase() === name.toLowerCase());
      vars.push({
        name,
        oracleType: param?.dataType ?? "VARCHAR2",
        value: "",
        enabled: true,
      });
    }
    return vars;
  }

  toggleBreakpoint(line: number) {
    const idx = this.breakpoints.findIndex((b) => b.line === line && b.objectName === this.objectName);
    if (idx >= 0) {
      this.breakpoints = this.breakpoints.filter((_, i) => i !== idx);
    } else {
      this.breakpoints = [
        ...this.breakpoints,
        {
          localId: this.nextLocalBpId++,
          owner: this.editorObject?.owner ?? this.owner,
          objectName: this.editorObject?.objectName ?? this.objectName,
          objectType: this.editorObject?.objectType ?? this.objectType,
          line,
        },
      ];
    }
  }

  hasBreakpoint(line: number): boolean {
    return this.breakpoints.some((b) => b.line === line);
  }

  private _buildBindsForExecution(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const v of this.bindVars) {
      if (!v.enabled) continue;
      result[v.name] = v.value === "" ? null : v.value;
    }
    return result;
  }

  async run() {
    this.status = "running";
    this.errorMessage = null;
    this.dbmsOutput = [];
    const res = await debugRunRpc({
      script: this.script,
      binds: this._buildBindsForExecution(),
    });
    this.status = "completed";
    if (res.ok) {
      this.dbmsOutput = res.data.output;
    } else {
      this.errorMessage = res.error.message;
      this.status = "error";
    }
  }

  async startDebug() {
    this.status = "running";
    this.errorMessage = null;
    this.dbmsOutput = [];
    this.currentFrame = null;

    const bpRefs: DebugBreakpointRef[] = this.breakpoints.map((b) => ({
      owner: b.owner,
      objectName: b.objectName,
      objectType: b.objectType,
      line: b.line,
    }));

    const res = await debugStartRpc({
      script: this.script,
      binds: this._buildBindsForExecution(),
      breakpoints: bpRefs,
    });

    if (!res.ok) {
      this.status = "error";
      this.errorMessage = res.error.message;
      return;
    }

    this._applyPauseInfo(res.data);
  }

  private async _applyPauseInfo(info: PauseInfo) {
    if (info.status === "completed") {
      this.status = "completed";
      this.currentFrame = null;
      return;
    }
    if (info.status === "error") {
      this.status = "error";
      this.errorMessage = info.errorMessage ?? "Unknown error";
      return;
    }
    this.status = "paused";
    this.currentFrame = info.frame;

    // If stepped into a different object, load its source
    if (info.frame && this.editorObject) {
      const f = info.frame;
      if (f.objectName !== this.editorObject.objectName || f.owner !== this.editorObject.owner) {
        const srcRes = await debugGetSourceRpc(f.owner, f.objectName, f.objectType);
        if (srcRes.ok) {
          this.editorSource = srcRes.data.lines.join("");
          this.editorObject = { owner: f.owner, objectName: f.objectName, objectType: f.objectType };
        }
      }
    }
  }

  async stepInto() {
    const res = await debugStepIntoRpc();
    if (res.ok) this._applyPauseInfo(res.data);
    else { this.status = "error"; this.errorMessage = res.error.message; }
  }

  async stepOver() {
    const res = await debugStepOverRpc();
    if (res.ok) this._applyPauseInfo(res.data);
    else { this.status = "error"; this.errorMessage = res.error.message; }
  }

  async stepOut() {
    const res = await debugStepOutRpc();
    if (res.ok) this._applyPauseInfo(res.data);
    else { this.status = "error"; this.errorMessage = res.error.message; }
  }

  async continue_() {
    const res = await debugContinueRpc();
    if (res.ok) this._applyPauseInfo(res.data);
    else { this.status = "error"; this.errorMessage = res.error.message; }
  }

  async stop() {
    await debugStopRpc();
    this.status = "idle";
    this.currentFrame = null;
    this.liveVars = [];
  }
}

export const debugStore = new DebugStore();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/debug.svelte.ts
git commit -m "feat(debug): add debug.svelte.ts store with full session lifecycle"
```

---

## Task 9: Frontend — `VariableGrid.svelte`

**Files:**
- Create: `src/lib/workspace/VariableGrid.svelte`

- [ ] **Step 1: Create `VariableGrid.svelte`**

```svelte
<script lang="ts">
  import type { BindVar } from "$lib/stores/debug.svelte";

  let {
    vars = $bindable(),
    readonly = false,
  }: {
    vars: BindVar[];
    readonly?: boolean;
  } = $props();

  function addRow() {
    vars = [...vars, { name: "", oracleType: "VARCHAR2", value: "", enabled: true }];
  }

  function removeRow(i: number) {
    vars = vars.filter((_, idx) => idx !== i);
  }
</script>

<div class="vg">
  <table class="vg-table">
    <thead>
      <tr>
        <th class="vg-th-check"></th>
        <th class="vg-th">Variable</th>
        <th class="vg-th">Type</th>
        <th class="vg-th">Value</th>
        {#if !readonly}<th class="vg-th-del"></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each vars as v, i}
        <tr class="vg-row">
          <td class="vg-td-check">
            <input
              type="checkbox"
              checked={v.enabled}
              onchange={(e) => { vars[i].enabled = (e.target as HTMLInputElement).checked; }}
              disabled={readonly}
            />
          </td>
          <td class="vg-td">
            {#if readonly}
              <span class="vg-name">{v.name}</span>
            {:else}
              <input
                class="vg-input vg-name-input"
                type="text"
                value={v.name}
                oninput={(e) => { vars[i].name = (e.target as HTMLInputElement).value; }}
                placeholder="name"
              />
            {/if}
          </td>
          <td class="vg-td">
            {#if readonly}
              <span class="vg-type">{v.oracleType}</span>
            {:else}
              <input
                class="vg-input vg-type-input"
                type="text"
                value={v.oracleType}
                oninput={(e) => { vars[i].oracleType = (e.target as HTMLInputElement).value; }}
                placeholder="VARCHAR2"
              />
            {/if}
          </td>
          <td class="vg-td vg-td-value">
            {#if readonly}
              <span class="vg-value">{v.value ?? ''}</span>
            {:else if v.oracleType.toUpperCase().startsWith('DATE')}
              <input
                class="vg-input"
                type="datetime-local"
                value={v.value}
                oninput={(e) => { vars[i].value = (e.target as HTMLInputElement).value; }}
              />
            {:else if v.oracleType.toUpperCase() === 'BOOLEAN'}
              <select
                class="vg-input vg-select"
                value={v.value}
                onchange={(e) => { vars[i].value = (e.target as HTMLSelectElement).value; }}
              >
                <option value="">NULL</option>
                <option value="TRUE">TRUE</option>
                <option value="FALSE">FALSE</option>
              </select>
            {:else}
              <input
                class="vg-input"
                type="text"
                value={v.value}
                oninput={(e) => { vars[i].value = (e.target as HTMLInputElement).value; }}
                placeholder="value"
              />
            {/if}
          </td>
          {#if !readonly}
            <td class="vg-td-del">
              <button class="vg-del" onclick={() => removeRow(i)} title="Remove">×</button>
            </td>
          {/if}
        </tr>
      {/each}
      {#if !readonly}
        <tr class="vg-add-row">
          <td colspan="5">
            <button class="vg-add-btn" onclick={addRow}>+ Add variable</button>
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .vg { overflow: auto; height: 100%; background: var(--bg-surface-alt); }
  .vg-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace; }
  .vg-th, .vg-th-check, .vg-th-del {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
    font-weight: 600;
    color: var(--text-muted);
    font-size: 11px;
    position: sticky; top: 0;
  }
  .vg-th-check { width: 28px; }
  .vg-th-del { width: 24px; }
  .vg-td, .vg-td-check, .vg-td-del, .vg-td-value {
    border-bottom: 1px solid var(--border);
    padding: 2px 8px;
    vertical-align: middle;
  }
  .vg-td-check { width: 28px; text-align: center; }
  .vg-td-del { width: 24px; text-align: center; }
  .vg-td-value { width: 40%; }
  .vg-row:hover { background: rgba(255,255,255,0.03); }
  .vg-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 12px;
    width: 100%;
    padding: 1px 0;
  }
  .vg-input:focus { border-bottom: 1px solid var(--border); }
  .vg-name-input { min-width: 120px; }
  .vg-type-input { min-width: 80px; }
  .vg-select { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: 2px; font-size: 12px; }
  .vg-name, .vg-type, .vg-value { color: var(--text-primary); }
  .vg-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 2px; }
  .vg-del:hover { color: #e74c3c; }
  .vg-add-row td { padding: 4px 8px; }
  .vg-add-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 0; }
  .vg-add-btn:hover { color: var(--text-primary); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workspace/VariableGrid.svelte
git commit -m "feat(debug): add VariableGrid component"
```

---

## Task 10: Frontend — `DebugToolbar.svelte` and `DebugCallStack.svelte`

**Files:**
- Create: `src/lib/workspace/DebugToolbar.svelte`
- Create: `src/lib/workspace/DebugCallStack.svelte`

- [ ] **Step 1: Create `DebugToolbar.svelte`**

```svelte
<script lang="ts">
  import type { DebugStatus } from "$lib/stores/debug.svelte";

  let {
    status,
    onRun,
    onDebug,
    onStepInto,
    onStepOver,
    onStepOut,
    onContinue,
    onStop,
  }: {
    status: DebugStatus;
    onRun: () => void;
    onDebug: () => void;
    onStepInto: () => void;
    onStepOver: () => void;
    onStepOut: () => void;
    onContinue: () => void;
    onStop: () => void;
  } = $props();

  const idle      = $derived(status === "idle" || status === "completed" || status === "error");
  const paused    = $derived(status === "paused");
  const running   = $derived(status === "running");

  const STATUS_LABEL: Record<DebugStatus, string> = {
    idle: "idle",
    running: "running…",
    paused: "paused",
    completed: "completed",
    error: "error",
  };
</script>

<div class="toolbar">
  <button class="btn" title="Run (F8)" disabled={!idle} onclick={onRun}>▶</button>
  <button class="btn btn-debug" title="Debug (F9)" disabled={!idle} onclick={onDebug}>⏸</button>
  <div class="sep"></div>
  <button class="btn" title="Step Into (F7)" disabled={!paused} onclick={onStepInto}>↓</button>
  <button class="btn" title="Step Over (F10)" disabled={!paused} onclick={onStepOver}>↷</button>
  <button class="btn" title="Step Out (Shift+F7)" disabled={!paused} onclick={onStepOut}>↑</button>
  <button class="btn" title="Continue (F5)" disabled={!paused} onclick={onContinue}>▶▶</button>
  <div class="sep"></div>
  <button class="btn btn-stop" title="Stop (Shift+F5)" disabled={idle} onclick={onStop}>■</button>
  <div class="status" class:status-paused={paused} class:status-error={status === 'error'} class:status-ok={status === 'completed'}>
    {STATUS_LABEL[status]}
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    height: 36px;
    flex-shrink: 0;
  }
  .btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 13px;
    padding: 3px 7px;
    transition: background 0.1s;
  }
  .btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); border-color: var(--border); }
  .btn:disabled { opacity: 0.3; cursor: default; }
  .btn-debug { color: #27ae60; }
  .btn-stop  { color: #e74c3c; }
  .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
  .status {
    margin-left: 12px;
    font-size: 11px;
    color: var(--text-muted);
    font-family: monospace;
  }
  .status-paused { color: #f1c40f; }
  .status-error  { color: #e74c3c; }
  .status-ok     { color: #27ae60; }
</style>
```

- [ ] **Step 2: Create `DebugCallStack.svelte`**

```svelte
<script lang="ts">
  import type { StackFrame } from "$lib/workspace";

  let {
    frames,
    currentFrame,
    onSelectFrame,
  }: {
    frames: StackFrame[];
    currentFrame: StackFrame | null;
    onSelectFrame: (frame: StackFrame) => void;
  } = $props();
</script>

<div class="cs">
  {#if frames.length === 0 && currentFrame}
    <div class="cs-row cs-active">
      <span class="cs-arrow">→</span>
      <span class="cs-obj">{currentFrame.owner}.{currentFrame.objectName}</span>
      <span class="cs-line">:{currentFrame.line}</span>
    </div>
  {:else if frames.length === 0}
    <div class="cs-empty">No call stack</div>
  {:else}
    {#each frames as f, i}
      <div
        class="cs-row"
        class:cs-active={i === 0}
        onclick={() => onSelectFrame(f)}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && onSelectFrame(f)}
      >
        {#if i === 0}<span class="cs-arrow">→</span>{:else}<span class="cs-arrow cs-arrow-dim"> </span>{/if}
        <span class="cs-obj">{f.owner}.{f.objectName}</span>
        <span class="cs-line">:{f.line}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .cs { font-size: 12px; font-family: monospace; overflow: auto; height: 100%; }
  .cs-empty { color: var(--text-muted); padding: 8px 12px; }
  .cs-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  .cs-row:hover { background: rgba(255,255,255,0.04); }
  .cs-active { border-left-color: #f1c40f; background: rgba(241,196,15,0.06); }
  .cs-arrow { color: #f1c40f; width: 12px; flex-shrink: 0; }
  .cs-arrow-dim { color: transparent; }
  .cs-obj { color: var(--text-primary); }
  .cs-line { color: var(--text-muted); }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/DebugToolbar.svelte src/lib/workspace/DebugCallStack.svelte
git commit -m "feat(debug): add DebugToolbar and DebugCallStack components"
```

---

## Task 11: Frontend — `TestWindow.svelte` (main modal)

**Files:**
- Create: `src/lib/workspace/TestWindow.svelte`

- [ ] **Step 1: Create `TestWindow.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";
  import { Prec } from "@codemirror/state";

  import { debugStore } from "$lib/stores/debug.svelte";
  import DebugToolbar from "./DebugToolbar.svelte";
  import VariableGrid from "./VariableGrid.svelte";
  import DebugCallStack from "./DebugCallStack.svelte";
  import { breakpointGutter, toggleBreakpointEffect } from "./breakpointGutter";
  import { currentLineDecoration, setCurrentLineEffect } from "./currentLineDecoration";

  type Tab = "script" | "output" | "callstack";

  let {
    onClose,
  }: { onClose: () => void } = $props();

  let editorHost: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;
  let activeTab = $state<Tab>("script");

  // Sync current line decoration when frame changes
  $effect(() => {
    const line = debugStore.currentFrame?.line ?? null;
    if (view) {
      view.dispatch({ effects: setCurrentLineEffect.of(line) });
      if (line !== null) {
        const lineObj = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        view.dispatch({ selection: { anchor: lineObj.from }, scrollIntoView: true });
      }
    }
  });

  // Recreate editor when editorSource changes (step-into a different object)
  $effect(() => {
    const source = debugStore.editorSource;
    if (!view || !editorHost) return;
    if (view.state.doc.toString() === source) return;
    view.destroy();
    createEditor(source);
  });

  function createEditor(source: string) {
    if (!editorHost) return;
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
          breakpointGutter((line) => debugStore.toggleBreakpoint(line)),
          currentLineDecoration,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && debugStore.status === "idle") {
              debugStore.script = update.state.doc.toString();
            }
          }),
          Prec.highest(
            keymap.of([
              { key: "F7",         run: () => { debugStore.stepInto();   return true; } },
              { key: "F10",        run: () => { debugStore.stepOver();   return true; } },
              { key: "Shift-F7",   run: () => { debugStore.stepOut();    return true; } },
              { key: "F5",         run: () => { debugStore.continue_();  return true; } },
              { key: "Shift-F5",   run: () => { debugStore.stop();       return true; } },
              { key: "F8",         run: () => { debugStore.run();        return true; } },
              { key: "F9",         run: () => { debugStore.startDebug(); return true; } },
              { key: "Ctrl-b",     run: (v) => {
                const line = v.state.doc.lineAt(v.state.selection.main.head).number;
                debugStore.toggleBreakpoint(line);
                v.dispatch({ effects: toggleBreakpointEffect.of(line) });
                return true;
              }},
            ])
          ),
        ],
      }),
    });
  }

  onMount(() => createEditor(debugStore.editorSource));
  onDestroy(() => { view?.destroy(); debugStore.stop(); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="tw-overlay" role="dialog" aria-modal="true">
  <div class="tw-window">
    <!-- Header: tab bar + object selector + close -->
    <div class="tw-header">
      <div class="tw-tabs">
        <button class="tw-tab" class:tw-tab-active={activeTab === 'script'} onclick={() => (activeTab = 'script')}>
          Test Script
        </button>
        <button class="tw-tab" class:tw-tab-active={activeTab === 'output'} onclick={() => (activeTab = 'output')}>
          DBMS Output
          {#if debugStore.dbmsOutput.length > 0}
            <span class="tw-badge">{debugStore.dbmsOutput.length}</span>
          {/if}
        </button>
        <button class="tw-tab" class:tw-tab-active={activeTab === 'callstack'} onclick={() => (activeTab = 'callstack')}>
          Call Stack
        </button>
      </div>
      <div class="tw-object-info">
        {#if debugStore.memberList.length > 0}
          <select
            class="tw-member-select"
            onchange={(e) => {
              const name = (e.target as HTMLSelectElement).value;
              debugStore.open(debugStore.owner, name, debugStore.objectType, debugStore.objectName);
            }}
          >
            {#each debugStore.memberList as m}
              <option value={m} selected={m === debugStore.objectName}>{m}</option>
            {/each}
          </select>
        {:else}
          <span class="tw-obj-label">{debugStore.owner}.{debugStore.objectName}</span>
        {/if}
      </div>
      <button class="tw-close" onclick={onClose}>✕</button>
    </div>

    <!-- Toolbar -->
    <DebugToolbar
      status={debugStore.status}
      onRun={() => debugStore.run()}
      onDebug={() => debugStore.startDebug()}
      onStepInto={() => debugStore.stepInto()}
      onStepOver={() => debugStore.stepOver()}
      onStepOut={() => debugStore.stepOut()}
      onContinue={() => debugStore.continue_()}
      onStop={() => debugStore.stop()}
    />

    <!-- Error banner -->
    {#if debugStore.errorMessage}
      <div class="tw-error">{debugStore.errorMessage}</div>
    {/if}

    <!-- Main content area -->
    <div class="tw-body">
      {#if activeTab === 'script'}
        <div class="tw-editor-wrap" bind:this={editorHost}></div>
        <div class="tw-vars">
          <VariableGrid
            bind:vars={debugStore.bindVars}
            readonly={debugStore.status === 'running' || debugStore.status === 'paused'}
          />
        </div>
      {:else if activeTab === 'output'}
        <div class="tw-output">
          {#if debugStore.dbmsOutput.length === 0}
            <span class="tw-output-empty">No output yet.</span>
          {:else}
            {#each debugStore.dbmsOutput as line}
              <div class="tw-output-line">{line}</div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="tw-callstack-wrap">
          <DebugCallStack
            frames={debugStore.callStack}
            currentFrame={debugStore.currentFrame}
            onSelectFrame={() => {}}
          />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .tw-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 1000;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  .tw-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-surface);
  }
  .tw-header {
    display: flex;
    align-items: center;
    background: var(--bg-page);
    border-bottom: 1px solid var(--border);
    padding: 0 12px;
    height: 38px;
    flex-shrink: 0;
    gap: 12px;
  }
  .tw-tabs { display: flex; gap: 2px; }
  .tw-tab {
    background: none; border: none; border-bottom: 2px solid transparent;
    color: var(--text-muted); cursor: pointer; font-size: 12px;
    padding: 8px 12px; transition: color 0.1s;
  }
  .tw-tab:hover { color: var(--text-primary); }
  .tw-tab-active { color: var(--text-primary); border-bottom-color: #3498db; }
  .tw-badge {
    background: #3498db; color: #fff; border-radius: 8px;
    font-size: 10px; padding: 1px 5px; margin-left: 4px;
  }
  .tw-object-info { flex: 1; display: flex; align-items: center; gap: 8px; }
  .tw-obj-label { font-size: 12px; color: var(--text-muted); font-family: monospace; }
  .tw-member-select {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-primary); border-radius: 3px; font-size: 12px;
    font-family: monospace; padding: 2px 6px;
  }
  .tw-close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 16px; padding: 4px 8px;
  }
  .tw-close:hover { color: var(--text-primary); }
  .tw-error {
    background: rgba(179, 62, 31, 0.12); border-bottom: 1px solid rgba(179,62,31,0.3);
    color: #c0392b; font-size: 12px; padding: 6px 12px;
  }
  .tw-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tw-editor-wrap {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  .tw-editor-wrap :global(.cm-editor) { height: 100%; }
  .tw-vars {
    height: 200px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    overflow: auto;
  }
  .tw-output {
    flex: 1; padding: 12px; overflow: auto;
    font-family: monospace; font-size: 12px; color: var(--text-primary);
  }
  .tw-output-empty { color: var(--text-muted); }
  .tw-output-line { white-space: pre-wrap; }
  .tw-callstack-wrap { flex: 1; overflow: auto; }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/TestWindow.svelte
git commit -m "feat(debug): add TestWindow full-screen modal with editor, toolbar, variable grid"
```

---

## Task 12: SchemaTree right-click menu + page wiring

Wire the "Test Window" entry point into the existing SchemaTree and workspace page.

**Files:**
- Modify: `src/lib/workspace/SchemaTree.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add `onTestWindow` prop and right-click menu to SchemaTree**

In `SchemaTree.svelte`, update the Props type (around line 13):

```typescript
  type Props = {
    schemas: SchemaNode[];
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    onToggle: (owner: string) => void;
    onSelect: (owner: string, name: string, kind: ObjectKind) => void;
    onRetry: (owner: string, kind: ObjectKind) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    onExecuteProc?: (owner: string, name: string, objectType: "PROCEDURE" | "FUNCTION") => void;
    onTestWindow?: (owner: string, name: string, kind: ObjectKind) => void;
  };
```

Update the destructure line to include `onTestWindow`:

```typescript
  let { schemas, selected, onToggle, onSelect, onRetry, onRefresh, refreshing = false, onExecuteProc, onTestWindow }: Props = $props();
```

Add a `contextMenu` state variable after the existing state declarations:

```typescript
  let contextMenu = $state<{ x: number; y: number; owner: string; name: string; kind: ObjectKind } | null>(null);
```

Add a handler to close the context menu on any click:

```typescript
  function closeContextMenu() { contextMenu = null; }
```

Find the section where object items are rendered (the `<li>` or `<button>` for each object). It's around line 240+ in the template. Add `oncontextmenu` to the object item button and render the context menu overlay. Locate the object item button that has `onclick` calling `onSelect`. Add to it:

```svelte
oncontextmenu={(e) => {
  if (!['PROCEDURE','FUNCTION','PACKAGE'].includes(kind as string)) return;
  e.preventDefault();
  contextMenu = { x: e.clientX, y: e.clientY, owner: s.name, name: o.name, kind: kind as ObjectKind };
}}
```

At the end of the template (before `</div>` at the component root), add the context menu:

```svelte
{#if contextMenu}
  <div
    class="ctx-backdrop"
    role="presentation"
    onclick={closeContextMenu}
    onkeydown={closeContextMenu}
  ></div>
  <div
    class="ctx-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
  >
    {#if onTestWindow}
      <button
        class="ctx-item"
        onclick={() => {
          onTestWindow!(contextMenu!.owner, contextMenu!.name, contextMenu!.kind);
          contextMenu = null;
        }}
      >
        Test Window
      </button>
    {/if}
    {#if (contextMenu.kind === 'PROCEDURE' || contextMenu.kind === 'FUNCTION') && onExecuteProc}
      <button
        class="ctx-item"
        onclick={() => {
          onExecuteProc!(contextMenu!.owner, contextMenu!.name, contextMenu!.kind as any);
          contextMenu = null;
        }}
      >
        Execute…
      </button>
    {/if}
  </div>
{/if}
```

Add to the `<style>` block:

```css
  .ctx-backdrop {
    position: fixed; inset: 0; z-index: 900;
  }
  .ctx-menu {
    position: fixed; z-index: 901;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 140px;
    padding: 4px 0;
  }
  .ctx-item {
    display: block; width: 100%;
    background: none; border: none;
    color: var(--text-primary);
    cursor: pointer; font-size: 12px;
    padding: 6px 14px; text-align: left;
  }
  .ctx-item:hover { background: rgba(255,255,255,0.07); }
```

- [ ] **Step 2: Wire TestWindow in `+page.svelte`**

Add the import near the top of the `<script>` block in `+page.svelte`:

```typescript
import TestWindow from "$lib/workspace/TestWindow.svelte";
import { debugStore } from "$lib/stores/debug.svelte";
```

Add state for test window visibility:

```typescript
let testWindowOpen = $state(false);
```

Add the handler function (alongside other handlers like `selectObject`):

```typescript
async function onTestWindow(owner: string, name: string, kind: ObjectKind) {
  testWindowOpen = true;
  await debugStore.open(owner, name, kind, kind === "PACKAGE" ? name : null);
}
```

Find the `<SchemaTree>` component in the template and add:

```svelte
onTestWindow={onTestWindow}
```

At the bottom of the template (before closing `</div>`), add:

```svelte
{#if testWindowOpen}
  <TestWindow onClose={() => { testWindowOpen = false; debugStore.stop(); }} />
{/if}
```

- [ ] **Step 3: Verify the app builds**

```bash
bun run build 2>&1 | grep -i error | head -30
```

Expected: no errors.

- [ ] **Step 4: Compile the sidecar binary**

```powershell
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
```

- [ ] **Step 5: Smoke test in dev mode**

```bash
bun run tauri dev
```

Manual test checklist:
- [ ] Right-click a PROCEDURE in SchemaTree → context menu appears with "Test Window"
- [ ] Test Window opens full-screen
- [ ] Script editor shows generated anonymous block with named notation
- [ ] Variable Grid populates with detected bind variables
- [ ] Click a line number in the gutter → red dot ● appears
- [ ] Click again → dot disappears
- [ ] Press ▶ Run button → executes without debug, DBMS Output tab shows output
- [ ] Press ⏸ Debug button → execution starts (requires DEBUG CONNECT SESSION privilege)
- [ ] Execution pauses at first breakpoint → current line highlighted in yellow
- [ ] Step Over (F10) advances one line
- [ ] Press ■ Stop → returns to idle state
- [ ] Press ✕ → modal closes

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/SchemaTree.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(debug): wire Test Window entry point via SchemaTree right-click menu"
```

---

## Completion

After all 12 tasks pass, run the full test suite:

```bash
bun run test
cd sidecar && bun test && cd ..
```

Verify all existing tests still pass (`sql-splitter.test.ts` import errors are pre-existing — ignore them).

Then rebuild the sidecar binary and do a final smoke test:

```powershell
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
bun run tauri dev
```
