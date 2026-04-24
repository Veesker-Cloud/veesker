import oracledb from "oracledb";
import { withActiveSession, buildConnection } from "./oracle";
import { getSessionParams } from "./state";
import { RpcCodedError, ORACLE_ERR } from "./errors";

// ── Types ──────────────────────────────────────────────────────────────────

export type ParamDef = {
  name: string;
  dataType: string;
  inOut: "IN" | "OUT" | "IN/OUT";
  position: number;
};

export type DebugBreakpoint = {
  id: number;
  oracleBpNum: number; // Oracle-assigned bp number from SET_BREAKPOINT
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
  "REF CURSOR", "CURSOR",   // SYS_REFCURSOR appears as "REF CURSOR" in ALL_ARGUMENTS
  "CLOB", "BLOB", "NCLOB",  // LOBs can't be bound as scalars in anon blocks
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

    if (dt === "BOOLEAN" || dt === "PL/SQL BOOLEAN") {
      declares.push(`  ${localVar} BOOLEAN;`);
      declares.push(
        `  -- Convert :${bind} ('TRUE'/'FALSE'/NULL) to BOOLEAN\n` +
        `  ${localVar} := CASE UPPER(:${bind}) WHEN 'TRUE' THEN TRUE WHEN 'FALSE' THEN FALSE ELSE NULL END;`
      );
      callArgs.push(`    ${bind} => ${localVar}`);
    } else if (COMPLEX_TYPES.has(dt)) {
      const isRefCursor = dt === "REF CURSOR" || dt === "CURSOR";
      if (isRefCursor && (p.inOut === "OUT" || p.inOut === "IN/OUT")) {
        callArgs.push(`    ${bind} => :out_${bind}`);
      } else {
        const declType = isRefCursor ? "SYS_REFCURSOR" : p.dataType;
        declares.push(`  ${localVar} ${declType}; -- fill in`);
        callArgs.push(`    ${bind} => ${localVar}`);
      }
    } else if (p.inOut === "IN") {
      callArgs.push(`    ${bind} => :${bind}`);
    } else if (p.inOut === "OUT") {
      const safeType =
        dt === "NUMBER" || dt === "INTEGER" || dt === "BINARY_INTEGER"
          ? "NUMBER"
          : dt === "DATE"
            ? "DATE"
            : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    } else {
      // IN/OUT
      const safeType =
        dt === "NUMBER" || dt === "INTEGER" || dt === "BINARY_INTEGER"
          ? "NUMBER"
          : dt === "DATE"
            ? "DATE"
            : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType} := :${bind};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    }
  }

  const declSection =
    declares.length > 0 ? `DECLARE\n${declares.join("\n")}\n` : "";
  const callSection = `  ${callTarget}(\n${callArgs.join(",\n")}\n  );`;
  const postSection = postCall.length > 0 ? "\n" + postCall.join("\n") : "";

  return `${declSection}BEGIN\n${callSection}${postSection}\nEND;`;
}

// ── debug.open ─────────────────────────────────────────────────────────────

export type DebugOpenParams = {
  owner: string;
  objectName: string;
  objectType: string;
  packageName?: string | null;
};

export type MemberRef = { name: string; type: "PROCEDURE" | "FUNCTION" };

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: MemberRef[];
  refCursorOutBinds: string[];
};

export type RefCursorResult = {
  name: string;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
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

    const refCursorOutBinds: string[] = [];
    for (const pp of params) {
      const pt = pp.dataType.toUpperCase();
      if ((pt === "REF CURSOR" || pt === "CURSOR") && (pp.inOut === "OUT" || pp.inOut === "IN/OUT")) {
        refCursorOutBinds.push(`out_${pp.name.toLowerCase()}`);
      }
    }

    let memberList: MemberRef[] | undefined;
    if (p.objectType.toUpperCase() === "PACKAGE") {
      const membRes = await conn.execute<{ OBJECT_NAME: string; MEMBER_TYPE: string }>(
        `SELECT object_name,
                CASE WHEN MAX(CASE WHEN position = 0 THEN 1 ELSE 0 END) > 0
                     THEN 'FUNCTION' ELSE 'PROCEDURE' END AS member_type
           FROM all_arguments
          WHERE owner        = UPPER(:owner)
            AND package_name = UPPER(:packageName)
            AND object_name IS NOT NULL
          GROUP BY object_name
          ORDER BY object_name`,
        { owner: p.owner, packageName: p.objectName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      memberList = (membRes.rows ?? []).map((r) => ({
        name: r.OBJECT_NAME,
        type: r.MEMBER_TYPE as "PROCEDURE" | "FUNCTION",
      }));
    }

    return { script, params, memberList, refCursorOutBinds };
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

// ── DebugSession ───────────────────────────────────────────────────────────

// DBMS_DEBUG break_next_flags constants (from DBMS_DEBUG package spec)
const BREAK_NEXT_LINE = 2;   // stop at next source line (step over)
const BREAK_ANY_CALL  = 6;   // stop at next line AND enter any call (step into = 2|4)
const BREAK_RETURN    = 8;   // stop when current subprogram returns (step out)

// info_requested bitmask
const INFO_RUNTIME_INFO = 44;

// DBMS_DEBUG reason codes (Oracle 12c+ / 23ai)
// These are the values Oracle stores in r.Reason after SYNCHRONIZE/CONTINUE.
// Empirically verified against Oracle 23ai Free: reason=2 fires when the anonymous block
// enters the interpreter (no location); reason=25 fires when the program finishes normally.
export const REASON_NONE          = 0;
export const REASON_INTERP_START  = 2;   // interpreter starting (anonymous block enters)
export const REASON_BREAKPOINT    = 3;   // explicit breakpoint hit
export const REASON_ENTER         = 6;
export const REASON_RETURN        = 7;
export const REASON_FINISH        = 8;
export const REASON_LINE          = 9;
export const REASON_EXCEPTION     = 11;
export const REASON_EXIT          = 15;
export const REASON_KNL_EXIT      = 16;
export const REASON_WHATEVER      = 25;  // program finished without error (Oracle 12c+)

// Legacy export kept for other callers; maps to the most common "done" code.
export const REASON_FINISHED = REASON_WHATEVER;

// Reason codes that indicate the target program has ended (nothing more to debug).
function isDoneReason(reason: number): boolean {
  return (
    reason === REASON_NONE ||
    reason === REASON_FINISH ||
    reason === REASON_EXIT ||
    reason === REASON_KNL_EXIT ||
    reason === REASON_WHATEVER
  );
}

// PROGRAM_INFO.LibunitType — same enum used by both SET_BREAKPOINT and SYNCHRONIZE/CONTINUE
const LIBUNIT_PROCEDURE    = 1;
const LIBUNIT_FUNCTION     = 2;
const LIBUNIT_PACKAGE_BODY = 4;
const LIBUNIT_TRIGGER      = 7;
const NAMESPACE_PLSQL      = 1;

// Maps RUNTIME_INFO.Program.LibunitType (from SYNCHRONIZE) to an object-type string.
function libunitTypeToString(n: number): string {
  switch (n) {
    case 1: return "PROCEDURE";
    case 2: return "FUNCTION";
    case 3: return "PACKAGE";
    case 4: return "PACKAGE BODY";
    case 7: return "TRIGGER";
    case 8: return "TYPE";
    case 9: return "TYPE BODY";
    default: return "PROCEDURE";
  }
}

// Maps an object-type string to a punit.type integer for DBMS_DEBUG.SET_BREAKPOINT.
function libunitForType(objectType: string): number {
  switch (objectType.toUpperCase()) {
    case "PROCEDURE":    return LIBUNIT_PROCEDURE;
    case "FUNCTION":     return LIBUNIT_FUNCTION;
    case "PACKAGE BODY":
    case "PACKAGE":      return LIBUNIT_PACKAGE_BODY;
    case "TRIGGER":      return LIBUNIT_TRIGGER;
    default:             return LIBUNIT_PROCEDURE;
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
    if (!p) throw new Error("No active session — open a workspace first");
    const targetConn = await buildConnection(p);
    const debugConn  = await buildConnection(p);
    const session = new DebugSession(targetConn, debugConn);
    _debugSession = session;
    return session;
  }

  async initialize(): Promise<string> {
    // CRITICAL: DBMS_OUTPUT.ENABLE, INITIALIZE, and DEBUG_ON must all execute in the
    // SAME PL/SQL block. Once DEBUG_ON activates, Oracle intercepts the target session
    // for the debug wire protocol — any subsequent execute() on targetConn blocks
    // indefinitely until the debug session calls SYNCHRONIZE. Combining them here means
    // after this block returns, targetConn is idle until startTarget() fires it
    // concurrently with SYNCHRONIZE.
    process.stderr.write("[debug] initializing target session (ENABLE+INITIALIZE+DEBUG_ON in one block)\n");
    const res = await this.targetConn.execute(
      `BEGIN
         DBMS_OUTPUT.ENABLE(1000000);
         :sid := DBMS_DEBUG.INITIALIZE(diagnostics => 0);
         DBMS_DEBUG.DEBUG_ON;
       END;`,
      { sid: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 100 } }
    );
    const sid = (res.outBinds as any).sid as string;
    process.stderr.write(`[debug] INITIALIZE+DEBUG_ON OK, sid=${sid}\n`);
    await this.debugConn.execute(
      `BEGIN DBMS_DEBUG.ATTACH_SESSION(:sid, 0); END;`,
      { sid }
    );
    process.stderr.write("[debug] ATTACH_SESSION OK\n");
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
        obj_name:     objectName,
        obj_owner:    owner,
        libunit_type: libunitForType(objectType),
        line_num:     line,
        retcode:      { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        bpnum:        { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const out = res.outBinds as Record<string, number>;
    const retcode = out.retcode as number;
    if (retcode !== 0) {
      throw new RpcCodedError(ORACLE_ERR, `SET_BREAKPOINT failed: retcode=${retcode} (object not compiled for debug?)`);
    }
    const oracleBpNum = out.bpnum as number;
    const id = this.nextBpId++;
    this.breakpoints.set(id, { id, oracleBpNum, owner, objectName, objectType, line });
    return id;
  }

  async removeBreakpoint(bpId: number): Promise<void> {
    const bp = this.breakpoints.get(bpId);
    if (!bp) return;
    try {
      await this.debugConn.execute(
        `BEGIN DBMS_DEBUG.DELETE_BREAKPOINT(:bpnum); END;`,
        { bpnum: bp.oracleBpNum }
      );
    } catch {
      // best-effort
    }
    this.breakpoints.delete(bpId);
  }

  startTarget(script: string, binds: Record<string, unknown>): void {
    const execBinds: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(binds)) {
      if (key.startsWith("out_")) {
        execBinds[key] = { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 };
      } else {
        execBinds[key] = val ?? null;
      }
    }
    this._targetExecution = this.targetConn
      .execute(script, execBinds)
      .catch(() => {
        // target errors surface via SYNCHRONIZE reason codes
      });
  }

  // synchronizeWithTimeout wraps synchronize() with a JS-level timeout.
  // If Oracle SYNCHRONIZE doesn't return within `ms` milliseconds, the debugConn
  // is closed (which causes the blocking execute to reject), and we return "completed".
  async synchronizeWithTimeout(ms: number): Promise<PauseInfo> {
    process.stderr.write(`[debug] SYNCHRONIZE loop started, timeout=${ms}ms\n`);
    const finished: PauseInfo = { status: "completed", frame: null, reason: REASON_FINISHED };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runLoop = async (): Promise<PauseInfo> => {
      // Initial SYNCHRONIZE — blocks until Oracle fires the first debug event.
      let info = await this.synchronize();
      process.stderr.write(`[debug] SYNCHRONIZE: status=${info.status} reason=${info.reason} frame=${JSON.stringify(info.frame)}\n`);

      // Oracle fires unnamed events when the anonymous block enters the PL/SQL interpreter
      // (obj=null, reason=REASON_BREAKPOINT). These are not the user's breakpoints —
      // they are intermediate events that require CONTINUE(0) to advance execution into
      // the actual stored procedure where the named breakpoints are set.
      for (let i = 0; i < 10; i++) {
        if (info.status !== "completed") break;   // "paused" = got a real named location
        if (isDoneReason(info.reason)) break;     // target program ended
        // Intermediate event (reason=2 interpreter_starting etc.): tell Oracle to resume
        process.stderr.write(`[debug] intermediate event reason=${info.reason} iter=${i + 1}, CONTINUE(0)\n`);
        info = await this.continueExecution(0);
        process.stderr.write(`[debug] CONTINUE(0): status=${info.status} reason=${info.reason} frame=${JSON.stringify(info.frame)}\n`);
      }

      return info;
    };

    const syncPromise = runLoop().catch((err) => {
      process.stderr.write(`[debug] sync loop error: ${String(err)}\n`);
      return finished;
    });

    const timeoutClose = new Promise<PauseInfo>((resolve) => {
      timer = setTimeout(() => {
        process.stderr.write(`[debug] SYNCHRONIZE timed out after ${ms}ms — closing debugConn\n`);
        this.debugConn.close().catch(() => {});
        resolve(finished);
      }, ms);
    });

    const result = await Promise.race([syncPromise, timeoutClose]);
    if (timer !== null) clearTimeout(timer);
    process.stderr.write(`[debug] sync loop final: ${JSON.stringify(result)}\n`);
    return result;
  }

  async synchronize(): Promise<PauseInfo> {
    const res = await this.debugConn.execute(
      `DECLARE
         r DBMS_DEBUG.RUNTIME_INFO;
         n PLS_INTEGER;
       BEGIN
         n := DBMS_DEBUG.SYNCHRONIZE(r, ${INFO_RUNTIME_INFO});
         :retcode      := n;
         :line         := r.Line#;
         :reason       := r.Reason;
         :terminated   := r.Terminated;
         :obj_name     := r.Program.Name;
         :obj_owner    := r.Program.Owner;
         :libunit_type := r.Program.LibunitType;
       END;`,
      {
        retcode:      { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        line:         { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        reason:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        terminated:   { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        obj_name:     { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_owner:    { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        libunit_type: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const ob = res.outBinds as any;
    const terminated: number = ob.terminated ?? 0;
    const reason: number = ob.reason ?? 0;

    if (terminated || isDoneReason(reason)) {
      return { status: "completed", frame: null, reason };
    }

    const objName = (ob.obj_name as string) ?? "";
    const line    = (ob.line as number) ?? 0;
    if (!objName || line <= 0) {
      return { status: "completed", frame: null, reason };
    }

    return {
      status: "paused",
      reason,
      frame: {
        owner:      (ob.obj_owner as string) ?? "",
        objectName: objName,
        objectType: libunitTypeToString((ob as any).libunit_type as number),
        line,
      },
    };
  }

  async continueExecution(breakNextFlags: number): Promise<PauseInfo> {
    const res = await this.debugConn.execute(
      `DECLARE
         r DBMS_DEBUG.RUNTIME_INFO;
         n PLS_INTEGER;
       BEGIN
         n := DBMS_DEBUG.CONTINUE(r, :flags, ${INFO_RUNTIME_INFO});
         :retcode      := n;
         :line         := r.Line#;
         :reason       := r.Reason;
         :terminated   := r.Terminated;
         :obj_name     := r.Program.Name;
         :obj_owner    := r.Program.Owner;
         :libunit_type := r.Program.LibunitType;
       END;`,
      {
        flags:        breakNextFlags,
        retcode:      { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        line:         { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        reason:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        terminated:   { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        obj_name:     { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_owner:    { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        libunit_type: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const ob = res.outBinds as any;
    const terminated: number = ob.terminated ?? 0;
    const reason: number = ob.reason ?? 0;

    if (terminated || isDoneReason(reason)) {
      return { status: "completed", frame: null, reason };
    }

    const objName2 = (ob.obj_name as string) ?? "";
    const line2    = (ob.line as number) ?? 0;
    if (!objName2 || line2 <= 0) {
      return { status: "completed", frame: null, reason };
    }

    return {
      status: "paused",
      reason,
      frame: {
        owner:      (ob.obj_owner as string) ?? "",
        objectName: objName2,
        objectType: libunitTypeToString((ob.libunit_type as number) ?? 0),
        line:       line2,
      },
    };
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
            varname: name,
            val:     { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
            retcode: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
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
    return [];
  }

  stop(): void {
    _debugSession = null;
    // Fire-and-forget: don't await — awaiting close() while an execute() is pending
    // on the same connection causes a mutual deadlock (close waits for execute, execute
    // waits for Oracle event that never comes). Closing the TCP socket is near-instant
    // and will cause the pending execute() to reject, unblocking synchronize/continue.
    this.debugConn.close().catch(() => {});
    this.targetConn.close().catch(() => {});
  }
}

// ── Exported RPC handler functions ─────────────────────────────────────────

export type DebugStartParams = {
  script: string;
  binds: Record<string, unknown>;
  breakpoints: Array<{ owner: string; objectName: string; objectType: string; line: number }>;
  // Object to auto-breakpoint on entry (required for first pause)
  owner: string;
  objectName: string;
  objectType: string;
  packageName?: string | null;
};

export async function debugStart(p: DebugStartParams): Promise<PauseInfo> {
  process.stderr.write(
    `[debug] debugStart: owner=${p.owner} obj=${p.objectName} type=${p.objectType} pkg=${p.packageName ?? "null"} userBps=${p.breakpoints.length}\n`
  );

  if (_debugSession) {
    process.stderr.write("[debug] stopping previous session\n");
    _debugSession.stop();
  }

  const session = await DebugSession.create();
  process.stderr.write("[debug] connections created\n");

  try {
    await session.initialize();
  } catch (e) {
    process.stderr.write(`[debug] initialize FAILED: ${String(e)}\n`);
    session.stop();
    throw e;
  }

  // Set user-defined breakpoints. Failures are non-fatal (bad line numbers, non-debug
  // compiled objects for specific lines) — skip failed ones and continue with valid ones.
  let validUserBps = 0;
  for (const bp of p.breakpoints) {
    process.stderr.write(`[debug] setting user bp: ${bp.objectName}:${bp.line}\n`);
    try {
      await session.setBreakpoint(bp.owner, bp.objectName, bp.objectType, bp.line);
      validUserBps++;
    } catch (e) {
      process.stderr.write(`[debug] user bp ${bp.objectName}:${bp.line} skipped: ${String(e)}\n`);
    }
  }
  process.stderr.write(`[debug] user bps: ${validUserBps}/${p.breakpoints.length} set\n`);

  // Auto-set an entry breakpoint at line 1 of the target procedure.
  // DBMS_DEBUG never auto-pauses on entry — without at least one breakpoint the
  // anonymous block runs to completion and SYNCHRONIZE blocks forever.
  // SET_BREAKPOINT moves line 1 to the first executable line automatically.
  // For package members the breakpoint must target the PACKAGE BODY, not the spec.
  const entryTarget = p.packageName ?? p.objectName;
  const entryType   = p.packageName ? "PACKAGE BODY" : p.objectType;
  let entryBpId: number | null = null;
  try {
    process.stderr.write(`[debug] setting entry bp: ${entryTarget} (${entryType}) line=1\n`);
    entryBpId = await session.setBreakpoint(p.owner, entryTarget, entryType, 1);
    process.stderr.write(`[debug] entry bp OK, bpId=${entryBpId}\n`);
  } catch (e) {
    process.stderr.write(`[debug] entry bp FAILED: ${String(e)}\n`);
    // If no valid breakpoints at all, fail immediately rather than hanging 30s silently.
    if (validUserBps === 0) {
      session.stop();
      throw new RpcCodedError(
        ORACLE_ERR,
        `${entryTarget} is not compiled for debug. Run:\n` +
        `ALTER ${entryType} ${p.owner}.${entryTarget} COMPILE DEBUG;\n` +
        `Also ensure: GRANT DEBUG CONNECT SESSION TO ${p.owner}; GRANT DEBUG ANY PROCEDURE TO ${p.owner};`
      );
    }
    // else: proceed with just the valid user-defined breakpoints
  }

  // Fire target asynchronously, then SYNCHRONIZE waits for the entry breakpoint.
  process.stderr.write("[debug] firing startTarget\n");
  session.startTarget(p.script, p.binds);

  try {
    const result = await session.synchronizeWithTimeout(30_000);

    // Remove the auto-entry breakpoint after first pause so it's invisible to the user
    if (entryBpId !== null) {
      session.removeBreakpoint(entryBpId).catch(() => {});
    }

    // If the target completed without ever pausing at a named location, the breakpoints
    // were accepted by Oracle but never fired — almost always because the target object
    // lacks debug symbols (compiled with PLSQL_OPTIMIZE_LEVEL>1 or NATIVE).
    if (result.status === "completed" && result.frame === null) {
      session.stop();
      process.stderr.write(`[debug] target ran to completion without pausing — likely not debug-compiled\n`);
      throw new RpcCodedError(
        ORACLE_ERR,
        `${entryTarget} ran without pausing — the object likely lacks debug information.\n` +
        `Recompile with debug symbols and try again:\n` +
        `ALTER SESSION SET PLSQL_OPTIMIZE_LEVEL = 1;\n` +
        `ALTER ${entryType} ${p.owner}.${entryTarget} COMPILE;\n` +
        `Verify: SELECT plsql_optimize_level FROM all_plsql_object_settings WHERE owner='${p.owner}' AND name='${entryTarget}';`
      );
    }

    process.stderr.write(`[debug] debugStart complete: ${result.status}\n`);
    return result;
  } catch (e) {
    if (e instanceof RpcCodedError) throw e;
    process.stderr.write(`[debug] synchronizeWithTimeout threw: ${String(e)}\n`);
    return { status: "completed", frame: null, reason: REASON_FINISHED };
  }
}

async function safeStep(flags: number): Promise<PauseInfo> {
  if (!_debugSession) throw new RpcCodedError(ORACLE_ERR, "No active debug session");
  const session = _debugSession;
  const completed: PauseInfo = { status: "completed", frame: null, reason: REASON_FINISHED };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const continuePromise = session.continueExecution(flags).catch(() => completed);
  const timeoutClose = new Promise<PauseInfo>((resolve) => {
    timer = setTimeout(() => {
      session.stop();
      resolve(completed);
    }, 60_000);
  });
  const result = await Promise.race([continuePromise, timeoutClose]);
  if (timer !== null) clearTimeout(timer);
  return result;
}

export const debugStepInto  = () => safeStep(BREAK_ANY_CALL);
export const debugStepOver  = () => safeStep(BREAK_NEXT_LINE);
export const debugStepOut   = () => safeStep(BREAK_RETURN);
export const debugContinue  = () => safeStep(0);

export function debugStop(): { ok: boolean } {
  if (_debugSession) _debugSession.stop();
  return { ok: true };
}

export async function debugSetBreakpoint(p: {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
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
  cursorBinds?: string[];
}): Promise<{
  output: string[];
  elapsedMs: number;
  outBinds: Record<string, string | null>;
  refCursors: RefCursorResult[];
}> {
  const started = Date.now();
  const cursorSet = new Set(p.cursorBinds ?? []);
  return withActiveSession(async (conn) => {
    await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(1000000); END;`);

    const execBinds: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p.binds)) {
      if (cursorSet.has(key)) {
        execBinds[key] = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
      } else if (key.startsWith("out_")) {
        execBinds[key] = { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 };
      } else {
        execBinds[key] = val ?? null;
      }
    }

    const execResult = await conn.execute(p.script, execBinds);
    const rawOut = (execResult.outBinds ?? {}) as Record<string, unknown>;

    const outBinds: Record<string, string | null> = {};
    const refCursors: RefCursorResult[] = [];
    for (const [name, val] of Object.entries(rawOut)) {
      if (cursorSet.has(name)) {
        const rs = val as oracledb.ResultSet<unknown[]> | null;
        if (rs) {
          const meta = (rs.metaData ?? []) as Array<{ name: string; dbTypeName?: string }>;
          const columns = meta.map((m) => ({
            name: m.name,
            dataType: m.dbTypeName ?? "UNKNOWN",
          }));
          const rows: unknown[][] = [];
          let row: unknown[] | undefined;
          let count = 0;
          while ((row = (await rs.getRow()) as unknown[] | undefined) && count < 1000) {
            rows.push(row);
            count++;
          }
          await rs.close();
          refCursors.push({ name, columns, rows });
        } else {
          refCursors.push({ name, columns: [], rows: [] });
        }
      } else {
        outBinds[name] = val === null || val === undefined ? null : String(val);
      }
    }

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
    return { output: lines, elapsedMs: Date.now() - started, outBinds, refCursors };
  });
}
