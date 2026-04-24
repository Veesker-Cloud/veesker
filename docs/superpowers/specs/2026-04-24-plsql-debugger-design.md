# PL/SQL Debugger — Design Spec

**Date:** 2026-04-24  
**Branch:** feat/plsql-debugger  
**Status:** Approved

---

## Overview

Add a PL/SQL step-through debugger to Veesker, modeled on PL/SQL Developer's Test Window. The entry point is a right-click context menu on any PROCEDURE, FUNCTION, or PACKAGE in the SchemaTree. The feature uses Oracle's `DBMS_DEBUG` package (two-session protocol) implemented entirely in the sidecar — no reverse TCP connection required.

---

## 1. User Flow

1. User right-clicks a PROCEDURE, FUNCTION, or PACKAGE node in the SchemaTree.
2. Context menu shows **"Test Window"**.
3. TestWindow modal opens (full-screen):
   - Auto-generated anonymous block in the editor (named notation, bind variables for each parameter).
   - VariableGrid at the bottom pre-populated with detected `:bind_vars` (type + empty value field).
4. User fills in parameter values in the grid.
5. User clicks **▶ Run** (no debug) or **⏸ Debug** (with DBMS_DEBUG step-through).
6. In debug mode:
   - Execution pauses at the first breakpoint (or first line if no breakpoints set).
   - Current line is highlighted with `→` in the editor gutter.
   - VariableGrid shows live values for local variables in the current frame.
   - User uses toolbar: Step Into / Step Over / Step Out / Continue / Stop.
   - Stepping into a different object switches the editor source automatically.
7. DBMS Output captured after each pause and displayed in the DBMS Output tab.

---

## 2. Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Test Script] [DBMS Output] [Statistics]        [✕]   │
├─────────────────────────────────────────────────────────┤
│  ▶ ⏸ ↓ ↷ ↑ ■   [●breakpoint]   status: idle           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   CodeMirror editor (PL/SQL, dark theme)                │
│   — breakpoint gutter (click to toggle ●)               │
│   — current line decoration (→ highlight)               │
│   — compile error squiggles                             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  ● │ Variable         │ Type      │ Value               │
│  ✓ │ p_commit_each    │ Integer   │ [____]              │
│  ✓ │ p_abort_on_error │ String    │ [____]              │
│  + │                  │           │                     │
└─────────────────────────────────────────────────────────┘
```

**Tab bar (top):**
- **Test Script** — the editor + variable grid (default)
- **DBMS Output** — accumulated `DBMS_OUTPUT` lines
- **Statistics** — execution time, line counts (future)

**Debug toolbar buttons:**

| Button | Action | Keyboard |
|--------|---------|----------|
| ▶ Run | Execute without debug | F8 |
| ⏸ Debug | Execute with DBMS_DEBUG | F9 |
| ↓ Step Into | Break on any call | F7 |
| ↷ Step Over | Break on next line | F10 |
| ↑ Step Out | Break on return | Shift+F7 |
| ▶ Continue | Resume to next breakpoint | F5 |
| ■ Stop | Abort debug session | Shift+F5 |
| ● Breakpoint | Toggle breakpoint on current line | Ctrl+B |

---

## 3. Anonymous Block Generation

### Source: `ALL_ARGUMENTS`

```sql
SELECT argument_name, data_type, in_out, position, type_owner, type_name
  FROM all_arguments
 WHERE owner      = :owner
   AND object_name = :proc_name
   AND (package_name = :pkg_name OR (:pkg_name IS NULL AND package_name IS NULL))
   AND overload IS NULL
 ORDER BY position
```

### Generation rules

- **IN parameters** → `:param_name` bind variable directly in the call.
- **OUT parameters** → local variable `v_param_name <type>`, assigned to `:out_param_name` after the call.
- **IN OUT parameters** → local variable initialized from `:param_name`, passed by reference.
- **Complex types** (RECORD, collection, %ROWTYPE, object) → declared as empty variable with a `-- fill in` comment; the bind approach is not used.
- **BOOLEAN** → local variable initialized from `:param_name` bind as VARCHAR2 ('TRUE'/'FALSE'/'NULL') with an inline `CASE` conversion.

### Example output

```sql
DECLARE
  v_result   VARCHAR2(32767);
BEGIN
  PKG_NAME.PROC_NAME(
    p_id      => :p_id,
    p_name    => :p_name,
    p_result  => v_result
  );
  :out_result := v_result;
END;
```

---

## 4. VariableGrid

- Detects `:bind_var` patterns from the script text via regex on change.
- Each row: checkbox (include/exclude) | name | Oracle type (editable) | value input.
- Type determines the HTML input: `number` for numeric types, `datetime-local` for DATE, `select` (TRUE/FALSE/NULL) for BOOLEAN, `text` for everything else.
- DATE values are converted: `TO_DATE(:v, 'YYYY-MM-DD"T"HH24:MI')` wrapped inline.
- Rows can be added manually (the `+` row at the bottom).
- During debug execution, the Value column switches to read-only and reflects live `DBMS_DEBUG.GET_VALUE` results for each local variable in the current stack frame.

---

## 5. DBMS_DEBUG Protocol (Sidecar)

### Two-connection model

The sidecar opens two separate Oracle connections using the same credentials as the active session:

- **Target connection** — runs the anonymous block. Pauses at breakpoints via internal Oracle mechanism.
- **Debug connection** — polls and controls the target via `DBMS_DEBUG` calls.

Both connections are managed by a `DebugSession` class in `sidecar/src/debug.ts`, isolated from the main `ActiveSession`.

### Session lifecycle

```
debug.start(script, binds, breakpoints)
  1. target:  BEGIN DBMS_DEBUG.INITIALIZE(:sid, diagnostics=>0); END;  → sid
  2. debug:   BEGIN DBMS_DEBUG.ATTACH_SESSION(:sid, diagnostics=>0); END;
  3. debug:   SET_BREAKPOINT for each requested breakpoint
  4. target:  execute(script, binds)  — ASYNC (does not await)
  5. debug:   DBMS_DEBUG.SYNCHRONIZE(run_info, info_requested)  — blocks until pause
  6. → emit "paused" event to UI with { object, owner, line, callStack, variables }

debug.stepInto / stepOver / stepOut / continue
  → DBMS_DEBUG.CONTINUE(run_info, break_next => <flag>)
  → DBMS_DEBUG.SYNCHRONIZE → emit "paused" or "completed"

debug.stop
  → DBMS_DEBUG.OFF on target
  → close both connections
  → emit "stopped"
```

### RPC methods (new in `sidecar/src/index.ts`)

| Method | Params | Returns |
|--------|--------|---------|
| `debug.open` | `{ owner, objectName, objectType, packageName? }` | `{ script, params: ParamDef[] }` |
| `debug.getSource` | `{ owner, objectName, objectType }` | `{ lines: string[] }` |
| `debug.setBreakpoint` | `{ owner, objectName, objectType, line }` | `{ breakpointId }` |
| `debug.removeBreakpoint` | `{ breakpointId }` | `{ ok }` |
| `debug.start` | `{ script, binds, breakpoints }` | `{ status: 'paused' \| 'completed', frame? }` |
| `debug.continue` | `{}` | `{ status, frame? }` |
| `debug.stepInto` | `{}` | `{ status, frame? }` |
| `debug.stepOver` | `{}` | `{ status, frame? }` |
| `debug.stepOut` | `{}` | `{ status, frame? }` |
| `debug.getValues` | `{ frameIndex? }` | `{ variables: VarValue[] }` |
| `debug.getCallStack` | `{}` | `{ frames: StackFrame[] }` |
| `debug.stop` | `{}` | `{ ok }` |
| `debug.run` | `{ script, binds }` | `{ output: string[], elapsedMs }` |

### Source fetching for step-into

When `SYNCHRONIZE` returns a frame pointing to a different object than the current editor, `debug.getSource` reads `ALL_SOURCE`:

```sql
SELECT text
  FROM all_source
 WHERE owner = :owner AND name = :name AND type = :type
 ORDER BY line
```

---

## 6. Frontend Components

| File | Role |
|------|------|
| `src/lib/workspace/TestWindow.svelte` | Full-screen modal, tab bar, layout orchestration |
| `src/lib/workspace/DebugToolbar.svelte` | Run/Debug/Step buttons, status badge |
| `src/lib/workspace/VariableGrid.svelte` | Bind variable inputs + live value display |
| `src/lib/workspace/DebugCallStack.svelte` | Call stack list (shown in a bottom sub-tab or side panel) |
| `src/lib/stores/debug.svelte.ts` | Svelte 5 `$state` store — all debug session state |
| `src/lib/workspace` (CodeMirror extensions) | `breakpointGutter.ts` — gutter click + red dot decoration; `currentLineDecoration.ts` — current line highlight |

### SchemaTree changes

- Add right-click context menu to PROCEDURE, FUNCTION, PACKAGE, and PACKAGE BODY nodes.
- Menu item: **Test Window** → dispatches `onTestWindow(owner, name, kind)` event up to the page.
- Page handler opens `TestWindow` modal passing the object reference.

### Package member selection

When opening a PACKAGE, a `<select>` dropdown in the TestWindow header lets the user pick which public procedure or function to test. Each selection re-calls `debug.open` and regenerates the script.

---

## 7. Error Handling

| Error | Handling |
|-------|----------|
| `ORA-01031` insufficient privileges | Alert in status bar: "Grant `DEBUG CONNECT SESSION` and `DEBUG` on target objects" |
| `ORA-30683` debug session already attached | Auto-call `debug.stop` then retry |
| `DBMS_DEBUG.SYNCHRONIZE` timeout (>30s) | Stop session, show "Debug timeout — target may be blocked" |
| `ORA-03113 / NJS-003` lost session | Emit SESSION_LOST, close TestWindow, trigger reconnect flow |
| Compilation error on Run/Debug | Show compile errors in CompileErrors panel above the editor, do not start debug |
| Step-into unavailable object (no DEBUG grant) | Skip into, treat as step-over, show warning in status bar |

---

## 8. Privileges Required

The connected Oracle user must have:

```sql
GRANT DEBUG CONNECT SESSION TO <user>;
GRANT DEBUG ANY PROCEDURE TO <user>;
-- or per-object:
GRANT DEBUG ON <owner>.<object> TO <user>;
```

The Test Window shows a one-time hint banner if `debug.open` detects missing privileges via a `SELECT` on `SESSION_PRIVS`.

---

## 9. Out of Scope

- Conditional breakpoints (future enhancement)
- Watch expressions (future)
- DBMS_PROFILER integration (future — Statistics tab placeholder only)
- Debugging triggers directly (can be hit via step-into from a DML call)
- Remote debugging via DBMS_DEBUG_JDWP
- Debugging objects in other schemas without DEBUG ANY PROCEDURE
