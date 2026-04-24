import oracledb from "oracledb";
import { withActiveSession, buildConnection } from "./oracle";
import { getSessionParams } from "./state";

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
      declares.push(`  ${localVar} ${p.dataType}; -- fill in`);
      callArgs.push(`    ${bind} => ${localVar}`);
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

// ── DebugSession ───────────────────────────────────────────────────────────

// DBMS_DEBUG break_next_flags constants
const BREAK_NEXT_LINE = 12;
const BREAK_ANY_CALL  = 4;
const BREAK_RETURN    = 8;

// info_requested bitmask
const INFO_RUNTIME_INFO = 44;

// DBMS_DEBUG reason codes
export const REASON_BREAKPOINT = 2;
export const REASON_STEP       = 4;
export const REASON_EXCEPTION  = 8;
export const REASON_FINISHED   = 16;

// DBMS_DEBUG LibunitType values
const LIBUNIT_PROCEDURE    = 12;
const LIBUNIT_FUNCTION     = 8;
const LIBUNIT_PACKAGE_BODY = 9;
const LIBUNIT_TRIGGER      = 11;
const NAMESPACE_PLSQL      = 1;

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
    const p = getSessionParams() as any;
    const target = await buildConnection(p);
    const debug  = await buildConnection(p);
    const session = new DebugSession(target, debug);
    _debugSession = session;
    return session;
  }

  async initialize(): Promise<string> {
    const res = await this.targetConn.execute(
      `BEGIN :sid := DBMS_DEBUG.INITIALIZE(diagnostics => 0); END;`,
      { sid: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 100 } }
    );
    const sid = (res.outBinds as any).sid as string;
    await this.debugConn.execute(
      `BEGIN DBMS_DEBUG.ATTACH_SESSION(:sid, 0); END;`,
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
    await this.debugConn.execute(
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
    const id = this.nextBpId++;
    this.breakpoints.set(id, { id, owner, objectName, objectType, line });
    return id;
  }

  async removeBreakpoint(bpId: number): Promise<void> {
    const bp = this.breakpoints.get(bpId);
    if (!bp) return;
    try {
      await this.debugConn.execute(
        `BEGIN DBMS_DEBUG.DELETE_BREAKPOINT(:bpnum); END;`,
        { bpnum: bpId }
      );
    } catch {
      // best-effort
    }
    this.breakpoints.delete(bpId);
  }

  startTarget(script: string, binds: Record<string, unknown>): void {
    this._targetExecution = this.targetConn
      .execute(script, binds)
      .catch(() => {
        // target errors surface via SYNCHRONIZE reason codes
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
       END;`,
      {
        retcode:    { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        line:       { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        reason:     { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        terminated: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        obj_name:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        obj_owner:  { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
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
      // best-effort
    }
    try { await this.targetConn.close(); } catch {}
    try { await this.debugConn.close(); } catch {}
    _debugSession = null;
  }
}
